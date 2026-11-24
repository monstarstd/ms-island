use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::OnceLock;
use std::time::Duration;

#[derive(Debug, Deserialize)]
struct LrcLibResponse {
    id: Option<i64>,
    #[serde(rename = "trackName")]
    track_name: Option<String>,
    #[serde(rename = "artistName")]
    artist_name: Option<String>,
    #[serde(rename = "albumName")]
    album_name: Option<String>,
    duration: Option<f64>,
    #[serde(rename = "plainLyrics")]
    plain_lyrics: Option<String>,
    #[serde(rename = "syncedLyrics")]
    synced_lyrics: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LyricsSuggestion {
    pub id: i64,
    #[serde(rename = "trackName")]
    pub track_name: String,
    #[serde(rename = "artistName")]
    pub artist_name: String,
    #[serde(rename = "albumName")]
    pub album_name: String,
    #[serde(rename = "durationSec")]
    pub duration_sec: u64,
    pub lyrics: String,
}

#[derive(Debug, Deserialize)]
struct GeniusSearchResponse {
    response: GeniusSearchBody,
}

#[derive(Debug, Deserialize)]
struct GeniusSearchBody {
    sections: Vec<GeniusSearchSection>,
}

#[derive(Debug, Deserialize)]
struct GeniusSearchSection {
    hits: Vec<GeniusSearchHit>,
}

#[derive(Debug, Deserialize)]
struct GeniusSearchHit {
    result: GeniusSongResult,
}

#[derive(Debug, Deserialize)]
struct GeniusSongResult {
    path: String,
}

// -----------------------------------------------------------------------------
// Shared Keep-Alive HTTP Client & Precompiled Regexes (Compiled Once!)
// -----------------------------------------------------------------------------

fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .timeout(Duration::from_secs(6))
            .build()
            .expect("failed to build lyrics HTTP client")
    })
}

fn clutter_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?i)\s*[\(\[\{【『「].*?(official|music|video|audio|lyric|lirik|klip|mv|4k|hd|remaster|visualizer|live|clip|karaoke|acoustic|cover|full album|hq|soundtrack|ost).*?[\)\]\}】』」]"
        ).unwrap()
    })
}

fn standalone_brackets_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)\s*[\(\[\{].*?[\)\]\}]").unwrap())
}

fn feat_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)\s*(feat\.|ft\.).*").unwrap())
}

fn lrc_timestamp_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[\d{2}:\d{2}\.?\d{0,3}\]").unwrap())
}

fn lrc_id_tag_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\[(ti|ar|al|by|offset|length):.*\]").unwrap())
}

fn genius_container_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"<div[^>]*data-lyrics-container="true"[^>]*>(.*?)</div>"#).unwrap()
    })
}

fn html_br_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"<br\s*/?>").unwrap())
}

fn html_tag_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"<[^>]+>").unwrap())
}

/// Cleans typical YouTube video titles to extract clean song name and artist
pub fn sanitize_youtube_title(raw_title: &str, raw_artist: &str) -> (String, String) {
    let mut title = clutter_re().replace_all(raw_title, "").to_string();
    let mut artist = raw_artist.to_string();

    title = standalone_brackets_re().replace_all(&title, "").to_string();

    if title.to_lowercase().ends_with(" - youtube") {
        title = title[..title.len() - 10].trim().to_string();
    }

    title = feat_re().replace_all(&title, "").to_string();

    for sep in &[" - ", " — ", " – ", " | ", " : ", " • "] {
        if title.contains(sep) {
            let parts: Vec<&str> = title.splitn(2, sep).collect();
            if parts.len() == 2 {
                artist = parts[0].trim().to_string();
                title = parts[1].trim().to_string();
                break;
            }
        }
    }

    title = title.replace(['「', '」', '『', '』', '"', '\''], " ").trim().to_string();
    artist = artist.replace(['「', '」', '『', '』', '"', '\''], " ").trim().to_string();

    (title, artist)
}

/// Strips timestamps from LRC text to produce clean, readable plain lyrics
pub fn clean_lrc_to_plain(lrc_text: &str) -> String {
    let tag_re = lrc_timestamp_re();
    let id_re = lrc_id_tag_re();
    let mut result = Vec::new();

    for line in lrc_text.lines() {
        if id_re.is_match(line.trim()) {
            continue;
        }
        let clean = tag_re.replace_all(line, "").trim().to_string();
        if !clean.is_empty() {
            result.push(clean);
        }
    }

    result.join("\n")
}

/// Decodes common HTML entities often found in scraped lyrics
fn decode_html_entities(text: &str) -> String {
    text.replace("&#x27;", "'")
        .replace("&quot;", "\"")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}

/// Fetches lyrics from LRCLIB using a search query
async fn search_lrclib(client: &reqwest::Client, query: &str) -> Option<String> {
    if query.trim().is_empty() {
        return None;
    }
    let url = format!("https://lrclib.net/api/search?q={}", urlencoding(query.trim()));
    if let Ok(resp) = client.get(&url).send().await {
        if let Ok(items) = resp.json::<Vec<LrcLibResponse>>().await {
            for item in items {
                if let Some(plain) = item.plain_lyrics {
                    if !plain.trim().is_empty() {
                        return Some(plain.trim().to_string());
                    }
                }
                if let Some(synced) = item.synced_lyrics {
                    let cleaned = clean_lrc_to_plain(&synced);
                    if !cleaned.is_empty() {
                        return Some(cleaned);
                    }
                }
            }
        }
    }
    None
}

/// Fetches lyrics from Genius API + scrape fallback (fails fast on non-200/Cloudflare)
async fn search_genius(client: &reqwest::Client, query: &str) -> Option<String> {
    if query.trim().is_empty() {
        return None;
    }
    let url = format!("https://genius.com/api/search/multi?q={}", urlencoding(query.trim()));
    let resp = client.get(&url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let data: GeniusSearchResponse = resp.json().await.ok()?;

    let first_hit = data.response.sections.into_iter().flat_map(|s| s.hits).next()?;

    let song_url = format!("https://genius.com{}", first_hit.result.path);
    let page_resp = client.get(&song_url).send().await.ok()?;
    if !page_resp.status().is_success() {
        return None;
    }
    let page_html = page_resp.text().await.ok()?;

    let container_re = genius_container_re();
    let br_re = html_br_re();
    let tag_re = html_tag_re();

    let mut parts = Vec::new();
    for cap in container_re.captures_iter(&page_html) {
        if let Some(m) = cap.get(1) {
            let with_newlines = br_re.replace_all(m.as_str(), "\n");
            let stripped = tag_re.replace_all(&with_newlines, "");
            let decoded = decode_html_entities(&stripped);
            parts.push(decoded.trim().to_string());
        }
    }

    if !parts.is_empty() {
        let full = parts.join("\n\n");
        if !full.trim().is_empty() {
            return Some(full);
        }
    }

    None
}

/// Master function: Tries LRCLIB first, then Genius, across multiple query variants
pub async fn fetch_full_lyrics(
    raw_title: &str,
    raw_artist: &str,
    duration_sec: u64,
) -> Option<String> {
    let client = http_client();
    let (clean_t, clean_a) = sanitize_youtube_title(raw_title, raw_artist);

    if !clean_t.is_empty() && !clean_a.is_empty() {
        let get_url = format!(
            "https://lrclib.net/api/get?track_name={}&artist_name={}&duration={}",
            urlencoding(&clean_t),
            urlencoding(&clean_a),
            duration_sec
        );
        if let Ok(resp) = client.get(&get_url).send().await {
            if let Ok(data) = resp.json::<LrcLibResponse>().await {
                if let Some(plain) = data.plain_lyrics {
                    if !plain.trim().is_empty() {
                        return Some(plain.trim().to_string());
                    }
                }
                if let Some(synced) = data.synced_lyrics {
                    let cleaned = clean_lrc_to_plain(&synced);
                    if !cleaned.is_empty() {
                        return Some(cleaned);
                    }
                }
            }
        }
    }

    // Try fast LRCLIB queries first across variants
    let q1 = format!("{} {}", clean_a, clean_t).trim().to_string();
    if !q1.is_empty() {
        if let Some(lyrics) = search_lrclib(client, &q1).await {
            return Some(lyrics);
        }
    }

    let q2 = format!("{} {}", clean_t, clean_a).trim().to_string();
    if !q2.is_empty() && q2 != q1 {
        if let Some(lyrics) = search_lrclib(client, &q2).await {
            return Some(lyrics);
        }
    }

    if !clean_t.is_empty() && clean_t != q1 && clean_t != q2 {
        if let Some(lyrics) = search_lrclib(client, &clean_t).await {
            return Some(lyrics);
        }
    }

    let cleaned_raw = standalone_brackets_re().replace_all(raw_title, "").trim().to_string();
    if !cleaned_raw.is_empty() && cleaned_raw != q1 && cleaned_raw != q2 && cleaned_raw != clean_t {
        if let Some(lyrics) = search_lrclib(client, &cleaned_raw).await {
            return Some(lyrics);
        }
    }

    // Single best-effort Genius fallback only if all LRCLIB variants missed
    let fallback_q = if !q1.is_empty() { &q1 } else { &cleaned_raw };
    if !fallback_q.is_empty() {
        if let Some(lyrics) = search_genius(client, fallback_q).await {
            return Some(lyrics);
        }
    }

    None
}

/// Returns up to 6 deduplicated LRCLIB search suggestions with embedded plain lyrics
pub async fn suggest_lyrics(query: &str) -> Vec<LyricsSuggestion> {
    let trimmed = query.trim();
    if trimmed.len() < 2 {
        return Vec::new();
    }

    let client = http_client();
    let url = format!("https://lrclib.net/api/search?q={}", urlencoding(trimmed));
    let Ok(resp) = client.get(&url).send().await else {
        return Vec::new();
    };
    let Ok(items) = resp.json::<Vec<LrcLibResponse>>().await else {
        return Vec::new();
    };

    let mut out = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for (idx, item) in items.into_iter().enumerate() {
        let lyrics = item
            .plain_lyrics
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
            .or_else(|| {
                item.synced_lyrics
                    .as_deref()
                    .map(clean_lrc_to_plain)
                    .filter(|s| !s.is_empty())
            });

        let Some(lyrics_text) = lyrics else {
            continue;
        };

        let track_name = item.track_name.unwrap_or_default().trim().to_string();
        if track_name.is_empty() {
            continue;
        }
        let artist_name = item.artist_name.unwrap_or_default().trim().to_string();
        let album_name = item.album_name.unwrap_or_default().trim().to_string();
        let duration_sec = item.duration.unwrap_or(0.0).max(0.0).round() as u64;

        let dedupe_key = format!(
            "{}|{}|{}",
            track_name.to_lowercase(),
            artist_name.to_lowercase(),
            duration_sec / 5
        );
        if !seen.insert(dedupe_key) {
            continue;
        }

        out.push(LyricsSuggestion {
            id: item.id.unwrap_or(idx as i64),
            track_name,
            artist_name,
            album_name,
            duration_sec,
            lyrics: lyrics_text,
        });

        if out.len() >= 6 {
            break;
        }
    }

    out
}

/// Manual search query for user-typed artist/song query
pub async fn manual_search_lyrics(query: &str) -> Option<String> {
    let client = http_client();

    if let Some(lyrics) = search_lrclib(client, query).await {
        return Some(lyrics);
    }
    if let Some(lyrics) = search_genius(client, query).await {
        return Some(lyrics);
    }

    None
}

fn urlencoding(input: &str) -> String {
    url::form_urlencoded::byte_serialize(input.as_bytes()).collect()
}
