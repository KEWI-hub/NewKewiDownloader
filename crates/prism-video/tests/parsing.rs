//! Progress-line, checksum, version, SponsorBlock and FFMETADATA parsing/generation.

use prism_video::Chapter;
use prism_video::ffmpeg::{Metadata, ffmetadata, iso639_2};
use prism_video::progress::{
    FfmpegProgress, LineEvent, Stage, parse_clock, parse_line, parse_size,
};
use prism_video::sponsorblock::{SponsorSegment, merge_into_chapters, parse_segments, request_url};
use prism_video::tools::{
    Tool, parse_checksums, parse_single_checksum, parse_version, sha256_hex, tag_from_location,
};

// Lines captured from a real yt-dlp 2026.10.10 run with our templates.
const DL_LINE: &str = r#"PRISM {"status": "downloading", "downloaded_bytes": 1024, "total_bytes": 3871021, "tmpfilename": "dl\\Big Buck Bunny [aqz-KE-bpKQ].m4a.part", "filename": "dl\\Big Buck Bunny [aqz-KE-bpKQ].m4a", "eta": 21, "speed": 184270.09164235456, "elapsed": 0.159, "ctx_id": null, "_eta_str": "00:21", "_percent": 0.026452969384562885, "_default_template": "  0.0% of    3.69MiB at  179.95KiB/s ETA 00:21"}"#;
const DL_DONE: &str = r#"PRISM {"downloaded_bytes": 3871021, "total_bytes": 3871021, "filename": "dl\\x.m4a", "status": "finished", "elapsed": 0.507, "ctx_id": null, "speed": 7630761.75}"#;
const FRAG_LINE: &str = r#"PRISM {"status": "downloading", "downloaded_bytes": 5242880, "total_bytes_estimate": 52428800.5, "fragment_index": 5, "fragment_count": 50, "speed": null, "eta": null, "filename": "v.mp4"}"#;
const PP_LINE: &str = r#"PRISMPP {"status": "started", "postprocessor": "ExtractAudio", "_default_template": "ExtractAudio started"}"#;

#[test]
fn progress_template_lines() {
    let Some(LineEvent::Progress(p)) = parse_line(DL_LINE) else {
        panic!()
    };
    assert_eq!(p.stage, Stage::Downloading);
    assert_eq!(p.downloaded, Some(1024));
    assert_eq!(p.total, Some(3_871_021));
    assert!(!p.total_is_estimate);
    assert_eq!(p.eta, Some(21));
    assert!((p.speed.unwrap() - 184_270.09).abs() < 0.1);
    assert_eq!(
        p.filename.as_deref(),
        Some("dl\\Big Buck Bunny [aqz-KE-bpKQ].m4a")
    );
    assert_eq!(p.status.as_deref(), Some("downloading"));
    assert!(p.percent.unwrap() < 0.1);

    let Some(LineEvent::Progress(p)) = parse_line(DL_DONE) else {
        panic!()
    };
    assert_eq!(p.percent, Some(100.0));
    assert_eq!(p.status.as_deref(), Some("finished"));

    let Some(LineEvent::Progress(p)) = parse_line(FRAG_LINE) else {
        panic!()
    };
    assert_eq!(p.total, Some(52_428_800));
    assert!(p.total_is_estimate);
    assert_eq!((p.fragment_index, p.fragment_count), (Some(5), Some(50)));
    assert_eq!(p.speed, None);
    assert_eq!(p.percent, Some(10.0));

    let Some(LineEvent::Progress(p)) = parse_line(PP_LINE) else {
        panic!()
    };
    assert_eq!(p.stage, Stage::ExtractingAudio);
    assert_eq!(p.postprocessor.as_deref(), Some("ExtractAudio"));
    assert_eq!(p.status.as_deref(), Some("started"));

    let Some(LineEvent::Progress(p)) =
        parse_line(r#"PRISMPP {"status": "started", "postprocessor": "Merger"}"#)
    else {
        panic!()
    };
    assert_eq!(p.stage, Stage::Merging);
    let Some(LineEvent::Progress(p)) =
        parse_line(r#"PRISMPP {"status": "finished", "postprocessor": "MoveFiles"}"#)
    else {
        panic!()
    };
    assert_eq!(p.stage, Stage::Moving);
    let Some(LineEvent::Progress(p)) =
        parse_line(r#"PRISMPP {"status": "started", "postprocessor": "FFmpegMetadata"}"#)
    else {
        panic!()
    };
    assert_eq!(p.stage, Stage::EmbeddingMetadata);

    assert_eq!(
        parse_line("PRISMFILE C:\\Users\\me\\Videos\\Big Buck Bunny [aqz-KE-bpKQ].mp3\r"),
        Some(LineEvent::FinalPath(
            "C:\\Users\\me\\Videos\\Big Buck Bunny [aqz-KE-bpKQ].mp3".into()
        ))
    );
    assert_eq!(
        parse_line("ERROR: unable to download video data: HTTP Error 403: Forbidden"),
        Some(LineEvent::Error(
            "unable to download video data: HTTP Error 403: Forbidden".into()
        ))
    );
    assert!(matches!(
        parse_line("WARNING: [youtube] something"),
        Some(LineEvent::Warning(_))
    ));
    assert_eq!(parse_line("PRISM {not json"), None);
    assert_eq!(parse_line("random noise"), None);
}

#[test]
fn classic_lines() {
    let Some(LineEvent::Progress(p)) =
        parse_line("[Merger] Merging formats into \"out\\Video [id].mp4\"")
    else {
        panic!()
    };
    assert_eq!(p.stage, Stage::Merging);
    assert_eq!(p.filename.as_deref(), Some("out\\Video [id].mp4"));
    let Some(LineEvent::Progress(p)) = parse_line("[ExtractAudio] Destination: out/a.mp3") else {
        panic!()
    };
    assert_eq!(p.stage, Stage::ExtractingAudio);
    assert_eq!(p.filename.as_deref(), Some("out/a.mp3"));
    let Some(LineEvent::Progress(p)) =
        parse_line("[EmbedThumbnail] ffmpeg: Adding thumbnail to \"a.mp4\"")
    else {
        panic!()
    };
    assert_eq!(p.stage, Stage::EmbeddingThumbnail);
    let Some(LineEvent::Progress(p)) = parse_line("[SponsorBlock] Fetching SponsorBlock segments")
    else {
        panic!()
    };
    assert_eq!(p.stage, Stage::SponsorBlock);
    let Some(LineEvent::Progress(p)) =
        parse_line("[download]  45.3% of ~ 10.00MiB at  1.00MiB/s ETA 00:05 (frag 3/20)")
    else {
        panic!()
    };
    assert_eq!(p.percent, Some(45.3));
    assert_eq!(p.total, Some(10 * 1024 * 1024));
    assert!(p.total_is_estimate);
    assert_eq!(p.speed, Some(1024.0 * 1024.0));
    assert_eq!(p.eta, Some(5));
    assert_eq!((p.fragment_index, p.fragment_count), (Some(3), Some(20)));
    let Some(LineEvent::Progress(p)) =
        parse_line("[download] 100% of    3.69MiB in 00:00:00 at 7.28MiB/s")
    else {
        panic!()
    };
    assert_eq!(p.percent, Some(100.0));
    let Some(LineEvent::Progress(p)) = parse_line("[download] Destination: dl\\x.m4a") else {
        panic!()
    };
    assert_eq!(p.filename.as_deref(), Some("dl\\x.m4a"));
    assert_eq!(
        parse_line("[youtube] aqz-KE-bpKQ: Downloading webpage"),
        None
    );
    assert_eq!(parse_size("3.69MiB"), Some((3.69 * 1048576.0) as u64));
    assert_eq!(parse_clock("01:02:03"), Some(3723));
}

#[test]
fn ffmpeg_progress_parser() {
    let mut p = FfmpegProgress::default();
    let block = "frame=10\nfps=0.0\nout_time_us=2500000\nout_time_ms=2500000\nout_time=00:00:02.500000\nspeed=5.01x\nprogress=continue\n";
    let mut done = 0;
    for l in block.lines() {
        if p.feed(l) {
            done += 1;
        }
    }
    assert_eq!(done, 1);
    assert_eq!(p.out_time, 2.5);
    assert_eq!(p.speed, Some(5.01));
    assert_eq!(p.percent(Some(10.0)), Some(25.0));
    assert_eq!(p.percent(None), None);
    p.feed("out_time_us=N/A");
    assert_eq!(p.out_time, 2.5);
    assert!(p.feed("progress=end"));
    assert_eq!(p.percent(Some(10.0)), Some(100.0));
}

#[test]
fn checksum_files() {
    // yt-dlp SHA2-256SUMS (excerpt of the real 2026.10.10.233141 file).
    let sums = "f40b6a9e4c5786360953911cab5d2f87507626b8fb7bfee3f8f1c2e5cf341fae  yt-dlp\n\
e7cafc44db8aa433da8dd78303b9157f2c1dd509c4cbfcd8418081b7e1d26a7a  yt-dlp.exe\n\
60606cef1a65d70f6639a85b45ebb7acf08dbb81831e134dd93939e23ca2b792  yt-dlp_linux\n\
C8EE97B3F6AA0FB5CBC3F56D772C0D79DC2C5D3D60F3BF0B240D5DD0D461FD25 *yt-dlp_macos\n\
not a checksum line\n";
    let m = parse_checksums(sums);
    assert_eq!(
        m["yt-dlp.exe"],
        "e7cafc44db8aa433da8dd78303b9157f2c1dd509c4cbfcd8418081b7e1d26a7a"
    );
    assert_eq!(
        m["yt-dlp_macos"],
        "c8ee97b3f6aa0fb5cbc3f56d772c0d79dc2c5d3d60f3bf0b240d5dd0d461fd25"
    );
    assert_eq!(m.len(), 4);
    // BtbN style with paths.
    let m = parse_checksums(
        "446062f4b9dae5cfafffe997c38c0d65a4af8a4e76df0466467cfdca96991d13  ./ffmpeg-master-latest-win64-gpl.zip\n",
    );
    assert!(m.contains_key("ffmpeg-master-latest-win64-gpl.zip"));

    // deno: Linux GNU style.
    assert_eq!(
        parse_single_checksum("c6527f24f4b16031d3ae4fa9f658d5f11534c8d84ce7dc8502420280919c3490  deno-x86_64-unknown-linux-gnu.zip\n").as_deref(),
        Some("c6527f24f4b16031d3ae4fa9f658d5f11534c8d84ce7dc8502420280919c3490")
    );
    // deno: Windows PowerShell Get-FileHash style (real file content).
    let ps = "\r\nAlgorithm : SHA256\r\nHash      : A0C3101B4158D1DFB7D6A78A7BF0F3DE80C96BB423C152BEEC8BEB22786F2238\r\nPath      : C:\\a\\deno\\deno\\target\\release\\deno-x86_64-pc-windows-msvc.zip\r\n\r\n";
    assert_eq!(
        parse_single_checksum(ps).as_deref(),
        Some("a0c3101b4158d1dfb7d6a78a7bf0f3de80c96bb423c152beec8beb22786f2238")
    );
    assert_eq!(parse_single_checksum("nothing here"), None);
    assert_eq!(
        sha256_hex(b"abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

#[test]
fn versions_and_tags() {
    assert_eq!(
        parse_version(Tool::YtDlp, "2026.10.10.233141\n").as_deref(),
        Some("2026.10.10.233141")
    );
    assert_eq!(
        parse_version(
            Tool::Ffmpeg,
            "ffmpeg version 9.0.1-full_build-www.gyan.dev Copyright (c) 2000-2026\nbuilt with gcc"
        )
        .as_deref(),
        Some("9.0.1-full_build-www.gyan.dev")
    );
    assert_eq!(
        parse_version(
            Tool::Deno,
            "deno 2.9.7 (stable, release, x86_64-pc-windows-msvc)\nv8 15.0"
        )
        .as_deref(),
        Some("2.9.7")
    );
    assert_eq!(
        tag_from_location(
            "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/tag/2026.10.10.233141"
        )
        .as_deref(),
        Some("2026.10.10.233141")
    );
    assert_eq!(
        tag_from_location("https://github.com/BtbN/FFmpeg-Builds/releases/tag/latest").as_deref(),
        Some("latest")
    );
    assert_eq!(tag_from_location("https://github.com/x/y/releases"), None);
}

#[test]
fn sponsorblock_parsing_and_chapters() {
    let direct = r#"[{"category":"sponsor","actionType":"skip","segment":[10.5,40.0],"UUID":"a","videoDuration":120.5},
                    {"category":"intro","actionType":"skip","segment":[0,5.0],"UUID":"b"},
                    {"category":"poi_highlight","actionType":"poi","segment":[60,60]}]"#;
    let segs = parse_segments(direct, "HDRtest0001").unwrap();
    assert_eq!(segs.len(), 2); // zero-length highlight dropped
    assert_eq!(segs[0].category, "intro"); // sorted
    let hashed = r#"[{"videoID":"other","segments":[{"category":"sponsor","segment":[1,2]}]},
                     {"videoID":"HDRtest0001","hash":"abcd","segments":[{"category":"selfpromo","actionType":"skip","segment":[95.0,100.0]}]}]"#;
    let segs2 = parse_segments(hashed, "HDRtest0001").unwrap();
    assert_eq!(
        segs2,
        vec![SponsorSegment {
            start: 95.0,
            end: 100.0,
            category: "selfpromo".into(),
            action_type: "skip".into()
        }]
    );

    let url = request_url(
        "https://sponsor.ajay.app",
        "aqz-KE-bpKQ",
        &["sponsor".into(), "intro".into()],
    );
    let prefix = &sha256_hex(b"aqz-KE-bpKQ")[..4];
    assert!(
        url.starts_with(&format!(
            "https://sponsor.ajay.app/api/skipSegments/{prefix}?categories="
        )),
        "{url}"
    );
    assert!(url.contains("%5B%22sponsor%22%2C%22intro%22%5D"));

    let chapters = vec![
        Chapter {
            start: 0.0,
            end: 30.0,
            title: "Intro".into(),
        },
        Chapter {
            start: 30.0,
            end: 90.0,
            title: "Main".into(),
        },
        Chapter {
            start: 90.0,
            end: 120.5,
            title: "Outro".into(),
        },
    ];
    let mut all = segs.clone();
    all.extend(segs2);
    let merged = merge_into_chapters(&chapters, &all, Some(120.5));
    let got: Vec<(f64, f64, &str)> = merged
        .iter()
        .map(|c| (c.start, c.end, c.title.as_str()))
        .collect();
    assert_eq!(
        got,
        vec![
            (0.0, 5.0, "[SponsorBlock]: Intermission/Intro Animation"),
            (5.0, 10.5, "Intro"),
            (10.5, 40.0, "[SponsorBlock]: Sponsor"),
            (40.0, 90.0, "Main"),
            (90.0, 95.0, "Outro"),
            (95.0, 100.0, "[SponsorBlock]: Unpaid/Self Promotion"),
            (100.0, 120.5, "Outro"),
        ]
    );
    // Without existing chapters gaps become untitled chapters.
    let merged = merge_into_chapters(&[], &segs, Some(60.0));
    let got: Vec<(f64, f64, &str)> = merged
        .iter()
        .map(|c| (c.start, c.end, c.title.as_str()))
        .collect();
    assert_eq!(
        got,
        vec![
            (0.0, 5.0, "[SponsorBlock]: Intermission/Intro Animation"),
            (5.0, 10.5, ""),
            (10.5, 40.0, "[SponsorBlock]: Sponsor"),
            (40.0, 60.0, "")
        ]
    );
}

#[test]
fn ffmetadata_generation() {
    let meta = Metadata {
        title: Some("A = B; #1".into()),
        artist: Some("Uploader\\Name".into()),
        date: Some("20260901".into()),
        comment: Some("https://example.com/v?a=1".into()),
        description: Some("line1\nline2".into()),
    };
    let chapters = vec![
        Chapter {
            start: 0.0,
            end: 12.3456,
            title: "Start".into(),
        },
        Chapter {
            start: 12.3456,
            end: 12.3456,
            title: "empty".into(),
        },
        Chapter {
            start: 12.3456,
            end: 60.0,
            title: String::new(),
        },
    ];
    let s = ffmetadata(Some(&meta), &chapters);
    let expected = ";FFMETADATA1\n\
title=A \\= B\\; \\#1\n\
artist=Uploader\\\\Name\n\
date=20260901\n\
comment=https://example.com/v?a\\=1\n\
description=line1\\\nline2\n\
synopsis=line1\\\nline2\n\
\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=12346\ntitle=Start\n\
\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=12346\nEND=60000\ntitle=\n";
    assert_eq!(s, expected);
    assert_eq!(ffmetadata(None, &[]), ";FFMETADATA1\n");
    assert_eq!(iso639_2("en-US"), "eng");
    assert_eq!(iso639_2("cs"), "cze");
    assert_eq!(iso639_2("deu"), "deu");
    assert_eq!(iso639_2("x-weird"), "und");
}

#[test]
fn final_path_keeps_the_characters_yt_dlp_substitutes() {
    use prism_video::progress::{LineEvent, parse_line};
    // `%(filepath)j`, as yt-dlp prints it: the full-width ？ ｜ it puts in names for ? | survive
    // (printed plainly, a Windows console code page drops them and the path doesn't exist).
    assert_eq!(
        parse_line(
            r#"PRISMFILE "C:\\Videos\\What Is MathWorks Cloud Center\uff1f \uff5c MathWorks [7151241570371948544].mp4""#
        ),
        Some(LineEvent::FinalPath(
            "C:\\Videos\\What Is MathWorks Cloud Center？ ｜ MathWorks [7151241570371948544].mp4"
                .into()
        ))
    );
}
