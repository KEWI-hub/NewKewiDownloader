//! Command-line downloader for benchmarks and manual testing.
//!
//! ```text
//! cargo run --release -p prism-engine --example prism-get -- <url> [-c N] [-o DIR]
//!     [--limit RATE] [--sha256 HEX] [--http2|--http3] [--hls|--dash] [--no-remux]
//! ```
//! `--http3` needs `--features http3` and `RUSTFLAGS="--cfg reqwest_unstable"`.
//! `RATE` accepts K/M/G suffixes (bytes per second, binary multiples).

use std::path::PathBuf;
use std::process::ExitCode;
use std::time::{Duration, Instant};

use prism_engine::{
    ChecksumAlgo, DownloadEvent, DownloadHandle, DownloadRequest, Engine, EngineConfig,
    ExpectedChecksum, HttpPreference, MediaKind, MediaRequest, Url,
};

struct Args {
    url: Url,
    connections: u8,
    dir: PathBuf,
    limit: u64,
    sha256: Option<String>,
    http: HttpPreference,
    media: Option<MediaKind>,
    remux: bool,
}

fn parse_rate(s: &str) -> Result<u64, String> {
    let s = s.trim();
    let (num, mult) = match s.chars().last().map(|c| c.to_ascii_uppercase()) {
        Some('K') => (&s[..s.len() - 1], 1u64 << 10),
        Some('M') => (&s[..s.len() - 1], 1 << 20),
        Some('G') => (&s[..s.len() - 1], 1 << 30),
        _ => (s, 1),
    };
    num.parse::<f64>()
        .map(|n| (n * mult as f64) as u64)
        .map_err(|_| format!("bad rate {s:?}"))
}

fn parse_args() -> Result<Args, String> {
    let usage = "usage: prism-get <url> [-c N] [-o DIR] [--limit RATE] [--sha256 HEX] [--http2|--http3] [--hls|--dash] [--no-remux]";
    let mut url = None;
    let mut a = Args {
        url: Url::parse("http://localhost/").expect("static"),
        connections: 8,
        dir: PathBuf::from("."),
        limit: 0,
        sha256: None,
        http: HttpPreference::Http1Only,
        media: None,
        remux: true,
    };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        let mut value = |name: &str| {
            it.next()
                .ok_or_else(|| format!("{name} needs a value\n{usage}"))
        };
        match arg.as_str() {
            "-c" | "--connections" => a.connections = value("-c")?.parse().map_err(|_| "bad -c")?,
            "-o" | "--output" => a.dir = PathBuf::from(value("-o")?),
            "--limit" => a.limit = parse_rate(&value("--limit")?)?,
            "--sha256" => a.sha256 = Some(value("--sha256")?),
            "--http2" => a.http = HttpPreference::Auto,
            "--http3" => a.http = HttpPreference::Http3Experimental,
            "--hls" => a.media = Some(MediaKind::Hls),
            "--dash" => a.media = Some(MediaKind::Dash),
            "--no-remux" => a.remux = false,
            "-h" | "--help" => return Err(usage.into()),
            s if s.starts_with('-') => return Err(format!("unknown option {s}\n{usage}")),
            s => url = Some(Url::parse(s).map_err(|e| format!("bad URL: {e}"))?),
        }
    }
    a.url = url.ok_or(usage)?;
    Ok(a)
}

fn human(bytes: f64) -> String {
    const UNITS: [&str; 5] = ["B", "KiB", "MiB", "GiB", "TiB"];
    let mut v = bytes;
    let mut u = 0;
    while v >= 1024.0 && u < UNITS.len() - 1 {
        v /= 1024.0;
        u += 1;
    }
    format!("{v:.2} {}", UNITS[u])
}

async fn progress(h: DownloadHandle) {
    let mut events = h.events();
    let printer = h.clone();
    let ticker = tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;
            let s = printer.snapshot();
            let pct = s
                .total
                .filter(|t| *t > 0)
                .map(|t| format!("{:5.1}%", s.downloaded as f64 * 100.0 / t as f64));
            eprint!(
                "\r{:?} {} {} / {}  {}/s  conns {}/{}  eta {}      ",
                s.state,
                pct.unwrap_or_else(|| "  ?  ".into()),
                human(s.downloaded as f64),
                s.total.map_or("?".into(), |t| human(t as f64)),
                human(s.speed as f64),
                s.active_connections,
                s.target_connections,
                s.eta.map_or("?".into(), |e| format!("{}s", e.as_secs())),
            );
        }
    });
    while let Ok(ev) = events.recv().await {
        match ev {
            DownloadEvent::Probed(p) => eprintln!(
                "\nprobed: {} size={:?} resumable={} final_url={}",
                p.file_name, p.size, p.resumable, p.final_url
            ),
            DownloadEvent::ServerLimitDetected { connections } => {
                eprintln!("\nserver connection limit detected: {connections}")
            }
            DownloadEvent::Retrying {
                reason,
                attempt,
                delay,
            } => {
                eprintln!("\nretry #{attempt} in {delay:?}: {reason}")
            }
            DownloadEvent::Completed(_) | DownloadEvent::Failed { .. } => break,
            _ => {}
        }
    }
    ticker.abort();
}

#[tokio::main]
async fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::from(2);
        }
    };
    let engine = Engine::new(EngineConfig::default());
    let started = Instant::now();
    let handle = match args.media {
        Some(kind) => {
            let mut req = MediaRequest::new(args.url.clone(), &args.dir);
            req.kind = kind;
            req.connections = args.connections;
            req.speed_limit = args.limit;
            req.remux = args.remux;
            engine.start_media(req, None, vec![])
        }
        None => {
            let mut req = DownloadRequest::new(args.url.clone(), &args.dir);
            req.connections = args.connections;
            req.speed_limit = args.limit;
            req.http = args.http;
            req.checksum = args.sha256.map(|hex| ExpectedChecksum {
                algo: ChecksumAlgo::Sha256,
                hex,
            });
            engine.start(req, None, vec![])
        }
    };
    let watcher = tokio::spawn(progress(handle.clone()));
    let result = handle.wait().await;
    let _ = watcher.await;
    eprintln!();
    match result {
        Ok(done) => {
            let secs = started.elapsed().as_secs_f64();
            println!(
                "saved {} ({})",
                done.path.display(),
                human(done.size as f64)
            );
            println!(
                "time {secs:.2}s, average {}/s ({:.1} Mbit/s), connections requested {}",
                human(done.transferred as f64 / secs),
                done.transferred as f64 * 8.0 / secs / 1e6,
                args.connections
            );
            if let Some(ok) = done.checksum_ok {
                println!("sha256 verified: {ok}");
            }
            if let Some(w) = done.warning {
                println!("note: {w}");
            }
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("failed: {e} — {}", e.user_message());
            ExitCode::FAILURE
        }
    }
}
