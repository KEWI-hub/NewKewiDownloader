//! A minimal FTP server for the engine tests: any login, binary type, `SIZE`, `MDTM`, `REST`,
//! passive `RETR` (`PASV` / `EPSV`) of generated files.
//!
//! Every `PASV` / `EPSV` binds its own listener on an OS-assigned port, so concurrent sessions
//! never share a data port. (libunftp draws passive ports from a range and binds them with
//! `SO_REUSEADDR`; on Windows that lets a second session bind a port another session is still
//! listening on, the data connections reach the wrong sessions, and a multi-connection
//! download silently receives other segments' bytes.)

use std::collections::HashMap;
use std::io;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use percent_encoding::{AsciiSet, CONTROLS, utf8_percent_encode};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::{JoinHandle, JoinSet};

use crate::content::fill;

/// How long `RETR` waits for the client's data connection.
const DATA_ACCEPT_TIMEOUT: Duration = Duration::from_secs(10);
/// Bytes per data-connection write.
const CHUNK: usize = 64 * 1024;
/// Characters escaped in file names of [`FtpServer::url`].
const NAME: &AsciiSet = &CONTROLS.add(b' ').add(b'#').add(b'?').add(b'%');

#[derive(Debug, Clone, Copy)]
struct Generated {
    seed: u64,
    size: u64,
}

type Files = Arc<HashMap<String, Generated>>;

/// A running FTP server on 127.0.0.1. Dropping it closes the listener and all sessions.
pub struct FtpServer {
    addr: SocketAddr,
    task: JoinHandle<()>,
}

impl FtpServer {
    /// Serves `files` as `(name, seed, size)`; the content is [`crate::expected_bytes`]`(seed, ..)`.
    pub async fn start(files: &[(&str, u64, u64)]) -> io::Result<FtpServer> {
        let files: Files = Arc::new(
            files
                .iter()
                .map(|&(name, seed, size)| (name.to_string(), Generated { seed, size }))
                .collect(),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;
        let task = tokio::spawn(async move {
            // Owned by this task: aborting it aborts every session.
            let mut sessions = JoinSet::new();
            while let Ok((sock, _)) = listener.accept().await {
                sessions.spawn(session(sock, files.clone()));
                while sessions.try_join_next().is_some() {}
            }
        });
        Ok(FtpServer { addr, task })
    }

    /// Control connection address.
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }

    /// `ftp://ip:port/<name>` with the name percent-encoded.
    pub fn url(&self, name: &str) -> String {
        format!("ftp://{}/{}", self.addr, utf8_percent_encode(name, NAME))
    }
}

impl Drop for FtpServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn session(sock: TcpStream, files: Files) -> io::Result<()> {
    let local_ip = sock.local_addr()?.ip();
    let (rd, mut wr) = sock.into_split();
    let mut lines = BufReader::new(rd).lines();
    wr.write_all(b"220 prism-testserver FTP\r\n").await?;
    let lookup = |path: &str| files.get(path.trim_start_matches('/')).copied();
    let mut rest = 0u64;
    let mut passive: Option<TcpListener> = None;
    while let Some(line) = lines.next_line().await? {
        let (cmd, arg) = line.split_once(' ').unwrap_or((line.as_str(), ""));
        let cmd = cmd.trim().to_ascii_uppercase();
        let reply = match cmd.as_str() {
            "USER" => "331 Any password will do".to_string(),
            "PASS" => "230 Logged in".to_string(),
            "TYPE" | "NOOP" => "200 OK".to_string(),
            "SIZE" => lookup(arg).map_or_else(not_found, |f| format!("213 {}", f.size)),
            "MDTM" => lookup(arg).map_or_else(not_found, |_| "213 20240101000000".to_string()),
            "REST" => match arg.trim().parse() {
                Ok(n) => {
                    rest = n;
                    format!("350 Restarting at {n}")
                }
                Err(_) => "501 Bad offset".to_string(),
            },
            "PASV" | "EPSV" => {
                let l = TcpListener::bind((local_ip, 0)).await?;
                let port = l.local_addr()?.port();
                passive = Some(l);
                match local_ip {
                    IpAddr::V4(ip) if cmd == "PASV" => {
                        let [a, b, c, d] = ip.octets();
                        let (p1, p2) = (port >> 8, port & 0xff);
                        format!("227 Entering Passive Mode ({a},{b},{c},{d},{p1},{p2})")
                    }
                    _ => format!("229 Entering Extended Passive Mode (|||{port}|)"),
                }
            }
            "RETR" => {
                let offset = std::mem::take(&mut rest);
                match (lookup(arg), passive.take()) {
                    (None, _) => not_found(),
                    (Some(_), None) => "425 Use PASV first".to_string(),
                    (Some(f), Some(l)) => {
                        wr.write_all(b"150 Opening BINARY data connection\r\n")
                            .await?;
                        let sent = match tokio::time::timeout(DATA_ACCEPT_TIMEOUT, l.accept()).await
                        {
                            Ok(Ok((data, _))) => send(data, f, offset).await.is_ok(),
                            _ => false,
                        };
                        if sent {
                            "226 Transfer complete".to_string()
                        } else {
                            "426 Transfer aborted".to_string()
                        }
                    }
                }
            }
            "QUIT" => {
                wr.write_all(b"221 Bye\r\n").await?;
                return Ok(());
            }
            _ => "502 Command not implemented".to_string(),
        };
        wr.write_all(format!("{reply}\r\n").as_bytes()).await?;
    }
    Ok(())
}

fn not_found() -> String {
    "550 No such file".to_string()
}

async fn send(mut data: TcpStream, f: Generated, mut off: u64) -> io::Result<()> {
    let mut buf = vec![0u8; CHUNK];
    while off < f.size {
        let n = ((f.size - off) as usize).min(CHUNK);
        fill(f.seed, off, &mut buf[..n]);
        data.write_all(&buf[..n]).await?;
        off += n as u64;
    }
    data.shutdown().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncReadExt;

    /// Minimal client: reads one reply line.
    async fn reply(r: &mut tokio::io::Lines<BufReader<tokio::net::tcp::OwnedReadHalf>>) -> String {
        r.next_line().await.unwrap().unwrap()
    }

    /// Opens a session and puts it into passive mode for `RETR f.bin` from `offset`;
    /// returns the control halves and the (not yet connected) data port.
    async fn passive_session(
        server: &FtpServer,
        offset: u64,
    ) -> (
        tokio::io::Lines<BufReader<tokio::net::tcp::OwnedReadHalf>>,
        tokio::net::tcp::OwnedWriteHalf,
        u16,
    ) {
        let (rd, mut wr) = TcpStream::connect(server.addr())
            .await
            .unwrap()
            .into_split();
        let mut rd = BufReader::new(rd).lines();
        assert!(reply(&mut rd).await.starts_with("220"));
        for (cmd, code) in [("USER a", "331"), ("PASS b", "230"), ("TYPE I", "200")] {
            wr.write_all(format!("{cmd}\r\n").as_bytes()).await.unwrap();
            assert!(reply(&mut rd).await.starts_with(code));
        }
        wr.write_all(format!("REST {offset}\r\n").as_bytes())
            .await
            .unwrap();
        assert!(reply(&mut rd).await.starts_with("350"));
        wr.write_all(b"EPSV\r\n").await.unwrap();
        let r = reply(&mut rd).await;
        let port = r
            .rsplit("|||")
            .next()
            .and_then(|p| p.trim_end_matches(")").trim_end_matches('|').parse().ok())
            .unwrap_or_else(|| panic!("bad EPSV reply {r}"));
        (rd, wr, port)
    }

    /// Many sessions in passive mode at the same time each get their own data port, and each
    /// data connection carries that session's offset (the libunftp-on-Windows failure mode).
    #[tokio::test]
    async fn concurrent_passive_sessions_get_their_own_data() {
        let size = 1 << 20;
        let server = FtpServer::start(&[("f.bin", 7, size)]).await.unwrap();
        let mut sessions = Vec::new();
        for i in 0..16u64 {
            sessions.push((i * 4096 + i, passive_session(&server, i * 4096 + i).await));
        }
        let mut ports: Vec<u16> = sessions.iter().map(|(_, (_, _, p))| *p).collect();
        ports.sort_unstable();
        ports.dedup();
        assert_eq!(ports.len(), sessions.len(), "data ports are unique");
        for (offset, (mut rd, mut wr, port)) in sessions {
            let mut data = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            wr.write_all(b"RETR /f.bin\r\n").await.unwrap();
            assert!(reply(&mut rd).await.starts_with("150"));
            let mut got = Vec::new();
            data.read_to_end(&mut got).await.unwrap();
            assert_eq!(got, crate::expected_bytes(7, offset..size));
            assert!(reply(&mut rd).await.starts_with("226"));
        }
    }

    #[tokio::test]
    async fn missing_file_and_url_encoding() {
        let server = FtpServer::start(&[("a b#.bin", 1, 10)]).await.unwrap();
        assert!(server.url("a b#.bin").ends_with("/a%20b%23.bin"));
        let (rd, mut wr) = TcpStream::connect(server.addr())
            .await
            .unwrap()
            .into_split();
        let mut rd = BufReader::new(rd).lines();
        reply(&mut rd).await;
        wr.write_all(b"SIZE /a b#.bin\r\nSIZE /nope\r\n")
            .await
            .unwrap();
        assert_eq!(reply(&mut rd).await, "213 10");
        assert!(reply(&mut rd).await.starts_with("550"));
    }
}
