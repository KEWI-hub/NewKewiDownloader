//! ffmpeg invocation for remuxing/muxing media tracks into MP4.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use crate::error::EngineError;

/// The ffmpeg executable to use.
pub(crate) fn ffmpeg_path(configured: Option<&Path>) -> PathBuf {
    configured
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("ffmpeg"))
}

fn command(ffmpeg: &Path) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(ffmpeg);
    cmd.stdin(Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: no console window flashing up from a GUI app.
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

/// Whether ffmpeg can be executed.
pub(crate) async fn available(ffmpeg: &Path) -> bool {
    command(ffmpeg)
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .is_ok_and(|s| s.success())
}

/// Muxes one track (video, possibly with audio) or two tracks (video + separate audio) into
/// an MP4 at `out` without re-encoding.
pub(crate) async fn mux(ffmpeg: &Path, inputs: &[PathBuf], out: &Path) -> Result<(), EngineError> {
    let mut cmd = command(ffmpeg);
    cmd.args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y"]);
    for i in inputs {
        cmd.arg("-i").arg(i);
    }
    match inputs.len() {
        1 => cmd.args(["-map", "0:v?", "-map", "0:a?"]),
        _ => cmd.args(["-map", "0:v?", "-map", "1:a?"]),
    };
    cmd.args(["-c", "copy", "-movflags", "+faststart", "-f", "mp4"])
        .arg(out);
    let output = cmd
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| EngineError::Remux {
            message: format!("cannot run {}: {e}", ffmpeg.display()),
        })?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let tail: String = err
            .lines()
            .rev()
            .take(5)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join(" | ");
        let _ = std::fs::remove_file(out);
        return Err(EngineError::Remux {
            message: format!("exit {}: {tail}", output.status),
        });
    }
    Ok(())
}
