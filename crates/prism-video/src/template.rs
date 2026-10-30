//! Output-file naming: a small subset of yt-dlp's output template syntax and
//! Windows-safe filename sanitization (same replacement characters as
//! yt-dlp's `--windows-filenames`, so both download paths produce the same names).

use std::path::PathBuf;

use crate::model::VideoInfo;

const MAX_COMPONENT_CHARS: usize = 180;

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
    if out.chars().count() > MAX_COMPONENT_CHARS {
        out = out
            .chars()
            .take(MAX_COMPONENT_CHARS)
            .collect::<String>()
            .trim_end_matches(['.', ' '])
            .to_string();
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
