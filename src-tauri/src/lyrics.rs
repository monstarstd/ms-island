use regex::Regex;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct LrcLibResponse {
    #[serde(rename = "plainLyrics")]
    plain_lyrics: Option<String>,
    #[serde(rename = "syncedLyrics")]
    synced_lyrics: Option<String>,
    #[serde(default)]
    #[serde(rename = "trackName")]
    track_name: Option<String>,
    #[serde(default)]
    #[serde(rename = "artistName")]
    artist_name: Option<String>,
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
    #[serde(default)]
    full_title: String,
}

/// Cleans typical YouTube video titles to extract clean song name and artist
pub fn sanitize_youtube_title(raw_title: &str, raw_artist: &str) -> (String, String) {
    let mut title = raw_title.to_string();
    let mut artist = raw_artist.to_string();

    // 1. Remove bracketed clutter: (Official Video), [MV], (Lirik Lagu), [4K], etc.
    let clutter_re = Regex::new(
        r"(?i)\s*[\(\[\{【『「].*?(official|music|video|audio|lyric|lirik|klip|mv|4k|hd|remaster|visualizer|live|clip|karaoke|acoustic|cover|full album|hq|soundtrack|ost).*?[\)\]\}】』」]"
    ).unwrap();
    title = clutter_re.replace_all(&title, "").to_string();

    // 2. Remove any remaining standalone brackets or tags
    let standalone_brackets = Regex::new(r"(?i)\s*[\(\[\{].*?[\)\]\}]").unwrap();
    title = standalone_brackets.replace_all(&title, "").to_string();

    // 3. Remove " - YouTube" if present at the end
    if title.to_lowercase().ends_with(" - youtube") {
        title = title[..title.len() - 10].trim().to_string();
    }

    // 4. Remove leftover feat./ft. in song title
    let feat_re = Regex::new(r"(?i)\s*(feat\.|ft\.).*").unwrap();
    title = feat_re.replace_all(&title, "").to_string();

    // 5. Check if title contains separator: " - ", " — ", " – ", " | ", " : ", " • "
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

    // Clean quotation marks
    title = title.replace(['「', '」', '『', '』', '"', '\''], " ").trim().to_string();
    artist = artist.replace(['「', '」', '『', '』', '"', '\''], " ").trim().to_string();

    (title, artist)
}

/// Strips timestamps from LRC text to produce clean, readable plain lyrics
pub fn clean_lrc_to_plain(lrc_text: &str) -> String {
    let tag_re = Regex::new(r"\[\d{2}:\d{2}\.?\d{0,3}\]").unwrap();
    let id_tag_re = Regex::new(r"^\[(ti|ar|al|by|offset|length):.*\]").unwrap();
    let mut result = Vec::new();

    for line in lrc_text.lines() {
        if id_tag_re.is_match(line.trim()) {
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

/// Fetches lyrics from Genius API + scrape fallback
async fn search_genius(client: &reqwest::Client, query: &str) -> Option<String> {
    if query.trim().is_empty() {
        return None;
    }
    let url = format!("https://genius.com/api/search/multi?q={}", urlencoding(query.trim()));
    let resp = client.get(&url).send().await.ok()?;
    let data: GeniusSearchResponse = resp.json().await.ok()?;

    let first_hit = data.response.sections.into_iter()
        .flat_map(|s| s.hits)
        .next()?;

    let song_url = format!("https://genius.com{}", first_hit.result.path);
    let page_html = client.get(&song_url).send().await.ok()?.text().await.ok()?;

    // Extract genius lyrics containers
    let container_re = Regex::new(r#"<div[^>]*data-lyrics-container="true"[^>]*>(.*?)</div>"#).unwrap();
    let br_re = Regex::new(r"<br\s*/?>").unwrap();
    let tag_re = Regex::new(r"<[^>]+>").unwrap();

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
pub async fn fetch_full_lyrics(raw_title: &str, raw_artist: &str, duration_sec: u64) -> Option<String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(6))
        .build()
        .ok()?;

    let (clean_t, clean_a) = sanitize_youtube_title(raw_title, raw_artist);

    // Direct exact get on LRCLIB if both exist
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

    // Query variant 1: "Artist Title"
    let q1 = format!("{} {}", clean_a, clean_t).trim().to_string();
    if !q1.is_empty() {
        if let Some(lyrics) = search_lrclib(&client, &q1).await {
            return Some(lyrics);
        }
        if let Some(lyrics) = search_genius(&client, &q1).await {
            return Some(lyrics);
        }
    }

    // Query variant 2: "Title Artist" (in case format is Title - Artist)
    let q2 = format!("{} {}", clean_t, clean_a).trim().to_string();
    if !q2.is_empty() && q2 != q1 {
        if let Some(lyrics) = search_lrclib(&client, &q2).await {
            return Some(lyrics);
        }
        if let Some(lyrics) = search_genius(&client, &q2).await {
            return Some(lyrics);
        }
    }

    // Query variant 3: Just "Title"
    if !clean_t.is_empty() && clean_t != q1 && clean_t != q2 {
        if let Some(lyrics) = search_lrclib(&client, &clean_t).await {
            return Some(lyrics);
        }
        if let Some(lyrics) = search_genius(&client, &clean_t).await {
            return Some(lyrics);
        }
    }

    // Query variant 4: Cleaned raw title without splitting
    let cleaned_raw = Regex::new(r"(?i)\s*[\(\[\{].*?[\)\]\}]").unwrap().replace_all(raw_title, "").trim().to_string();
    if !cleaned_raw.is_empty() && cleaned_raw != q1 && cleaned_raw != q2 && cleaned_raw != clean_t {
        if let Some(lyrics) = search_lrclib(&client, &cleaned_raw).await {
            return Some(lyrics);
        }
        if let Some(lyrics) = search_genius(&client, &cleaned_raw).await {
            return Some(lyrics);
        }
    }

    None
}

/// Manual search query for user-typed artist/song query
pub async fn manual_search_lyrics(query: &str) -> Option<String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(6))
        .build()
        .ok()?;

    if let Some(lyrics) = search_lrclib(&client, query).await {
        return Some(lyrics);
    }
    if let Some(lyrics) = search_genius(&client, query).await {
        return Some(lyrics);
    }

    None
}

fn urlencoding(input: &str) -> String {
    url::form_urlencoded::byte_serialize(input.as_bytes()).collect()
}
