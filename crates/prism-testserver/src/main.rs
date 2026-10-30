//! `prism-testserver` command-line binary for benchmarks and manual testing.
//!
//! ```text
//! prism-testserver [--port 8080] [--bind 127.0.0.1] [--size 1G] [--throttle 2M] [--seed 1]
//!                  [--no-range] [--max-conn N] [--limit-mode 503|429|reset]
//!                  [--drop-prob P] [--ttfb-ms MS] [--hls] [--dash]
//! ```
//!
//! Defaults given here apply to `/file/<name>` and `/`; every option can still be overridden per
//! request via the query string (e.g. `/file/x.bin?size=64M&throttle=1M`).

use std::process::ExitCode;
use std::time::Duration;

use prism_testserver::{
    DashFixture, HlsFixture, ServerConfig, TestServer, expected_sha256, parse_size,
};

fn usage() -> &'static str {
    "usage: prism-testserver [--port N] [--bind IP] [--size SIZE] [--throttle RATE] [--seed N]\n\
     \t[--no-range] [--max-conn N] [--limit-mode 503|429|reset] [--drop-prob P] [--ttfb-ms MS]\n\
     \t[--hls] [--dash]\n\
     SIZE/RATE accept K/M/G suffixes (binary)."
}

fn parse_args() -> Result<ServerConfig, String> {
    let mut cfg = ServerConfig {
        port: 8080,
        ..ServerConfig::default()
    };
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        let mut val = |name: &str| args.next().ok_or_else(|| format!("{name} needs a value"));
        match a.as_str() {
            "--port" => cfg.port = val("--port")?.parse().map_err(|_| "bad --port")?,
            "--bind" => cfg.bind = val("--bind")?.parse().map_err(|_| "bad --bind")?,
            "--size" => cfg.file_defaults.size = parse_size(&val("--size")?)?,
            "--throttle" => cfg.file_defaults.throttle = parse_size(&val("--throttle")?)?,
            "--seed" => {
                cfg.file_defaults.seed = val("--seed")?.parse().map_err(|_| "bad --seed")?
            }
            "--no-range" => cfg.file_defaults.ranges = false,
            "--max-conn" => {
                cfg.max_connections =
                    Some(val("--max-conn")?.parse().map_err(|_| "bad --max-conn")?)
            }
            "--limit-mode" => cfg.limit_mode = val("--limit-mode")?.parse()?,
            "--drop-prob" => {
                cfg.file_defaults.drop_prob =
                    val("--drop-prob")?.parse().map_err(|_| "bad --drop-prob")?
            }
            "--ttfb-ms" => {
                cfg.file_defaults.ttfb =
                    Duration::from_millis(val("--ttfb-ms")?.parse().map_err(|_| "bad --ttfb-ms")?)
            }
            "--hls" => cfg.hls = Some(HlsFixture::synthetic(3, 30, 256 * 1024, 1)),
            "--dash" => cfg.dash = Some(DashFixture::synthetic(2, 30, 256 * 1024, 1)),
            "-h" | "--help" => return Err(usage().to_string()),
            other => return Err(format!("unknown argument {other:?}\n{}", usage())),
        }
    }
    Ok(cfg)
}

#[tokio::main]
async fn main() -> ExitCode {
    let cfg = match parse_args() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::from(2);
        }
    };
    let size = cfg.file_defaults.size;
    let seed = cfg.file_defaults.seed;
    let server = match TestServer::start(cfg).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("failed to start: {e}");
            return ExitCode::FAILURE;
        }
    };
    println!("prism-testserver listening on {}", server.base_url());
    println!(
        "  file:   {}/file/test.bin  ({} bytes, seed {})",
        server.base_url(),
        size,
        seed
    );
    if server.config().hls.is_some() {
        println!("  hls:    {}/hls/master.m3u8", server.base_url());
    }
    if server.config().dash.is_some() {
        println!("  dash:   {}/dash/manifest.mpd", server.base_url());
    }
    if size <= 4 << 30 {
        println!("  sha256: {}", expected_sha256(seed, size));
    }
    let _ = tokio::signal::ctrl_c().await;
    let stats = server.stats();
    println!(
        "served {} requests on {} connections (max concurrent {}, refused {})",
        stats.total_requests(),
        stats.total_connections(),
        stats.max_concurrent,
        stats.refused
    );
    server.shutdown().await;
    ExitCode::SUCCESS
}
