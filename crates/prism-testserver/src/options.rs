//! Server-wide configuration and per-request file options.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;

use crate::media::{DashFixture, HlsFixture};

/// How the server refuses connections beyond [`ServerConfig::max_connections`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LimitMode {
    /// Answer `503 Service Unavailable` (with `Retry-After: 1`) and close.
    #[default]
    Status503,
    /// Answer `429 Too Many Requests` (with `Retry-After: 1`) and close.
    Status429,
    /// Close the TCP connection immediately without reading the request.
    Reset,
}

impl std::str::FromStr for LimitMode {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, String> {
        match s.to_ascii_lowercase().as_str() {
            "503" => Ok(Self::Status503),
            "429" => Ok(Self::Status429),
            "reset" | "rst" => Ok(Self::Reset),
            other => Err(format!(
                "unknown limit mode {other:?} (use 503, 429 or reset)"
            )),
        }
    }
}

/// Authentication requirement for a file route.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AuthMode {
    /// No authentication.
    #[default]
    None,
    /// HTTP Basic.
    Basic,
    /// HTTP Digest, MD5, `qop=auth`.
    Digest,
}

/// Options describing one served file. Every field can be overridden per request through the
/// query string (see [`FileOptions::apply_query`]); the server-wide defaults come from
/// [`ServerConfig::file_defaults`].
#[derive(Debug, Clone)]
pub struct FileOptions {
    /// Content length in bytes (`size=64M`).
    pub size: u64,
    /// Content seed (`seed=7`).
    pub seed: u64,
    /// Honour `Range` requests (`ranges=0` disables: always `200` without `Accept-Ranges`).
    pub ranges: bool,
    /// Per-connection throttle in bytes/s, 0 = unlimited (`throttle=2M`).
    pub throttle: u64,
    /// Throttle only the connection with this 0-based accept index (`slow_conn=1`) ...
    pub slow_conn: Option<u64>,
    /// ... to this rate in bytes/s (`slow_rate=64K`).
    pub slow_rate: u64,
    /// Drop the connection after sending this many body bytes of a response (`drop_after=1M`).
    pub drop_after: Option<u64>,
    /// Probability (0..1) of dropping the connection before each 64 KiB block (`drop_prob=0.01`).
    pub drop_prob: f64,
    /// Delay before the response headers (`ttfb_ms=500`).
    pub ttfb: Duration,
    /// Send an `ETag` (`etag=0` disables).
    pub etag: bool,
    /// Send the ETag as weak (`weak_etag=1`).
    pub weak_etag: bool,
    /// Send `Last-Modified` (`lm=0` disables).
    pub last_modified: bool,
    /// Raw `Content-Disposition` header value (`cd=attachment%3B%20filename%3D...`).
    pub content_disposition: Option<String>,
    /// `Content-Type` value (`type=application/zip`).
    pub content_type: String,
    /// Omit `Content-Length` and stream with chunked encoding (`chunked=1`, implies no ranges).
    pub chunked: bool,
    /// Authentication requirement (`auth=basic|digest`).
    pub auth: AuthMode,
    /// For `/expiring/...` routes: lifetime of the URL after its first request (`ttl_ms=2000`).
    pub ttl: Option<Duration>,
}

impl Default for FileOptions {
    fn default() -> Self {
        Self {
            size: 1 << 20,
            seed: 1,
            ranges: true,
            throttle: 0,
            slow_conn: None,
            slow_rate: 0,
            drop_after: None,
            drop_prob: 0.0,
            ttfb: Duration::ZERO,
            etag: true,
            weak_etag: false,
            last_modified: true,
            content_disposition: None,
            content_type: "application/octet-stream".into(),
            chunked: false,
            auth: AuthMode::None,
            ttl: None,
        }
    }
}

impl FileOptions {
    /// Applies query-string overrides. Unknown keys are ignored; malformed values are errors.
    pub fn apply_query(&mut self, query: &HashMap<String, String>) -> Result<(), String> {
        for (k, v) in query {
            match k.as_str() {
                "size" => self.size = parse_size(v)?,
                "seed" => self.seed = v.parse().map_err(|_| format!("bad seed {v:?}"))?,
                "ranges" => self.ranges = parse_bool(v)?,
                "throttle" => self.throttle = parse_size(v)?,
                "slow_conn" => {
                    self.slow_conn = Some(v.parse().map_err(|_| format!("bad slow_conn {v:?}"))?)
                }
                "slow_rate" => self.slow_rate = parse_size(v)?,
                "drop_after" => self.drop_after = Some(parse_size(v)?),
                "drop_prob" => {
                    self.drop_prob = v.parse().map_err(|_| format!("bad drop_prob {v:?}"))?
                }
                "ttfb_ms" => {
                    self.ttfb =
                        Duration::from_millis(v.parse().map_err(|_| format!("bad ttfb_ms {v:?}"))?)
                }
                "etag" => self.etag = parse_bool(v)?,
                "weak_etag" => self.weak_etag = parse_bool(v)?,
                "lm" => self.last_modified = parse_bool(v)?,
                "cd" => self.content_disposition = Some(v.clone()),
                "type" => self.content_type = v.clone(),
                "chunked" => self.chunked = parse_bool(v)?,
                "auth" => {
                    self.auth = match v.as_str() {
                        "basic" => AuthMode::Basic,
                        "digest" => AuthMode::Digest,
                        "none" => AuthMode::None,
                        other => return Err(format!("bad auth {other:?}")),
                    }
                }
                "ttl_ms" => {
                    self.ttl = Some(Duration::from_millis(
                        v.parse().map_err(|_| format!("bad ttl_ms {v:?}"))?,
                    ))
                }
                _ => {}
            }
        }
        if self.chunked {
            self.ranges = false;
        }
        Ok(())
    }
}

/// Server-wide configuration.
#[derive(Debug, Clone)]
pub struct ServerConfig {
    /// Bind address (default 127.0.0.1).
    pub bind: IpAddr,
    /// Port, 0 = pick a free port.
    pub port: u16,
    /// Maximum concurrent TCP connections; extra connections are refused per `limit_mode`.
    pub max_connections: Option<usize>,
    /// How extra connections are refused.
    pub limit_mode: LimitMode,
    /// User name for `auth=basic|digest` routes.
    pub username: String,
    /// Password for `auth=basic|digest` routes.
    pub password: String,
    /// Defaults for `/file/...` routes (overridable per request).
    pub file_defaults: FileOptions,
    /// Optional HLS fixture served under `/hls/`.
    pub hls: Option<HlsFixture>,
    /// Optional DASH fixture served under `/dash/`.
    pub dash: Option<DashFixture>,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            bind: IpAddr::V4(Ipv4Addr::LOCALHOST),
            port: 0,
            max_connections: None,
            limit_mode: LimitMode::default(),
            username: "user".into(),
            password: "pass".into(),
            file_defaults: FileOptions::default(),
            hls: None,
            dash: None,
        }
    }
}

/// Parses sizes such as `1024`, `64K`, `2M`, `1G`, `1.5M` (binary multiples).
pub fn parse_size(s: &str) -> Result<u64, String> {
    let s = s.trim();
    let (num, mult) = match s.chars().last().map(|c| c.to_ascii_uppercase()) {
        Some('K') => (&s[..s.len() - 1], 1u64 << 10),
        Some('M') => (&s[..s.len() - 1], 1 << 20),
        Some('G') => (&s[..s.len() - 1], 1 << 30),
        Some('T') => (&s[..s.len() - 1], 1 << 40),
        _ => (s, 1),
    };
    if let Ok(n) = num.parse::<u64>() {
        return n
            .checked_mul(mult)
            .ok_or_else(|| format!("size {s:?} overflows"));
    }
    let f: f64 = num.parse().map_err(|_| format!("bad size {s:?}"))?;
    if !(f.is_finite() && f >= 0.0) {
        return Err(format!("bad size {s:?}"));
    }
    Ok((f * mult as f64) as u64)
}

fn parse_bool(s: &str) -> Result<bool, String> {
    match s {
        "1" | "true" | "yes" | "on" => Ok(true),
        "0" | "false" | "no" | "off" => Ok(false),
        _ => Err(format!("bad boolean {s:?}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes() {
        assert_eq!(parse_size("10").unwrap(), 10);
        assert_eq!(parse_size("64K").unwrap(), 65536);
        assert_eq!(parse_size("2m").unwrap(), 2 << 20);
        assert_eq!(parse_size("1G").unwrap(), 1 << 30);
        assert_eq!(parse_size("1.5M").unwrap(), 3 << 19);
        assert!(parse_size("x").is_err());
    }
}
