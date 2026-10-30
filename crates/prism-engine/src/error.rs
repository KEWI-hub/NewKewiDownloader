//! Engine error type and its classification.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Every error the engine reports. Cloneable and serializable so it can be stored and forwarded
/// to the UI; [`EngineError::user_message`] gives a human-readable sentence.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EngineError {
    /// The server answered with an unexpected HTTP status.
    #[error("server responded with HTTP {status}")]
    Http {
        /// HTTP status code.
        status: u16,
    },
    /// Connection-level failure (DNS, refused, reset, TLS, protocol error).
    #[error("network error: {message}")]
    Network {
        /// Details.
        message: String,
    },
    /// No data arrived within the configured read/connect timeout.
    #[error("connection timed out")]
    Timeout,
    /// Local file-system failure.
    #[error("disk error: {message}")]
    Io {
        /// Details.
        message: String,
    },
    /// Not enough free space on the destination volume.
    #[error("not enough disk space: {needed} bytes needed, {available} available")]
    NoSpace {
        /// Bytes required.
        needed: u64,
        /// Bytes available.
        available: u64,
    },
    /// The remote resource changed since the download started (ETag/Last-Modified/size/content).
    #[error("the file on the server has changed since the download started")]
    ValidatorMismatch,
    /// An operation needed byte ranges, but the server does not support them.
    #[error("the server does not support resuming (byte ranges)")]
    RangeNotSupported,
    /// The server requires (different) credentials.
    #[error("authentication required")]
    AuthRequired,
    /// The (signed/temporary) download link is no longer valid; refresh the address.
    #[error("the download link has expired")]
    LinkExpired,
    /// The site answered with a bot check (Cloudflare's "Just a moment...") that only a web
    /// browser can pass.
    #[error("the site only lets a web browser download this file")]
    BrowserCheck,
    /// A web page came back where a file was expected (an error or check page).
    #[error("the server sent a web page instead of the file")]
    WebPage,
    /// Checksum verification failed after completion. The file is kept at `path`.
    #[error("checksum mismatch: expected {expected}, got {actual}")]
    ChecksumMismatch {
        /// Expected hex digest.
        expected: String,
        /// Computed hex digest.
        actual: String,
        /// Path of the downloaded file.
        path: PathBuf,
    },
    /// The download was cancelled.
    #[error("download cancelled")]
    Cancelled,
    /// The download was paused; resume it with the state from `pause()`/`checkpoint()`.
    #[error("download paused")]
    Paused,
    /// The URL is malformed or uses an unsupported scheme.
    #[error("invalid URL: {message}")]
    InvalidUrl {
        /// Details.
        message: String,
    },
    /// The destination file exists and the conflict policy is `Fail`.
    #[error("file already exists: {}", path.display())]
    FileExists {
        /// The existing path.
        path: PathBuf,
    },
    /// Permanent FTP failure (e.g. `550` file not found). Temporary FTP failures are reported
    /// as [`EngineError::Network`].
    #[error("FTP error: {message}")]
    Ftp {
        /// Details.
        message: String,
    },
    /// HLS playlist/segment failure.
    #[error("HLS error: {message}")]
    Hls {
        /// Details.
        message: String,
    },
    /// DASH manifest/segment failure.
    #[error("DASH error: {message}")]
    Dash {
        /// Details.
        message: String,
    },
    /// ffmpeg remux/mux failure.
    #[error("ffmpeg failed: {message}")]
    Remux {
        /// Details.
        message: String,
    },
    /// The resource uses a feature the engine does not implement (e.g. DRM, live streams).
    #[error("unsupported: {message}")]
    Unsupported {
        /// Details.
        message: String,
    },
    /// The resume state is inconsistent or does not match the files on disk.
    #[error("invalid resume state: {message}")]
    InvalidResumeState {
        /// Details.
        message: String,
    },
    /// Internal invariant violation (a bug).
    #[error("internal error: {message}")]
    Internal {
        /// Details.
        message: String,
    },
}

impl EngineError {
    /// `true` if retrying the same operation later may succeed (network hiccups, timeouts,
    /// `5xx`, `408`, `429`). Fatal errors (`404`, auth, disk full, validator mismatch, …) are
    /// not transient.
    pub fn is_transient(&self) -> bool {
        match self {
            EngineError::Http { status } => {
                matches!(*status, 408 | 425 | 429 | 500..=599)
            }
            EngineError::Network { .. } | EngineError::Timeout => true,
            _ => false,
        }
    }

    /// A short sentence suitable for showing to end users.
    pub fn user_message(&self) -> String {
        match self {
            EngineError::Http { status: 401 } | EngineError::AuthRequired => {
                "The server requires a user name and password (or the given ones were rejected).".into()
            }
            EngineError::Http { status: 403 } => "Access to the file was denied by the server (HTTP 403).".into(),
            EngineError::Http { status: 404 } => "The file was not found on the server (HTTP 404).".into(),
            EngineError::Http { status: 410 } => "The file is no longer available on the server (HTTP 410).".into(),
            EngineError::Http { status } if (500..=599).contains(status) => {
                format!("The server reported an internal error (HTTP {status}). Try again later.")
            }
            EngineError::Http { status } => format!("The server responded with HTTP {status}."),
            EngineError::Network { message } => format!("Network problem: {message}."),
            EngineError::Timeout => "The connection timed out. Check your network and try again.".into(),
            EngineError::Io { message } => format!("Could not write the file: {message}."),
            EngineError::NoSpace { needed, available } => format!(
                "Not enough disk space ({} MiB needed, {} MiB free).",
                needed.div_ceil(1 << 20),
                available / (1 << 20)
            ),
            EngineError::ValidatorMismatch => {
                "The file on the server has changed since the download started. Restart the download.".into()
            }
            EngineError::RangeNotSupported => "The server does not support resuming this download.".into(),
            EngineError::LinkExpired => {
                "The download link has expired. Refresh the download address from the web page.".into()
            }
            EngineError::BrowserCheck => {
                "This site lets only a web browser download the file (it checks for robots). Download it in your browser.".into()
            }
            EngineError::WebPage => {
                "The server sent a web page instead of the file. The link may have expired or may only work in the browser.".into()
            }
            EngineError::ChecksumMismatch { .. } => {
                "The downloaded file does not match the expected checksum; it may be corrupted.".into()
            }
            EngineError::Cancelled => "The download was cancelled.".into(),
            EngineError::Paused => "The download is paused.".into(),
            EngineError::InvalidUrl { message } => format!("The address is not valid: {message}."),
            EngineError::FileExists { path } => format!("The file {} already exists.", path.display()),
            EngineError::Ftp { message } => format!("FTP error: {message}."),
            EngineError::Hls { message } => format!("Could not download the HLS stream: {message}."),
            EngineError::Dash { message } => format!("Could not download the DASH stream: {message}."),
            EngineError::Remux { message } => format!("Could not merge the video: {message}."),
            EngineError::Unsupported { message } => format!("This download is not supported: {message}."),
            EngineError::InvalidResumeState { message } => {
                format!("The saved download state is not usable ({message}); restart the download.")
            }
            EngineError::Internal { message } => format!("Internal error: {message}."),
        }
    }

    pub(crate) fn network(e: impl std::fmt::Display) -> Self {
        EngineError::Network {
            message: e.to_string(),
        }
    }

    pub(crate) fn internal(e: impl std::fmt::Display) -> Self {
        EngineError::Internal {
            message: e.to_string(),
        }
    }

    /// Maps an I/O error from the destination file system (detects "disk full").
    pub(crate) fn from_io(e: &std::io::Error, needed: u64) -> Self {
        if is_no_space(e) {
            EngineError::NoSpace {
                needed,
                available: 0,
            }
        } else {
            EngineError::Io {
                message: e.to_string(),
            }
        }
    }
}

/// `true` for "disk full"/"quota exceeded" errors on all supported platforms.
pub(crate) fn is_no_space(e: &std::io::Error) -> bool {
    if e.kind() == std::io::ErrorKind::StorageFull || e.kind() == std::io::ErrorKind::QuotaExceeded
    {
        return true;
    }
    match e.raw_os_error() {
        // ERROR_HANDLE_DISK_FULL (39), ERROR_DISK_FULL (112)
        #[cfg(windows)]
        Some(39) | Some(112) => true,
        // ENOSPC, EDQUOT
        #[cfg(unix)]
        Some(28) | Some(122) => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transient_classification() {
        assert!(EngineError::Http { status: 503 }.is_transient());
        assert!(EngineError::Http { status: 429 }.is_transient());
        assert!(EngineError::Http { status: 408 }.is_transient());
        assert!(!EngineError::Http { status: 404 }.is_transient());
        assert!(!EngineError::Http { status: 410 }.is_transient());
        assert!(EngineError::Timeout.is_transient());
        assert!(EngineError::network("reset").is_transient());
        assert!(!EngineError::ValidatorMismatch.is_transient());
        assert!(
            !EngineError::NoSpace {
                needed: 1,
                available: 0
            }
            .is_transient()
        );
        assert!(!EngineError::AuthRequired.is_transient());
        assert!(!EngineError::Cancelled.is_transient());
        assert!(
            !EngineError::Ftp {
                message: "550 not found".into()
            }
            .is_transient()
        );
    }

    #[test]
    fn messages_and_serde() {
        let e = EngineError::Http { status: 404 };
        assert!(e.user_message().contains("not found"));
        let json = serde_json::to_string(&e).unwrap();
        assert_eq!(json, r#"{"kind":"http","status":404}"#);
        let back: EngineError = serde_json::from_str(&json).unwrap();
        assert_eq!(back, e);
    }

    #[test]
    fn no_space_detection() {
        let e = std::io::Error::from(std::io::ErrorKind::StorageFull);
        assert!(is_no_space(&e));
        assert!(matches!(
            EngineError::from_io(&e, 5),
            EngineError::NoSpace { needed: 5, .. }
        ));
        let e = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        assert!(!is_no_space(&e));
    }
}
