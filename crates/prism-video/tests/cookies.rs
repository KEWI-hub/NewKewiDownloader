//! "Cookies from browser" that yt-dlp can't read (Chrome / Edge on Windows lock and encrypt
//! them) must not break every video: Prism retries without them and explains the failure.

mod common;

use std::path::{Path, PathBuf};

use prism_video::{Probe, RequestContext, VideoOptions, VideoService};

/// A stand-in yt-dlp: fails like a locked Chrome cookie store whenever it gets
/// `--cookies-from-browser`; otherwise prints a probe result, or a sign-in error when the
/// directory holds a `needs-login` file.
fn fake_ytdlp(dir: &Path, needs_login: bool) -> PathBuf {
    let json: serde_json::Value =
        serde_json::from_str(&common::fixture("generic_direct.json")).unwrap();
    std::fs::write(dir.join("probe.json"), json.to_string()).unwrap();
    if needs_login {
        std::fs::write(dir.join("needs-login"), "").unwrap();
    }
    #[cfg(windows)]
    {
        let exe = dir.join("yt-dlp.cmd");
        std::fs::write(
            &exe,
            "@echo off\r\n\
             echo %* | findstr /C:\"--cookies-from-browser\" >nul && (echo ERROR: Could not copy Chrome cookie database. See  https://github.com/yt-dlp/yt-dlp/issues/7271  for more info 1>&2& exit /b 1)\r\n\
             if exist \"%~dp0needs-login\" (echo ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users. 1>&2& exit /b 1)\r\n\
             type \"%~dp0probe.json\"\r\n",
        )
        .unwrap();
        exe
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let exe = dir.join("yt-dlp");
        std::fs::write(
            &exe,
            "#!/bin/sh\n\
             case \" $* \" in *\" --cookies-from-browser \"*) echo 'ERROR: Could not copy Chrome cookie database. See  https://github.com/yt-dlp/yt-dlp/issues/7271  for more info' >&2; exit 1;; esac\n\
             d=$(dirname \"$0\")\n\
             if [ -e \"$d/needs-login\" ]; then echo 'ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.' >&2; exit 1; fi\n\
             cat \"$d/probe.json\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
        exe
    }
}

fn service(dir: &Path, needs_login: bool, browser: Option<&str>) -> VideoService {
    let exe = fake_ytdlp(dir, needs_login);
    VideoService::new(
        dir.join("tools"),
        VideoOptions {
            ytdlp_path: Some(exe),
            cookies_from_browser: browser.map(String::from),
            ..Default::default()
        },
    )
}

#[tokio::test]
async fn unreadable_browser_cookies_do_not_break_a_public_video() {
    let dir = tempfile::tempdir().unwrap();
    let svc = service(dir.path(), false, Some("chrome"));
    let probe = svc
        .probe("https://example.com/video", &RequestContext::default())
        .await
        .expect("the retry without browser cookies succeeds");
    assert!(matches!(probe, Probe::Video(v) if v.title == "Big_Buck_Bunny_360_10s_1MB"));
}

#[tokio::test]
async fn a_video_that_needs_the_cookies_explains_why_they_were_missing() {
    let dir = tempfile::tempdir().unwrap();
    let svc = service(dir.path(), true, Some("chrome"));
    let err = svc
        .probe("https://example.com/video", &RequestContext::default())
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("Sign in to confirm your age"), "{err}");
    assert!(
        err.contains("Could not copy Chrome cookie database"),
        "{err}"
    );
    assert!(
        err.contains("Chrome, Edge and other Chromium browsers on Windows lock and encrypt them"),
        "{err}"
    );
    // Not the generic advice to pick a browser: one is picked and can't be read.
    assert!(!err.contains("then choose that browser"), "{err}");
}

#[tokio::test]
async fn without_the_setting_errors_are_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let svc = service(dir.path(), true, None);
    let err = svc
        .probe("https://example.com/video", &RequestContext::default())
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("Sign in to confirm your age"), "{err}");
    assert!(!err.contains("tried without browser cookies"), "{err}");
    assert!(err.contains("then choose that browser"), "{err}");
}
