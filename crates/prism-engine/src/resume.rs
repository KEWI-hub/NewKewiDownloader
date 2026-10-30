//! Persistable resume state.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use url::Url;

use crate::error::EngineError;

/// Current [`ResumeState::version`].
pub const RESUME_STATE_VERSION: u32 = 1;

/// Protocol family of a resume state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResumeKind {
    /// HTTP(S).
    Http,
    /// FTP(S).
    Ftp,
    /// HLS or DASH.
    Media,
}

/// One byte range of the part file: `[start, end)`, bytes `[start, pos)` are on disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SegmentState {
    /// First byte.
    pub start: u64,
    /// First byte not yet on disk.
    pub pos: u64,
    /// End (exclusive).
    pub end: u64,
}

/// Resume data of an HLS/DASH job.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaResumeState {
    /// `"hls"` or `"dash"`.
    pub kind: String,
    /// Resolved media playlist / representation identifiers per track (validated on resume).
    pub tracks: Vec<String>,
    /// Number of media segments per track (validated on resume).
    pub segment_counts: Vec<u32>,
    /// Global indices (track-major) of segments that are complete and on disk.
    pub completed: Vec<u32>,
    /// Directory holding the downloaded segment files.
    pub work_dir: PathBuf,
}

/// Everything needed to resume a download in a new process. Produced by
/// [`crate::DownloadHandle::checkpoint`] (durable) or [`crate::DownloadHandle::resume_state`]
/// (in-memory view) and accepted by [`crate::Engine::start`] / [`crate::Engine::start_media`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResumeState {
    /// Format version.
    pub version: u32,
    /// Protocol family.
    pub kind: ResumeKind,
    /// Original URL (refreshed by `change_url`).
    pub url: Url,
    /// URL after redirects (may be expired; the engine falls back to `url`).
    pub final_url: Option<Url>,
    /// The in-progress file (`<final>.prismpart`, or the media work directory marker).
    pub part_path: PathBuf,
    /// Intended final path.
    pub final_path: PathBuf,
    /// Total size if known.
    pub total_size: Option<u64>,
    /// `ETag` of the resource.
    pub etag: Option<String>,
    /// `Last-Modified` of the resource.
    pub last_modified: Option<String>,
    /// Whether byte-range resume is possible; if `false` a resume restarts from zero.
    pub resumable: bool,
    /// Segments partitioning `[0, total_size)`.
    pub segments: Vec<SegmentState>,
    /// Media (HLS/DASH) details.
    #[serde(default)]
    pub media: Option<MediaResumeState>,
}

impl ResumeState {
    /// Bytes recorded as downloaded.
    pub fn downloaded(&self) -> u64 {
        self.segments
            .iter()
            .map(|s| s.pos.saturating_sub(s.start))
            .sum()
    }

    /// Serializes to JSON.
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("ResumeState is always serializable")
    }

    /// Parses JSON produced by [`ResumeState::to_json`].
    pub fn from_json(s: &str) -> Result<Self, EngineError> {
        serde_json::from_str(s).map_err(|e| EngineError::InvalidResumeState {
            message: e.to_string(),
        })
    }

    /// Returns a copy pointing at a new address (the next start validates size/validators).
    pub fn with_url(mut self, url: Url) -> Self {
        self.url = url;
        self.final_url = None;
        self
    }

    /// Checks internal consistency: segments sorted, non-overlapping, covering `[0, total)`,
    /// `start <= pos <= end`.
    pub fn validate(&self) -> Result<(), EngineError> {
        let bad = |m: &str| {
            Err(EngineError::InvalidResumeState {
                message: m.to_string(),
            })
        };
        if self.version > RESUME_STATE_VERSION {
            return bad("state was written by a newer version");
        }
        if self.kind == ResumeKind::Media {
            return if self.media.is_some() {
                Ok(())
            } else {
                bad("media state missing")
            };
        }
        if !self.resumable {
            return Ok(());
        }
        let Some(total) = self.total_size else {
            return bad("resumable state without a size");
        };
        let mut segs = self.segments.clone();
        segs.sort_by_key(|s| s.start);
        let mut expect = 0u64;
        for s in &segs {
            if s.start != expect {
                return bad("segments do not partition the file");
            }
            if !(s.start <= s.pos && s.pos <= s.end) {
                return bad("segment position out of range");
            }
            expect = s.end;
        }
        if expect != total {
            return bad("segments do not cover the whole file");
        }
        Ok(())
    }

    /// Checks that the part file exists and has the expected length (the engine pre-allocates
    /// it to the total size). Returns the error describing what does not match.
    pub fn verify_against_disk(&self) -> Result<(), EngineError> {
        self.validate()?;
        if self.kind == ResumeKind::Media {
            let dir = &self.media.as_ref().expect("validated").work_dir;
            return if dir.is_dir() {
                Ok(())
            } else {
                Err(EngineError::InvalidResumeState {
                    message: format!("{} is missing", dir.display()),
                })
            };
        }
        let meta =
            std::fs::metadata(&self.part_path).map_err(|e| EngineError::InvalidResumeState {
                message: format!("{}: {e}", self.part_path.display()),
            })?;
        if let (true, Some(total)) = (self.resumable, self.total_size)
            && meta.len() != total
        {
            return Err(EngineError::InvalidResumeState {
                message: format!("part file has {} bytes, expected {total}", meta.len()),
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> ResumeState {
        ResumeState {
            version: RESUME_STATE_VERSION,
            kind: ResumeKind::Http,
            url: Url::parse("http://h/a").unwrap(),
            final_url: Some(Url::parse("http://h/b").unwrap()),
            part_path: "a.prismpart".into(),
            final_path: "a".into(),
            total_size: Some(100),
            etag: Some("\"x\"".into()),
            last_modified: None,
            resumable: true,
            segments: vec![
                SegmentState {
                    start: 0,
                    pos: 10,
                    end: 50,
                },
                SegmentState {
                    start: 50,
                    pos: 100,
                    end: 100,
                },
            ],
            media: None,
        }
    }

    #[test]
    fn json_roundtrip_and_validation() {
        let s = sample();
        let back = ResumeState::from_json(&s.to_json()).unwrap();
        assert_eq!(back, s);
        assert_eq!(s.downloaded(), 60);
        s.validate().unwrap();

        let mut gap = sample();
        gap.segments[1].start = 60;
        assert!(gap.validate().is_err());
        let mut short = sample();
        short.total_size = Some(200);
        assert!(short.validate().is_err());
        let mut bad_pos = sample();
        bad_pos.segments[0].pos = 70;
        assert!(bad_pos.validate().is_err());
        assert!(ResumeState::from_json("{").is_err());
    }

    #[test]
    fn disk_verification() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = sample();
        s.part_path = dir.path().join("a.prismpart");
        assert!(s.verify_against_disk().is_err());
        std::fs::write(&s.part_path, vec![0u8; 100]).unwrap();
        s.verify_against_disk().unwrap();
        std::fs::write(&s.part_path, vec![0u8; 99]).unwrap();
        assert!(s.verify_against_disk().is_err());
    }
}
