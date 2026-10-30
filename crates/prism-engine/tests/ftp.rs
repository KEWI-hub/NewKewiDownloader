//! FTP integration tests: multi-connection downloads against prism-testserver's minimal FTP
//! server, plus interoperability checks against an embedded libunftp server (anonymous login,
//! passive mode).
//!
//! libunftp binds passive data ports from a range with `SO_REUSEADDR`. On Windows that lets two
//! sessions listen on the same port at once, so concurrent data connections can reach the wrong
//! session and a multi-connection download receives another segment's bytes. Multi-connection
//! tests therefore use libunftp only where that cannot happen.

mod common;

use std::time::Duration;

use common::*;
use prism_engine::{EngineError, ResumeKind};
use prism_testserver::{FtpServer, expected_sha256};

const SEED: u64 = 31;
const SIZE: u64 = 24 * MIB + 3;
const NAME: &str = "big file.bin";

/// Starts a libunftp server serving `root`; returns its port.
async fn libunftp_server(root: std::path::PathBuf) -> u16 {
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let base = 40_000 + fastrand::u16(0..200) * 100;
    let server = libunftp::ServerBuilder::new(Box::new(move || {
        unftp_sbe_fs::Filesystem::new(root.clone()).unwrap()
    }))
    .passive_ports(base..=base + 99)
    .build()
    .unwrap();
    tokio::spawn(server.listen(format!("127.0.0.1:{port}")));
    // Wait until it accepts connections.
    for _ in 0..100 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_ok()
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    port
}

/// Probe, full multi-connection download, then pause (speed limited so it is still running)
/// and resume in a new engine; both results must be byte-exact.
async fn multi_connection_download_and_resume(url: &str) {
    // Probe.
    let dir = tempfile::tempdir().unwrap();
    let info = engine().probe(&request(url, dir.path(), 4)).await.unwrap();
    assert_eq!(info.size, Some(SIZE));
    assert!(info.resumable);
    assert_eq!(info.file_name, NAME);

    // Full multi-connection download.
    let h = engine().start(request(url, dir.path(), 4), None, vec![]);
    let events = collect_events(&h);
    let done = wait(&h, 120).await.unwrap();
    assert_eq!(done.path, dir.path().join(NAME));
    let splits = events
        .lock()
        .unwrap()
        .iter()
        .filter(|e| matches!(e, prism_engine::DownloadEvent::SegmentSplit { .. }))
        .count();
    assert!(
        splits >= 3,
        "expected several REST+RETR connections, got {splits} splits"
    );
    assert_eq!(sha256_file(&done.path), expected_sha256(SEED, SIZE));

    // Pause and resume in a new engine.
    let dir = tempfile::tempdir().unwrap();
    let mut req = request(url, dir.path(), 4);
    req.speed_limit = 8 * MIB;
    let h = engine().start(req, None, vec![]);
    wait_for_progress(&h, 4 * MIB).await;
    let state = h.pause().await.expect("state");
    assert_eq!(state.kind, ResumeKind::Ftp);
    assert!(state.downloaded() >= 4 * MIB && state.downloaded() < SIZE);
    let done = wait(
        &engine().start(request(url, dir.path(), 4), Some(state), vec![]),
        120,
    )
    .await
    .unwrap();
    assert_eq!(sha256_file(&done.path), expected_sha256(SEED, SIZE));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn ftp_multi_connection_download_and_resume() {
    let server = FtpServer::start(&[(NAME, SEED, SIZE)]).await.unwrap();
    multi_connection_download_and_resume(&server.url(NAME)).await;
}

/// The same against libunftp, where its passive ports cannot be shared (see the module docs).
#[cfg(not(windows))]
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn ftp_multi_connection_download_and_resume_libunftp() {
    let root = tempfile::tempdir().unwrap();
    let content = prism_testserver::expected_bytes(SEED, 0..SIZE);
    std::fs::write(root.path().join(NAME), content).unwrap();
    let port = libunftp_server(root.path().to_path_buf()).await;
    multi_connection_download_and_resume(&format!("ftp://127.0.0.1:{port}/big%20file.bin")).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn ftp_missing_file_is_fatal() {
    let root = tempfile::tempdir().unwrap();
    let port = libunftp_server(root.path().to_path_buf()).await;
    let dir = tempfile::tempdir().unwrap();
    let h = engine().start(
        request(&format!("ftp://127.0.0.1:{port}/nope.bin"), dir.path(), 4),
        None,
        vec![],
    );
    assert!(matches!(
        wait(&h, 30).await.unwrap_err(),
        EngineError::Ftp { .. }
    ));
}
