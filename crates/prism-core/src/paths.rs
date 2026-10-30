//! Well-known locations of New Kewi Downloader's per-user data.
//!
//! The layout must stay in sync with `prism-native-host`, which reads `ipc.json`
//! from the same directory to find the running app.

use std::path::PathBuf;

/// Environment variable that overrides the data directory (tests, portable mode).
pub const DATA_DIR_ENV: &str = "NEWKEWI_DATA_DIR";

/// Per-user application data directory.
///
/// * Windows: `%APPDATA%\Prism`
/// * Linux:   `$XDG_DATA_HOME/newkewi` (default `~/.local/share/newkewi`)
/// * macOS:   `~/Library/Application Support/NewKewi`
///
/// A `portable.txt` file next to the executable switches to `<exe dir>/data`.
pub fn data_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os(DATA_DIR_ENV) {
        return PathBuf::from(dir);
    }
    if let Some(portable) = portable_dir() {
        return portable;
    }
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    if cfg!(target_os = "linux") {
        base.join("newkewi")
    } else {
        base.join("NewKewi")
    }
}

fn portable_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    dir.join("portable.txt").exists().then(|| dir.join("data"))
}

pub fn database_path() -> PathBuf {
    data_dir().join("newkewi.db")
}

pub fn ipc_file() -> PathBuf {
    data_dir().join("ipc.json")
}

pub fn logs_dir() -> PathBuf {
    data_dir().join("logs")
}

/// Directory for managed tools (yt-dlp, ffmpeg).
pub fn tools_dir() -> PathBuf {
    data_dir().join("tools")
}

/// Default folder for finished downloads (`~/Downloads/NewKewi` style is avoided:
/// IDM users expect category sub-folders directly under Downloads).
pub fn default_download_dir() -> PathBuf {
    dirs::download_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Downloads")))
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn ensure_dirs() -> std::io::Result<()> {
    std::fs::create_dir_all(data_dir())?;
    std::fs::create_dir_all(logs_dir())?;
    std::fs::create_dir_all(tools_dir())?;
    Ok(())
}
