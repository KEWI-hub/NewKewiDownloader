//! Output-file naming: a small subset of yt-dlp's output template syntax and
//! Windows-safe filename sanitization (same replacement characters as
//! yt-dlp's `--windows-filenames`, so both download paths produce the same names).

use std::path::PathBuf;

use crate::model::VideoInfo;

/// Longest file name, extension included, in UTF-16 units (what Windows counts against its
/// 255 limit); the same as the engine's, so both download paths cut a title alike.
const MAX_COMPONENT_UNITS: usize = 250;

/// Replace characters that are invalid in file names on Windows (and `/` everywhere).
pub fn sanitize_component(s: &str) -> String {
    let mut out: String = s
        .chars()
        .map(|c| match c {
            '"' => '＂',
            ':' => '：',
            '?' => '？',
            '*' => '＊',
            '|' => '｜',
            '<' => '＜',
            '>' => '＞',
            '/' => '⧸',
            '\\' => '⧹',
            c if (c as u32) < 0x20 || c == '\u{7f}' => ' ',
            c => c,
        })
        .collect();
    // Collapse whitespace runs produced by control characters.
    while out.contains("  ") {
        out = out.replace("  ", " ");
    }
    let mut out = out.trim().trim_end_matches(['.', ' ']).to_string();
    if out.encode_utf16().count() > MAX_COMPONENT_UNITS {
        out = truncate_keep_extension(&out, MAX_COMPONENT_UNITS);
    }
    let upper = out.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((upper.starts_with("COM") || upper.starts_with("LPT"))
            && upper.len() == 4
            && upper.as_bytes()[3].is_ascii_digit());
    if reserved {
        out.insert(0, '_');
    }
    if out.is_empty() || out == "." || out == ".." {
        out = "_".into();
    }
    out
}

/// Shortens `s` to `max` UTF-16 units, keeping a short extension (`.mp4`) whole.
fn truncate_keep_extension(s: &str, max: usize) -> String {
    let (stem, ext) = match s.rfind('.') {
        Some(i) if i > 0 && s.len() - i <= 8 && s[i + 1..].chars().all(|c| c.is_ascii_alphanumeric()) => (&s[..i], &s[i..]),
        _ => (s, ""),
    };
    let room = max.saturating_sub(ext.encode_utf16().count());
    let mut used = 0;
    let stem: String = stem
        .chars()
        .take_while(|c| {
            used += c.len_utf16();
            used <= room
        })
        .collect();
    format!("{}{ext}", stem.trim_end_matches(['.', ' ']))
}

fn field(info: &VideoInfo, name: &str, ext: &str) -> Option<String> {
    Some(match name {
        "title" | "fulltitle" => info.title.clone(),
        "id" => info.id.clone(),
        "ext" => ext.to_string(),
        "uploader" => info.uploader.clone()?,
        "channel" => info.channel.clone().or_else(|| info.uploader.clone())?,
        "upload_date" => info.upload_date.clone()?,
        "extractor" | "extractor_key" => info.extractor.clone(),
        "duration" => format!("{}", info.duration? as u64),
        _ => return None,
    })
}

/// Render a yt-dlp style template (`%(title)s [%(id)s].%(ext)s`; `/` separates
/// sub-directories). Unknown fields become `NA` like in yt-dlp.
pub fn render_template(template: &str, info: &VideoInfo, ext: &str) -> PathBuf {
    let template = if template.trim().is_empty() {
        crate::model::DEFAULT_TEMPLATE
    } else {
        template
    };
    let mut path = PathBuf::new();
    for comp in template.split(['/', '\\']) {
        let mut out = String::new();
        let mut rest = comp;
        while let Some(i) = rest.find('%') {
            out.push_str(&rest[..i]);
            let after = &rest[i + 1..];
            if let Some(r) = after.strip_prefix('%') {
                out.push('%');
                rest = r;
            } else if let Some(r) = after.strip_prefix('(') {
                if let Some(close) = r.find(')') {
                    let name = &r[..close];
                    let r2 = &r[close + 1..];
                    // Conversion char (s, d ...): skip it.
                    let conv_len = r2
                        .chars()
                        .next()
                        .filter(|c| c.is_ascii_alphabetic())
                        .map(|c| c.len_utf8())
                        .unwrap_or(0);
                    let value = field(
                        info,
                        name.split(['|', '&', ',']).next().unwrap_or(name),
                        ext,
                    )
                    .unwrap_or_else(|| "NA".into());
                    // Values must not create path separators (same glyphs as yt-dlp).
                    out.push_str(&value.replace('/', "⧸").replace('\\', "⧹"));
                    rest = &r2[conv_len..];
                } else {
                    out.push('%');
                    rest = after;
                }
            } else {
                out.push('%');
                rest = after;
            }
        }
        out.push_str(rest);
        if out.is_empty() || out == "." || out == ".." {
            continue;
        }
        path.push(sanitize_component(&out));
    }
    if path.as_os_str().is_empty() {
        path.push(format!("{}.{ext}", sanitize_component(&info.id)));
    }
    path
}

/// Safe stem for temporary stream files (ASCII-ish id).
pub fn temp_stem(info: &VideoInfo) -> String {
    let s: String = info
        .id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(64)
        .collect();
    if s.is_empty() { "video".into() } else { s }
}

#[cfg(test)]
mod length_tests {
    use super::*;

    #[test]
    fn a_long_title_keeps_250_units_and_its_extension() {
        let name = format!("{} [abc].mp4", "คลิป".repeat(100));
        let s = sanitize_component(&name);
        assert_eq!(s.encode_utf16().count(), MAX_COMPONENT_UNITS, "{s}");
        assert!(s.ends_with(".mp4"), "{s}");
        assert_eq!(sanitize_component("short title [x].mp4"), "short title [x].mp4");
    }
}
