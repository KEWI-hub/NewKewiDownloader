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

/// Picture size of the first video stream in `sample` (the start of a media segment), as
/// ffmpeg reads it. `None` when ffmpeg can't run or finds no video in it.
pub(crate) async fn picture_size(ffmpeg: &Path, sample: &[u8]) -> Option<(u64, u64)> {
    use tokio::io::AsyncWriteExt;
    let mut child = command(ffmpeg)
        .args(["-hide_banner", "-nostdin", "-i", "pipe:0"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let mut stdin = child.stdin.take()?;
    // ffmpeg may stop reading once it has seen the stream: a broken pipe is fine.
    let _ = stdin.write_all(sample).await;
    drop(stdin);
    // Without an output ffmpeg exits non-zero, after listing the input's streams.
    let output = child.wait_with_output().await.ok()?;
    parse_picture_size(&String::from_utf8_lossy(&output.stderr))
}

/// Size from ffmpeg's stream listing: `Stream #0:0[0x100]: Video: h264 (High) ([27][0][0][0] /
/// 0x001B), yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 30 fps, …`.
fn parse_picture_size(log: &str) -> Option<(u64, u64)> {
    log.lines()
        .filter(|l| l.contains("Stream #") && l.contains("Video:"))
        .find_map(|l| {
            l.split([',', ' ']).find_map(|tok| {
                let (w, h) = tok.split_once('x')?;
                let (w, h) = (w.parse::<u64>().ok()?, h.parse::<u64>().ok()?);
                // Codec tags such as `0x001B` parse too; no real picture is that shape.
                ((16..=16384).contains(&w) && (16..=16384).contains(&h)).then_some((w, h))
            })
        })
}

#[cfg(test)]
mod tests {
    use super::parse_picture_size;

    #[test]
    fn picture_size_comes_from_the_video_stream_line() {
        let log = "Input #0, mpegts, from 'pipe:0':\n  Duration: N/A, start: 1.400000, bitrate: N/A\n  \
            Program 1 \n  Stream #0:0[0x100]: Video: h264 (High) ([27][0][0][0] / 0x001B), \
            yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 30 fps, 30 tbr, 90k tbn\n  \
            Stream #0:1[0x101]: Audio: aac (LC) ([15][0][0][0] / 0x000F), 48000 Hz, stereo, fltp\n\
            At least one output file must be specified\n";
        assert_eq!(parse_picture_size(log), Some((1920, 1080)));
    }

    #[test]
    fn no_video_stream_means_no_size() {
        let log = "  Stream #0:0[0x101]: Audio: aac (LC) ([15][0][0][0] / 0x000F), 48000 Hz, stereo\n";
        assert_eq!(parse_picture_size(log), None);
        assert_eq!(parse_picture_size("pipe:0: Invalid data found when processing input"), None);
    }
}
