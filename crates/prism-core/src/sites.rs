//! Video players that yt-dlp doesn't know, resolved to their stream the way the page's own
//! player finds it.
//!
//! Without this, a typed or pasted link to such a page goes to the plain file dialog: the server
//! answers with the HTML page, and the download fails as if the site only let browsers in. The
//! browser extension doesn't need any of this (it sees the stream the player loads); this is for
//! links added in the app.
//!
//! **Stream Origin** (pornavhd.com and others): the page embeds an iframe
//! `https://<player>/e/<id>`. The player is a Next.js page with no stream in its HTML; it asks
//! `https://<api>/app/v1/play/<id>?embed=1` for `{hls, mp4, title, …}`. The API domain changes
//! often and is never hard-coded: it is read from the player's script chunks each time. The
//! chunks name several domains and only one of them answers the player (`api.streamorigin.cc`
//! says 401, `embedorigin.cc` answers), so every candidate is tried, `embed…` ones first.

use std::time::Duration;

use regex::Regex;
use url::Url;

/// Sites whose pages embed the Stream Origin player, and the player's own hosts.
const STREAM_ORIGIN_SITES: &[&str] = &["pornavhd.com", "video.playerrecord.cfd"];

/// A stream found for a page link.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SiteStream {
    /// HLS master playlist, or a direct MP4 when the player has no HLS.
    pub url: String,
    pub hls: bool,
    pub title: Option<String>,
    /// The player's origin (`https://video.playerrecord.cfd`): sent as Referer and Origin,
    /// as the player sends them.
    pub player_origin: String,
}

/// Is `url` a page of a site resolved here?
pub fn handles(url: &str) -> bool {
    let Some(host) = Url::parse(url).ok().and_then(|u| u.host_str().map(str::to_owned)) else {
        return false;
    };
    let host = host.trim_start_matches("www.");
    STREAM_ORIGIN_SITES
        .iter()
        .any(|s| host == *s || host.ends_with(&format!(".{s}")))
}

/// Finds the stream behind a page link of a site [`handles`]. The error is a sentence for the log.
pub async fn resolve(page: &str) -> Result<SiteStream, String> {
    let page = Url::parse(page).map_err(|e| format!("invalid address: {e}"))?;
    let client = reqwest::Client::builder()
        .user_agent(crate::DEFAULT_USER_AGENT)
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let player = if is_player_url(&page) {
        page.clone()
    } else {
        let html = get_text(&client, &page, None).await?;
        player_url(&page, &html).ok_or("the page has no Stream Origin player")?
    };
    let id = player_id(&player).ok_or("the player address has no video id")?;
    let origin = player.origin().ascii_serialization();

    let player_html = get_text(&client, &player, Some(&page)).await?;
    let mut chunks = Vec::new();
    for src in chunk_scripts(&player_html) {
        let Ok(js_url) = player.join(&src) else { continue };
        // Only the chunk that talks to the API is worth keeping.
        if let Ok(js) = get_text(&client, &js_url, Some(&player)).await
            && js.contains("app/v1")
        {
            chunks.push(js);
        }
    }
    let candidates = api_candidates(&player_html, &chunks);
    if candidates.is_empty() {
        return Err("no API domain in the player's scripts — the player may have changed".into());
    }
    for api in &candidates {
        let url = format!("{api}/app/v1/play/{id}?embed=1");
        let answer = client
            .get(&url)
            .header(reqwest::header::REFERER, format!("{origin}/"))
            .header(reqwest::header::ORIGIN, &origin)
            .send()
            .await;
        let Ok(resp) = answer else { continue };
        if !resp.status().is_success() {
            tracing::debug!(api = %api, status = %resp.status(), "stream origin api refused");
            continue;
        }
        let Ok(json) = resp.json::<serde_json::Value>().await else { continue };
        if let Some(stream) = stream_from_answer(&json, &origin) {
            return Ok(stream);
        }
    }
    Err(format!("none of {} API domains gave a stream", candidates.len()))
}

async fn get_text(client: &reqwest::Client, url: &Url, referer: Option<&Url>) -> Result<String, String> {
    let mut rb = client.get(url.clone());
    if let Some(r) = referer {
        rb = rb.header(reqwest::header::REFERER, r.as_str());
    }
    let resp = rb.send().await.map_err(|e| format!("{url}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("{url}: HTTP {}", resp.status().as_u16()));
    }
    resp.text().await.map_err(|e| format!("{url}: {e}"))
}

fn is_player_url(u: &Url) -> bool {
    player_id(u).is_some()
}

/// `<id>` of a player address `…/e/<id>`.
fn player_id(u: &Url) -> Option<String> {
    let rest = u.path().split_once("/e/")?.1;
    let id = rest.split('/').next().unwrap_or_default();
    (!id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric())).then(|| id.to_owned())
}

/// The player iframe of a page: the first `<iframe src>` that is a `…/e/<id>` address.
fn player_url(page: &Url, html: &str) -> Option<Url> {
    let re = Regex::new(r#"(?i)<iframe\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']"#).expect("iframe regex");
    re.captures_iter(html)
        .filter_map(|c| page.join(c[1].trim()).ok())
        .find(|u| matches!(u.scheme(), "http" | "https") && is_player_url(u))
}

/// Next.js chunk scripts the player page loads.
fn chunk_scripts(html: &str) -> Vec<String> {
    let re = Regex::new(r#"src\s*=\s*["']([^"']*/_next/static/chunks/[^"']+\.js)["']"#)
        .expect("chunk regex");
    let mut out: Vec<String> = Vec::new();
    for c in re.captures_iter(html) {
        if !out.iter().any(|s| s == &c[1]) {
            out.push(c[1].to_owned());
        }
    }
    out
}

/// API domains named by the player: the ones that look like this player's own (`embed` or
/// `origin` in the name — the chunks also name many unrelated CDNs), `embed…` first.
fn api_candidates(player_html: &str, chunks: &[String]) -> Vec<String> {
    let in_html = Regex::new(r"(https://[A-Za-z0-9.-]+)/app/v1").expect("api regex");
    let any = Regex::new(r"https://[A-Za-z0-9.-]+").expect("domain regex");
    let mut found: Vec<String> = Vec::new();
    let mut take = |d: &str| {
        let d = d.trim_end_matches('.');
        if (d.contains("embed") || d.contains("origin")) && !found.iter().any(|f| f == d) {
            found.push(d.to_owned());
        }
    };
    for c in in_html.captures_iter(player_html) {
        take(&c[1]);
    }
    for js in chunks {
        for m in any.find_iter(js) {
            take(m.as_str());
        }
    }
    let (mut embed, rest): (Vec<String>, Vec<String>) =
        found.into_iter().partition(|d| d.contains("embed"));
    embed.extend(rest);
    embed
}

/// The stream in a `/app/v1/play` answer: its HLS playlist, else its MP4.
fn stream_from_answer(json: &serde_json::Value, origin: &str) -> Option<SiteStream> {
    let field = |k: &str| {
        json.get(k)
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
    };
    let (url, hls) = match (field("hls"), field("mp4")) {
        (Some(h), _) => (h, true),
        (None, Some(m)) => (m, false),
        (None, None) => return None,
    };
    Some(SiteStream {
        url,
        hls,
        title: field("title"),
        player_origin: origin.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAGE: &str = "https://pornavhd.com/2026/10/24/retsu_dao_90_20261015/";

    #[test]
    fn handles_the_sites_and_their_subdomains_only() {
        assert!(handles(PAGE));
        assert!(handles("https://www.pornavhd.com/x/"));
        assert!(handles("https://video.playerrecord.cfd/e/6yx0ldsm9w3g"));
        assert!(!handles("https://notpornavhd.com/x/"));
        assert!(!handles("https://www.youtube.com/watch?v=x"));
        assert!(!handles("not a url"));
    }

    #[test]
    fn finds_the_player_iframe_among_ad_frames() {
        // Shapes from the real page: an ad frame with `javascript:` src, the player, a widget.
        let html = r#"<iframe referrerpolicy="no-referrer" data-link="https://t.example/s1" src="javascript:window.location.replace(this.frameElement.dataset.link)"></iframe>
            <iframe src="https://video.playerrecord.cfd/e/6yx0ldsm9w3g" allowfullscreen></iframe>
            <iframe width="100%" src="https://creative.example/widgets/v4/Universal?tag=x"></iframe>"#;
        let page = Url::parse(PAGE).unwrap();
        let player = player_url(&page, html).unwrap();
        assert_eq!(player.as_str(), "https://video.playerrecord.cfd/e/6yx0ldsm9w3g");
        assert_eq!(player_id(&player).as_deref(), Some("6yx0ldsm9w3g"));
        assert!(player_url(&page, "<p>no player</p>").is_none());
    }

    #[test]
    fn a_player_link_is_its_own_player() {
        let u = Url::parse("https://video.playerrecord.cfd/e/6yx0ldsm9w3g?t=1").unwrap();
        assert_eq!(player_id(&u).as_deref(), Some("6yx0ldsm9w3g"));
        assert!(player_id(&Url::parse(PAGE).unwrap()).is_none());
    }

    #[test]
    fn api_domains_come_from_the_chunks_embed_first() {
        let html = r#"<script src="/_next/static/chunks/3srfjz42u14tx.js" async=""></script>
            <script src="/_next/static/chunks/392vu6kftjb3g.js" async=""></script>
            <script src="/_next/static/chunks/392vu6kftjb3g.js" async=""></script>"#;
        assert_eq!(
            chunk_scripts(html),
            ["/_next/static/chunks/3srfjz42u14tx.js", "/_next/static/chunks/392vu6kftjb3g.js"]
        );
        // The real chunk names api.streamorigin.cc first (it answers 401) and embedorigin.cc
        // after it (the one that answers), among unrelated hosts.
        let chunk = r#"fetch("https://api.streamorigin.cc/app/v1/x");x="https://www.googletagmanager.com";
            y="https://embedorigin.cc";z="https://cdn.jsdelivr.net""#;
        assert_eq!(
            api_candidates(html, &[chunk.to_owned()]),
            ["https://embedorigin.cc", "https://api.streamorigin.cc"]
        );
    }

    #[test]
    fn the_answer_gives_hls_first_then_mp4() {
        let origin = "https://video.playerrecord.cfd";
        let real = serde_json::json!({
            "title": "po261024276_myfans_Retsu_dao_90_20261015", "duration": 4379,
            "hls": "https://o3.so279tk.cc/file/1/x/master.m3u8", "mp4": "", "qualities": []
        });
        let s = stream_from_answer(&real, origin).unwrap();
        assert!(s.hls);
        assert_eq!(s.url, "https://o3.so279tk.cc/file/1/x/master.m3u8");
        assert_eq!(s.title.as_deref(), Some("po261024276_myfans_Retsu_dao_90_20261015"));
        let mp4 = serde_json::json!({"hls": "", "mp4": "https://o3.example/v.mp4"});
        assert!(!stream_from_answer(&mp4, origin).unwrap().hls);
        assert!(stream_from_answer(&serde_json::json!({"message": "unauthorized"}), origin).is_none());
    }
}

/// Against the real site: `cargo test -p prism-core --lib sites::live -- --ignored`.
#[cfg(test)]
mod live {
    #[tokio::test]
    #[ignore = "network: talks to pornavhd.com and its player"]
    async fn resolves_the_real_page() {
        let s = super::resolve("https://pornavhd.com/2026/10/24/retsu_dao_90_20261015/")
            .await
            .unwrap();
        assert!(s.hls && s.url.contains(".m3u8"), "{s:?}");
        assert_eq!(s.player_origin, "https://video.playerrecord.cfd");
        assert!(s.title.is_some());
    }
}
