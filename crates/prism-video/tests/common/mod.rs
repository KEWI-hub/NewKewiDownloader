#![allow(dead_code)]

use prism_video::{Probe, VideoInfo, model::parse_probe_json};

pub fn fixture(name: &str) -> String {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    std::fs::read_to_string(p).expect("fixture")
}

pub fn video(name: &str) -> VideoInfo {
    match parse_probe_json(&fixture(name)).expect("parse") {
        Probe::Video(v) => *v,
        Probe::Playlist(_) => panic!("expected a video"),
    }
}
