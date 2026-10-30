//! SponsorBlock segments → chapters (accelerated path; yt-dlp handles it itself otherwise).
//!
//! Uses the privacy-preserving hash-prefix endpoint
//! `GET /api/skipSegments/<first 4 hex of sha256(videoID)>?categories=[...]`,
//! which returns segments for every video sharing the prefix; we filter locally.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{Result, VideoError};
use crate::model::Chapter;
use crate::tools::sha256_hex;

pub const DEFAULT_API: &str = "https://sponsor.ajay.app";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SponsorSegment {
    pub start: f64,
    pub end: f64,
    pub category: String,
    pub action_type: String,
}

pub fn category_name(cat: &str) -> &str {
    match cat {
        "sponsor" => "Sponsor",
        "intro" => "Intermission/Intro Animation",
        "outro" => "Endcards/Credits",
        "selfpromo" => "Unpaid/Self Promotion",
        "preview" => "Preview/Recap",
        "filler" => "Filler Tangent",
        "interaction" => "Interaction Reminder",
        "music_offtopic" => "Non-Music Section",
        "hook" => "Hook/Greetings",
        "poi_highlight" => "Highlight",
        "chapter" => "Chapter",
        other => other,
    }
}

fn parse_segment(v: &Value) -> Option<SponsorSegment> {
    let seg = v.get("segment")?.as_array()?;
    let start = seg.first()?.as_f64()?;
    let end = seg.get(1)?.as_f64()?;
    Some(SponsorSegment {
        start,
        end,
        category: v
            .get("category")
            .and_then(Value::as_str)
            .unwrap_or("sponsor")
            .to_string(),
        action_type: v
            .get("actionType")
            .and_then(Value::as_str)
            .unwrap_or("skip")
            .to_string(),
    })
}

/// Parse either response shape:
/// * direct endpoint: `[{"segment":[a,b],"category":..}, ...]`
/// * hash-prefix endpoint: `[{"videoID":"..","segments":[...]}, ...]` (filtered by `video_id`).
pub fn parse_segments(json: &str, video_id: &str) -> Result<Vec<SponsorSegment>> {
    let v: Value = serde_json::from_str(json)?;
    let Value::Array(items) = v else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for item in &items {
        if let Some(segs) = item.get("segments").and_then(Value::as_array) {
            if item.get("videoID").and_then(Value::as_str) != Some(video_id) {
                continue;
            }
            out.extend(segs.iter().filter_map(parse_segment));
        } else if let Some(s) = parse_segment(item) {
            out.push(s);
        }
    }
    out.retain(|s| s.end > s.start && s.start >= 0.0);
    out.sort_by(|a, b| {
        a.start
            .partial_cmp(&b.start)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(out)
}

pub fn request_url(api: &str, video_id: &str, categories: &[String]) -> String {
    let prefix = &sha256_hex(video_id.as_bytes())[..4];
    let cats = serde_json::to_string(categories).unwrap_or_else(|_| "[]".into());
    let mut url = url::Url::parse(&format!(
        "{}/api/skipSegments/{prefix}",
        api.trim_end_matches('/')
    ))
    .expect("valid base");
    url.query_pairs_mut()
        .append_pair("categories", &cats)
        .append_pair("actionTypes", r#"["skip","mute"]"#);
    url.to_string()
}

pub async fn fetch_segments(
    client: &reqwest::Client,
    video_id: &str,
    categories: &[String],
) -> Result<Vec<SponsorSegment>> {
    let url = request_url(DEFAULT_API, video_id, categories);
    let resp = client.get(&url).send().await?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(Vec::new());
    }
    if !resp.status().is_success() {
        return Err(VideoError::HttpStatus {
            status: resp.status().as_u16(),
            url,
        });
    }
    parse_segments(&resp.text().await?, video_id)
}

/// Overlay SponsorBlock segments onto existing chapters, the way yt-dlp's
/// `--sponsorblock-mark` does: existing chapters are split around segments,
/// segments become `[SponsorBlock]: <Category>` chapters, and gaps (when the
/// video has no chapters) become untitled chapters.
pub fn merge_into_chapters(
    chapters: &[Chapter],
    segments: &[SponsorSegment],
    duration: Option<f64>,
) -> Vec<Chapter> {
    if segments.is_empty() {
        return chapters.to_vec();
    }
    let end = duration
        .or_else(|| chapters.iter().map(|c| c.end).reduce(f64::max))
        .unwrap_or(0.0)
        .max(segments.iter().map(|s| s.end).fold(0.0, f64::max));
    let mut points: Vec<f64> = vec![0.0, end];
    for c in chapters {
        points.push(c.start.clamp(0.0, end));
        points.push(c.end.clamp(0.0, end));
    }
    for s in segments {
        points.push(s.start.clamp(0.0, end));
        points.push(s.end.clamp(0.0, end));
    }
    points.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    points.dedup_by(|a, b| (*a - *b).abs() < 1e-3);

    // (identity, title) per elementary interval; identity keeps distinct base chapters apart.
    let mut out: Vec<(String, Chapter)> = Vec::new();
    for w in points.windows(2) {
        let (a, b) = (w[0], w[1]);
        if b - a < 1e-3 {
            continue;
        }
        let mid = (a + b) / 2.0;
        let mut cats: Vec<&str> = segments
            .iter()
            .filter(|s| s.start <= mid && mid < s.end)
            .map(|s| category_name(&s.category))
            .collect();
        cats.dedup();
        let (id, title) = if !cats.is_empty() {
            let t = format!("[SponsorBlock]: {}", cats.join(", "));
            (format!("sb:{t}"), t)
        } else if let Some((i, c)) = chapters
            .iter()
            .enumerate()
            .find(|(_, c)| c.start <= mid && mid < c.end)
        {
            (format!("ch:{i}"), c.title.clone())
        } else {
            ("gap".to_string(), String::new())
        };
        match out.last_mut() {
            Some((last_id, last)) if *last_id == id && (last.end - a).abs() < 1e-3 => last.end = b,
            _ => out.push((
                id,
                Chapter {
                    start: a,
                    end: b,
                    title,
                },
            )),
        }
    }
    out.into_iter().map(|(_, c)| c).collect()
}
