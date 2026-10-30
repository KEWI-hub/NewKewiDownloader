//! Tiny rotating file logger (`<data dir>/logs/native-host.log`, rotated to
//! `.log.1` at 1 MiB). Never writes to stdout — stdout carries protocol frames.
//! Debug lines are only written when `PRISM_HOST_DEBUG=1`.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_LOG_BYTES: u64 = 1024 * 1024;

struct Logger {
    path: Option<PathBuf>,
    debug: bool,
    lock: Mutex<()>,
}

static LOGGER: OnceLock<Logger> = OnceLock::new();

fn logger() -> &'static Logger {
    LOGGER.get_or_init(|| Logger {
        path: crate::paths::logs_dir().map(|d| d.join("native-host.log")),
        debug: std::env::var(crate::paths::DEBUG_ENV)
            .is_ok_and(|v| v == "1" || v.eq_ignore_ascii_case("true")),
        lock: Mutex::new(()),
    })
}

/// Whether debug logging is enabled.
pub fn debug_enabled() -> bool {
    logger().debug
}

/// Writes one line at `level`. Errors are swallowed (logging must never break the host).
pub fn log(level: &str, msg: &str) {
    let l = logger();
    if level == "DEBUG" && !l.debug {
        return;
    }
    let Some(path) = &l.path else { return };
    let _g = l.lock.lock();
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if fs::metadata(path)
        .map(|m| m.len() > MAX_LOG_BYTES)
        .unwrap_or(false)
    {
        let _ = fs::rename(path, path.with_extension("log.1"));
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        let ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let _ = writeln!(
            f,
            "{} [{}] {level} {msg}",
            utc_timestamp(ms),
            std::process::id()
        );
    }
}

#[macro_export]
macro_rules! log_info { ($($t:tt)*) => { $crate::logger::log("INFO", &format!($($t)*)) } }
#[macro_export]
macro_rules! log_error { ($($t:tt)*) => { $crate::logger::log("ERROR", &format!($($t)*)) } }
#[macro_export]
macro_rules! log_debug { ($($t:tt)*) => { if $crate::logger::debug_enabled() { $crate::logger::log("DEBUG", &format!($($t)*)) } } }

/// `2026-10-15T16:31:27.097Z` from milliseconds since the Unix epoch (no date crate needed).
fn utc_timestamp(ms: u128) -> String {
    let secs = (ms / 1000) as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60,
        ms % 1000
    )
}

#[cfg(test)]
mod time_tests {
    #[test]
    fn formats_utc() {
        assert_eq!(super::utc_timestamp(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            super::utc_timestamp(1_792_080_687_097),
            "2026-10-15T16:11:27.097Z"
        );
        assert_eq!(
            super::utc_timestamp(951_782_400_000),
            "2000-02-29T00:00:00.000Z"
        );
    }
}
