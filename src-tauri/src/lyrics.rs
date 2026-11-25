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
    #[serde(rename = "syncedLyrics")]
    pub synced_lyrics: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LyricsPayload {
    #[serde(rename = "plainLyrics")]
    pub plain_lyrics: String,
    #[serde(rename = "syncedLyrics")]
    pub synced_lyrics: Option<String>,
    #[serde(rename = "trackName")]
    pub track_name: Option<String>,
    #[serde(rename = "artistName")]
    pub artist_name: Option<String>,
    pub status: String,
    pub suggestions: Vec<LyricsSuggestion>,
}

impl Default for LyricsPayload {
    fn default() -> Self {
        Self::idle()
    }
}

impl LyricsPayload {
    pub fn idle() -> Self {
        Self {
            plain_lyrics: String::new(),
            synced_lyrics: None,
            track_name: None,
            artist_name: None,
            status: "idle".to_string(),
            suggestions: Vec::new(),
        }
    }

    pub fn loading() -> Self {
        Self {
            plain_lyrics: "Searching for lyrics...".to_string(),
            synced_lyrics: None,
            track_name: None,
            artist_name: None,
            status: "loading".to_string(),
            suggestions: Vec::new(),
        }
    }

    pub fn not_found(msg: &str) -> Self {
        Self {
            plain_lyrics: msg.to_string(),
            synced_lyrics: None,
            track_name: None,
            artist_name: None,
            status: "not_found".to_string(),
            suggestions: Vec::new(),
        }
    }
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

fn standalone_brackets_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"[\(\[\{【『「][^\)\]\}\】』」]*[\)\]\}】』」]").unwrap()
    })
}

fn noise_phrases_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?i)\b(official\s+music\s+video|official\s+lyric\s+video|official\s+video|official\s+audio|official\s+mv|lyric\s+video|music\s+video|extended\s+version|live\s+version|live\s+session|acoustic\s+version|remastered|full\s+album|karaoke\s+version|4k|hd|hq)\b",
        )
        .unwrap()
    })
}

fn collab_split_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)\s+(?:&|x|feat\.?|ft\.?|featuring|with)\s+|\s*[,/]\s*").unwrap()
    })
}

fn ensemble_suffix_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)\s+(?:orchestra|symphonic|philharmonic|ensemble)\b.*$").unwrap()
    })
}

fn whitespace_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\s+").unwrap())
}

fn lrc_timestamp_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]").unwrap())
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

// -----------------------------------------------------------------------------
// Smart Text Normalization, Bidirectional Parsing & Relevance Scoring
// -----------------------------------------------------------------------------

fn normalize_quotes(input: &str) -> String {
    input
        .replace(['’', '‘', 'ʼ', '`'], "'")
        .replace(['“', '”'], "\"")
}

/// Cleans messy YouTube / browser titles while preserving contractions like I'm / Don't
fn normalize_text(raw: &str) -> String {
    let mut s = normalize_quotes(raw);
    s = standalone_brackets_re().replace_all(&s, " ").to_string();
    s = noise_phrases_re().replace_all(&s, " ").to_string();
    s = s.replace(['「', '」', '『', '』', '"'], " ");

    let trimmed = whitespace_re().replace_all(&s, " ").trim().to_string();
    let lower = trimmed.to_lowercase();
    for suffix in &[" - youtube", " - topic", " | youtube"] {
        if lower.ends_with(suffix) && trimmed.len() > suffix.len() {
            return trimmed[..trimmed.len() - suffix.len()].trim().to_string();
        }
    }
    trimmed
}

/// Extracts the primary title or primary artist before collaborations (&, feat., ft., x, with, ,)
fn extract_primary_segment(input: &str) -> String {
    let first = collab_split_re()
        .split(input)
        .next()
        .unwrap_or(input)
        .trim();
    let stripped = ensemble_suffix_re().replace(first, "").trim().to_string();
    if stripped.is_empty() {
        first.to_string()
    } else {
        stripped
    }
}

fn split_title_parts(text: &str) -> Option<(String, String)> {
    for sep in &[" - ", " — ", " – ", " | ", " : ", " • "] {
        if let Some((left, right)) = text.split_once(sep) {
            let l = left.trim().to_string();
            let r = right.trim().to_string();
            if !l.is_empty() && !r.is_empty() {
                return Some((l, r));
            }
        }
    }
    None
}

fn is_generic_source_name(s: &str) -> bool {
    matches!(
        s.trim().to_lowercase().as_str(),
        "" | "youtube"
            | "youtube music"
            | "brave"
            | "chrome"
            | "google chrome"
            | "microsoft edge"
            | "edge"
            | "firefox"
            | "opera"
            | "unknown"
            | "unknown artist"
    )
}

fn push_unique_query(out: &mut Vec<String>, seen: &mut HashSet<String>, candidate: String) {
    let clean = whitespace_re().replace_all(candidate.trim(), " ").to_string();
    if clean.len() < 2 {
        return;
    }
    let key = clean.to_lowercase();
    if seen.insert(key) {
        out.push(clean);
    }
}

/// Builds prioritized smart query variants handling both "Artist - Title" and "Title - Artist",
/// collaboration strings ("Pamungkas & Erwin Gutawa Orchestra"), brackets, and curly apostrophes.
fn build_smart_queries(raw_title: &str, raw_artist: &str) -> Vec<String> {
    let clean_title = normalize_text(raw_title);
    let clean_artist_raw = normalize_text(raw_artist);
    let clean_artist = if is_generic_source_name(&clean_artist_raw) {
        String::new()
    } else {
        extract_primary_segment(&clean_artist_raw)
    };

    let mut queries = Vec::new();
    let mut seen = HashSet::new();

    if let Some((left, right)) = split_title_parts(&clean_title) {
        let left_primary = extract_primary_segment(&left);
        let right_primary = extract_primary_segment(&right);

        // 1. Best combined primary pair (works for both "Title - Artist" and "Artist - Title"!)
        push_unique_query(
            &mut queries,
            &mut seen,
            format!("{} {}", left_primary, right_primary),
        );

        // 2. Each side individually so ANY song containing the title always matches
        // Prefer the longer side first when searching solo (song titles are often longer than artist names,
        // e.g. "I Love You but I'm Letting Go" vs "Pamungkas")
        if left_primary.len() >= right_primary.len() {
            push_unique_query(&mut queries, &mut seen, left_primary.clone());
            push_unique_query(&mut queries, &mut seen, right_primary.clone());
        } else {
            push_unique_query(&mut queries, &mut seen, right_primary.clone());
            push_unique_query(&mut queries, &mut seen, left_primary.clone());
        }

        // 3. With SMTC artist if it brings new signal
        if !clean_artist.is_empty() {
            push_unique_query(
                &mut queries,
                &mut seen,
                format!("{} {}", left_primary, clean_artist),
            );
            push_unique_query(
                &mut queries,
                &mut seen,
                format!("{} {}", right_primary, clean_artist),
            );
        }
    } else {
        let title_primary = extract_primary_segment(&clean_title);
        if !clean_artist.is_empty() {
            push_unique_query(
                &mut queries,
                &mut seen,
                format!("{} {}", title_primary, clean_artist),
            );
        }
        push_unique_query(&mut queries, &mut seen, title_primary.clone());
        push_unique_query(&mut queries, &mut seen, clean_title.clone());
    }

    // 4. Short core-phrase fallback for very long titles (first 5 words of cleanest title side)
    let core_source = split_title_parts(&clean_title)
        .map(|(l, r)| {
            let lp = extract_primary_segment(&l);
            let rp = extract_primary_segment(&r);
            if lp.len() >= rp.len() {
                lp
            } else {
                rp
            }
        })
        .unwrap_or_else(|| extract_primary_segment(&clean_title));

    let core_words: Vec<&str> = core_source.split_whitespace().collect();
    if core_words.len() > 5 {
        push_unique_query(&mut queries, &mut seen, core_words[..5].join(" "));
    }

    queries
}

fn tokenize(input: &str) -> HashSet<String> {
    let norm = normalize_quotes(input).to_lowercase();
    norm.split(|c: char| !c.is_alphanumeric() && c != '\'')
        .map(|w| w.trim_matches('\''))
        .filter(|w| !w.is_empty())
        .map(String::from)
        .collect()
}

fn score_suggestion(
    item: &LyricsSuggestion,
    reference_tokens: &HashSet<String>,
    target_duration_sec: u64,
) -> f64 {
    if reference_tokens.is_empty() {
        return if item.synced_lyrics.is_some() { 10.0 } else { 0.0 };
    }

    let track_tokens = tokenize(&item.track_name);
    let artist_tokens = tokenize(&item.artist_name);

    let title_hits = track_tokens
        .iter()
        .filter(|t| reference_tokens.contains(*t))
        .count();
    let artist_hits = artist_tokens
        .iter()
        .filter(|t| reference_tokens.contains(*t))
        .count();

    let title_cov = if track_tokens.is_empty() {
        0.0
    } else {
        title_hits as f64 / track_tokens.len() as f64
    };
    let artist_cov = if artist_tokens.is_empty() {
        0.0
    } else {
        artist_hits as f64 / artist_tokens.len() as f64
    };

    let mut score = title_cov * 60.0
        + (title_hits.min(8) as f64) * 5.0
        + artist_cov * 35.0
        + (artist_hits.min(4) as f64) * 4.0;

    // Slight preference for synced lyrics when match quality is comparable
    if item.synced_lyrics.is_some() {
        score += 8.0;
    }

    // Gentle duration bonus (without penalizing extended / live versions)
    if target_duration_sec > 0 && item.duration_sec > 0 {
        let diff = target_duration_sec.abs_diff(item.duration_sec);
        if diff <= 8 {
            score += 10.0;
        } else if diff <= 25 {
            score += 4.0;
        }
    }

    score
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

fn convert_lrclib_item(idx: usize, item: LrcLibResponse) -> Option<LyricsSuggestion> {
    let synced_opt = item
        .synced_lyrics
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && lrc_timestamp_re().is_match(s))
        .map(String::from);

    let plain_text = item
        .plain_lyrics
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| {
            synced_opt
                .as_deref()
                .map(clean_lrc_to_plain)
                .filter(|s| !s.is_empty())
        })?;

    let track_name = item.track_name.unwrap_or_default().trim().to_string();
    if track_name.is_empty() {
        return None;
    }

    let artist_name = item.artist_name.unwrap_or_default().trim().to_string();
    let album_name = item.album_name.unwrap_or_default().trim().to_string();
    let duration_sec = item.duration.unwrap_or(0.0).max(0.0).round() as u64;

    Some(LyricsSuggestion {
        id: item.id.unwrap_or(idx as i64),
        track_name,
        artist_name,
        album_name,
        duration_sec,
        lyrics: plain_text,
        synced_lyrics: synced_opt,
    })
}

async fn query_lrclib_candidates(client: &reqwest::Client, query: &str) -> Vec<LyricsSuggestion> {
    if query.trim().len() < 2 {
        return Vec::new();
    }
    let url = format!(
        "https://lrclib.net/api/search?q={}",
        urlencoding(query.trim())
    );
    let Ok(resp) = client.get(&url).send().await else {
        return Vec::new();
    };
    let Ok(items) = resp.json::<Vec<LrcLibResponse>>().await else {
        return Vec::new();
    };

    items
        .into_iter()
        .enumerate()
        .filter_map(|(idx, item)| convert_lrclib_item(idx, item))
        .collect()
}

fn dedupe_and_rank(
    candidates: Vec<LyricsSuggestion>,
    reference_tokens: &HashSet<String>,
    target_duration_sec: u64,
    limit: usize,
) -> Vec<(f64, LyricsSuggestion)> {
    let mut best_by_key: std::collections::HashMap<String, (f64, LyricsSuggestion)> =
        std::collections::HashMap::new();

    for item in candidates {
        let score = score_suggestion(&item, reference_tokens, target_duration_sec);
        let dedupe_key = format!(
            "{}|{}|{}",
            item.track_name.to_lowercase(),
            item.artist_name.to_lowercase(),
            item.duration_sec / 5
        );

        match best_by_key.get(&dedupe_key) {
            Some((prev_score, prev_item)) => {
                // Prefer higher score or the copy that includes synced lyrics
                if score > *prev_score
                    || (prev_item.synced_lyrics.is_none() && item.synced_lyrics.is_some())
                {
                    best_by_key.insert(dedupe_key, (score, item));
                }
            }
            None => {
                best_by_key.insert(dedupe_key, (score, item));
            }
        }
    }

    let mut ranked: Vec<(f64, LyricsSuggestion)> = best_by_key.into_values().collect();
    ranked.sort_by(|a, b| {
        b.0.partial_cmp(&a.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.1.synced_lyrics.is_some().cmp(&a.1.synced_lyrics.is_some()))
    });
    ranked.truncate(limit);
    ranked
}

/// Fetches lyrics from Genius API + scrape fallback (fails fast on non-200/Cloudflare)
async fn search_genius(client: &reqwest::Client, query: &str) -> Option<String> {
    if query.trim().is_empty() {
        return None;
    }
    let url = format!(
        "https://genius.com/api/search/multi?q={}",
        urlencoding(query.trim())
    );
    let resp = client.get(&url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let data: GeniusSearchResponse = resp.json().await.ok()?;

    let first_hit = data
        .response
        .sections
        .into_iter()
        .flat_map(|s| s.hits)
        .next()?;

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

/// Smart auto-fetch: handles "Title - Artist", "Artist - Title", collaborations, extended/live tags,
/// curly apostrophes, and returns both plain & synced lyrics plus ranked matching alternatives.
pub async fn fetch_full_lyrics(
    raw_title: &str,
    raw_artist: &str,
    duration_sec: u64,
) -> LyricsPayload {
    let client = http_client();
    let queries = build_smart_queries(raw_title, raw_artist);

    let ref_text = if is_generic_source_name(raw_artist) {
        normalize_text(raw_title)
    } else {
        format!("{} {}", normalize_text(raw_title), normalize_text(raw_artist))
    };
    let reference_tokens = tokenize(&ref_text);

    let mut collected: Vec<LyricsSuggestion> = Vec::new();

    for q in queries.iter().take(4) {
        let batch = query_lrclib_candidates(client, q).await;
        if !batch.is_empty() {
            collected.extend(batch);
            let ranked_now = dedupe_and_rank(collected.clone(), &reference_tokens, duration_sec, 6);
            if let Some((top_score, _)) = ranked_now.first() {
                if *top_score >= 60.0 {
                    break;
                }
            }
        }
    }

    let ranked = dedupe_and_rank(collected, &reference_tokens, duration_sec, 6);
    if let Some((_, best)) = ranked.first() {
        let suggestions: Vec<LyricsSuggestion> = ranked.iter().map(|(_, s)| s.clone()).collect();
        return LyricsPayload {
            plain_lyrics: best.lyrics.clone(),
            synced_lyrics: best.synced_lyrics.clone(),
            track_name: Some(best.track_name.clone()),
            artist_name: Some(best.artist_name.clone()),
            status: "found".to_string(),
            suggestions,
        };
    }

    // Single best-effort Genius fallback if all smart LRCLIB queries missed
    if let Some(fallback_q) = queries.first() {
        if let Some(lyrics) = search_genius(client, fallback_q).await {
            return LyricsPayload {
                plain_lyrics: lyrics,
                synced_lyrics: None,
                track_name: None,
                artist_name: None,
                status: "found".to_string(),
                suggestions: Vec::new(),
            };
        }
    }

    LyricsPayload::not_found(
        "No lyrics found online for this track. Use the search bar above to search manually.",
    )
}

/// Smart live autocomplete suggestions: if raw query misses or returns too few hits
/// (e.g. pasted full YouTube title with collaborations/brackets), automatically cascades to smart queries
/// and ranks all tracks containing the title by relevance.
pub async fn suggest_lyrics(query: &str) -> Vec<LyricsSuggestion> {
    let trimmed = query.trim();
    if trimmed.len() < 2 {
        return Vec::new();
    }

    let client = http_client();
    let reference_tokens = tokenize(&normalize_text(trimmed));

    let mut collected = query_lrclib_candidates(client, trimmed).await;

    if collected.len() < 3 {
        let smart_queries = build_smart_queries(trimmed, "");
        let raw_lower = trimmed.to_lowercase();
        let mut extra_calls = 0usize;

        for q in smart_queries {
            if q.to_lowercase() == raw_lower {
                continue;
            }
            let batch = query_lrclib_candidates(client, &q).await;
            extra_calls += 1;
            collected.extend(batch);
            if collected.len() >= 6 || extra_calls >= 3 {
                break;
            }
        }
    }

    dedupe_and_rank(collected, &reference_tokens, 0, 8)
        .into_iter()
        .map(|(_, s)| s)
        .collect()
}

/// Smart manual search when user presses Enter / clicks Search
pub async fn manual_search_lyrics(query: &str) -> LyricsPayload {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return LyricsPayload::not_found("Enter a song title or artist to search.");
    }

    let suggestions = suggest_lyrics(trimmed).await;
    if let Some(best) = suggestions.first() {
        return LyricsPayload {
            plain_lyrics: best.lyrics.clone(),
            synced_lyrics: best.synced_lyrics.clone(),
            track_name: Some(best.track_name.clone()),
            artist_name: Some(best.artist_name.clone()),
            status: "found".to_string(),
            suggestions,
        };
    }

    let client = http_client();
    let fallback_q = build_smart_queries(trimmed, "")
        .into_iter()
        .next()
        .unwrap_or_else(|| trimmed.to_string());

    if let Some(lyrics) = search_genius(client, &fallback_q).await {
        return LyricsPayload {
            plain_lyrics: lyrics,
            synced_lyrics: None,
            track_name: Some(trimmed.to_string()),
            artist_name: Some("Genius".to_string()),
            status: "found".to_string(),
            suggestions: Vec::new(),
        };
    }

    LyricsPayload::not_found("No lyrics found in LRCLIB or Genius for this query.")
}

fn urlencoding(input: &str) -> String {
    url::form_urlencoded::byte_serialize(input.as_bytes()).collect()
}
