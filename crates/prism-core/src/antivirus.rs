//! Post-download antivirus scan hook.

use crate::settings::{Antivirus, AntivirusKind};
use std::path::{Path, PathBuf};
use tokio::process::Command;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "result", rename_all = "lowercase")]
pub enum ScanResult {
    Clean,
    Infected {
        detail: String,
    },
    /// Scanner missing or crashed — the file is left untouched.
    Error {
        detail: String,
    },
    Skipped,
}

/// Locate the scanner for the configured kind.
fn scanner(cfg: &Antivirus) -> Option<(PathBuf, Vec<String>)> {
    let kind = match cfg.kind {
        AntivirusKind::Auto if cfg!(windows) => AntivirusKind::Defender,
        AntivirusKind::Auto => AntivirusKind::ClamAv,
        k => k,
    };
    match kind {
        AntivirusKind::Defender => defender_path().map(|p| {
            (
                p,
                [
                    "-Scan",
                    "-ScanType",
                    "3",
                    "-File",
                    "{file}",
                    "-DisableRemediation",
                ]
                .map(String::from)
                .to_vec(),
            )
        }),
        AntivirusKind::ClamAv => find_in_path(if cfg!(windows) {
            "clamscan.exe"
        } else {
            "clamscan"
        })
        .map(|p| (p, ["--no-summary", "{file}"].map(String::from).to_vec())),
        AntivirusKind::Custom => (!cfg.command.trim().is_empty())
            .then(|| (PathBuf::from(cfg.command.trim()), split_args(&cfg.args))),
        AntivirusKind::Auto => None,
    }
}

fn defender_path() -> Option<PathBuf> {
    if !cfg!(windows) {
        return None;
    }
    // The platform folder holds the most recent engine; fall back to the classic location.
    let platform = Path::new(r"C:\ProgramData\Microsoft\Windows Defender\Platform");
    let newest = std::fs::read_dir(platform)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path().join("MpCmdRun.exe"))
        .filter(|p| p.exists())
        .max();
    newest.or_else(|| {
        Some(PathBuf::from(
            r"C:\Program Files\Windows Defender\MpCmdRun.exe",
        ))
        .filter(|p| p.exists())
    })
}

fn find_in_path(exe: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|d| d.join(exe))
            .find(|p| p.is_file())
    })
}

/// Split a command-line argument string, honoring double quotes.
pub fn split_args(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    let mut has_token = false;
    for ch in s.chars() {
        match ch {
            '"' => {
                quoted = !quoted;
                has_token = true;
            }
            c if c.is_whitespace() && !quoted => {
                if has_token {
                    out.push(std::mem::take(&mut cur));
                    has_token = false;
                }
            }
            c => {
                cur.push(c);
                has_token = true;
            }
        }
    }
    if has_token {
        out.push(cur);
    }
    out
}

pub fn should_scan(cfg: &Antivirus, file: &Path) -> bool {
    if !cfg.enabled {
        return false;
    }
    if cfg.extensions.is_empty() {
        return true;
    }
    let ext = file
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    cfg.extensions
        .iter()
        .any(|e| e.trim_start_matches('.').eq_ignore_ascii_case(&ext))
}

pub async fn scan(cfg: &Antivirus, file: &Path) -> ScanResult {
    if !should_scan(cfg, file) {
        return ScanResult::Skipped;
    }
    let Some((exe, args)) = scanner(cfg) else {
        return ScanResult::Error {
            detail: "No antivirus scanner found".into(),
        };
    };
    let file_str = file.to_string_lossy();
    let args: Vec<String> = args
        .into_iter()
        .map(|a| a.replace("{file}", &file_str))
        .collect();
    let mut cmd = Command::new(&exe);
    cmd.args(&args);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    match cmd.output().await {
        Ok(out) => {
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
            let detail = text
                .lines()
                .filter(|l| !l.trim().is_empty())
                .take(6)
                .collect::<Vec<_>>()
                .join("\n");
            // Defender: 0 clean, 2 threat found. clamscan: 0 clean, 1 infected, 2 error.
            match out.status.code() {
                Some(0) => ScanResult::Clean,
                Some(1) if !matches!(cfg.kind, AntivirusKind::Defender) => {
                    ScanResult::Infected { detail }
                }
                Some(2) if is_defender(&exe) => ScanResult::Infected { detail },
                _ => ScanResult::Error { detail },
            }
        }
        Err(e) => ScanResult::Error {
            detail: format!("{}: {e}", exe.display()),
        },
    }
}

fn is_defender(exe: &Path) -> bool {
    exe.file_name()
        .is_some_and(|n| n.eq_ignore_ascii_case("MpCmdRun.exe"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_split_with_quotes() {
        assert_eq!(
            split_args(r#"--scan "{file}" -x"#),
            vec!["--scan", "{file}", "-x"]
        );
        assert_eq!(split_args(r#""a b" """#), vec!["a b", ""]);
    }

    #[test]
    fn extension_filter() {
        let cfg = Antivirus {
            enabled: true,
            extensions: vec!["exe".into(), ".msi".into()],
            ..Default::default()
        };
        assert!(should_scan(&cfg, Path::new("x/setup.EXE")));
        assert!(should_scan(&cfg, Path::new("x/setup.msi")));
        assert!(!should_scan(&cfg, Path::new("x/movie.mp4")));
    }
}
