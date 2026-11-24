use serde::{Deserialize, Serialize};
use windows::Foundation::TimeSpan;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession,
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};
use windows::Storage::Streams::{DataReader, IRandomAccessStreamReference};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MediaTrackInfo {
    pub title: String,
    pub artist: String,
    pub album: String,
    #[serde(rename = "thumbId")]
    pub thumb_id: Option<String>,
    #[serde(rename = "sourceApp")]
    pub source_app: String,
    #[serde(rename = "isPlaying")]
    pub is_playing: bool,
    #[serde(rename = "positionSec")]
    pub position_sec: u64,
    #[serde(rename = "durationSec")]
    pub duration_sec: u64,
}

fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(((input.len() + 2) / 3) * 4);
    let mut i = 0;
    while i < input.len() {
        let b0 = input[i] as u32;
        let b1 = if i + 1 < input.len() { input[i + 1] as u32 } else { 0 };
        let b2 = if i + 2 < input.len() { input[i + 2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;

        out.push(TABLE[((triple >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3F) as usize] as char);
        if i + 1 < input.len() {
            out.push(TABLE[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if i + 2 < input.len() {
            out.push(TABLE[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        i += 3;
    }
    out
}

fn extract_thumbnail_data_url(thumb_ref: &IRandomAccessStreamReference) -> Option<String> {
    let stream = thumb_ref.OpenReadAsync().ok()?.get().ok()?;
    let size = stream.Size().ok()?;
    if size == 0 || size > 1_500_000 {
        return None;
    }
    let size_u32 = size as u32;
    let input_stream = stream.GetInputStreamAt(0).ok()?;
    let reader = DataReader::CreateDataReader(&input_stream).ok()?;
    let loaded = reader.LoadAsync(size_u32).ok()?.get().ok()?;
    if loaded == 0 {
        return None;
    }
    let mut bytes = vec![0u8; loaded as usize];
    reader.ReadBytes(&mut bytes).ok()?;

    let mime = if bytes.len() >= 4
        && bytes[0] == 0x89
        && bytes[1] == 0x50
        && bytes[2] == 0x4E
        && bytes[3] == 0x47
    {
        "image/png"
    } else if bytes.len() >= 4 && &bytes[0..4] == b"RIFF" {
        "image/webp"
    } else {
        "image/jpeg"
    };

    Some(format!("data:{};base64,{}", mime, base64_encode(&bytes)))
}

fn is_session_playing(session: &GlobalSystemMediaTransportControlsSession) -> bool {
    session
        .GetPlaybackInfo()
        .ok()
        .and_then(|info| info.PlaybackStatus().ok())
        .map(|s| s == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
        .unwrap_or(false)
}

pub struct MediaManager {
    manager: Option<GlobalSystemMediaTransportControlsSessionManager>,
    cached_thumb_key: String,
    cached_thumb_data: Option<String>,
    thumb_retry_count: u8,
    empty_polls: u32,
}

impl MediaManager {
    pub fn new() -> Self {
        Self {
            manager: None,
            cached_thumb_key: String::new(),
            cached_thumb_data: None,
            thumb_retry_count: 0,
            empty_polls: 0,
        }
    }

    pub fn ensure_manager(&mut self) -> bool {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        if self.manager.is_some() {
            return true;
        }
        if let Ok(op) = GlobalSystemMediaTransportControlsSessionManager::RequestAsync() {
            if let Ok(m) = op.get() {
                self.manager = Some(m);
                return true;
            }
        }
        false
    }

    /// Picks the best active media session:
    /// 1. Any session actively Playing (even if Windows GetCurrentSession points to a paused app)
    /// 2. Windows GetCurrentSession()
    /// 3. First available session in GetSessions()
    pub fn get_best_session(&mut self) -> Option<GlobalSystemMediaTransportControlsSession> {
        if !self.ensure_manager() {
            return None;
        }

        let mgr = self.manager.as_ref()?;
        let mut fallback_first: Option<GlobalSystemMediaTransportControlsSession> = None;

        if let Ok(sessions) = mgr.GetSessions() {
            let count = sessions.Size().unwrap_or(0);
            for i in 0..count {
                if let Ok(s) = sessions.GetAt(i) {
                    if is_session_playing(&s) {
                        self.empty_polls = 0;
                        return Some(s);
                    }
                    if fallback_first.is_none() {
                        fallback_first = Some(s);
                    }
                }
            }
        }

        if let Ok(current) = mgr.GetCurrentSession() {
            self.empty_polls = 0;
            return Some(current);
        }

        if fallback_first.is_some() {
            self.empty_polls = 0;
            return fallback_first;
        }

        // Auto-reconnect SMTC manager after ~4s of no sessions (handles post-boot shell readiness)
        self.empty_polls += 1;
        if self.empty_polls >= 10 {
            self.empty_polls = 0;
            self.manager = None;
            self.cached_thumb_key.clear();
            self.cached_thumb_data = None;
        }
        None
    }

    pub fn get_cached_thumbnail(&self) -> Option<String> {
        self.cached_thumb_data.clone()
    }

    pub fn get_current_track_info(&mut self) -> Option<MediaTrackInfo> {
        let session = self.get_best_session()?;
        let app_id = session.SourceAppUserModelId().unwrap_or_default().to_string();

        let source_app = if app_id.to_lowercase().contains("chrome") {
            "Chrome".to_string()
        } else if app_id.to_lowercase().contains("brave") {
            "Brave".to_string()
        } else if app_id.to_lowercase().contains("edge") {
            "Edge".to_string()
        } else if app_id.to_lowercase().contains("spotify") {
            "Spotify".to_string()
        } else if app_id.to_lowercase().contains("firefox") {
            "Firefox".to_string()
        } else {
            "Windows Media".to_string()
        };

        let media_props = session.TryGetMediaPropertiesAsync().ok().and_then(|op| op.get().ok());
        let title = media_props
            .as_ref()
            .and_then(|p| p.Title().ok())
            .map(|s| s.to_string())
            .unwrap_or_default();
        let artist = media_props
            .as_ref()
            .and_then(|p| p.Artist().ok())
            .map(|s| s.to_string())
            .unwrap_or_default();
        let album = media_props
            .as_ref()
            .and_then(|p| p.AlbumTitle().ok())
            .map(|s| s.to_string())
            .unwrap_or_default();

        let thumb_key = format!("{}|{}", title, artist);
        if thumb_key != self.cached_thumb_key {
            self.cached_thumb_key = thumb_key.clone();
            self.thumb_retry_count = 0;
            self.cached_thumb_data = media_props
                .as_ref()
                .and_then(|p| p.Thumbnail().ok())
                .and_then(|t| extract_thumbnail_data_url(&t));
        } else if self.cached_thumb_data.is_none() && !title.is_empty() && self.thumb_retry_count < 3 {
            self.thumb_retry_count += 1;
            if let Some(data) = media_props
                .as_ref()
                .and_then(|p| p.Thumbnail().ok())
                .and_then(|t| extract_thumbnail_data_url(&t))
            {
                self.cached_thumb_data = Some(data);
            }
        }

        let is_playing = is_session_playing(&session);

        let timeline = session.GetTimelineProperties().ok();
        let (position_sec, duration_sec) = if let Some(t) = timeline {
            let pos_ticks = t.Position().unwrap_or(TimeSpan { Duration: 0 }).Duration;
            let last_updated = t.LastUpdatedTime().unwrap_or_default().UniversalTime;
            let end_ticks = t.EndTime().unwrap_or(TimeSpan { Duration: 0 }).Duration;

            let real_pos_ticks = if is_playing && last_updated > 0 {
                let now_unix_nanos = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos();
                let now_filetime_ticks = ((now_unix_nanos / 100) as i64) + 116_444_736_000_000_000;
                let elapsed = (now_filetime_ticks - last_updated).max(0);
                (pos_ticks + elapsed).min(end_ticks)
            } else {
                pos_ticks
            };

            let pos = (real_pos_ticks.max(0) / 10_000_000) as u64;
            let dur = (end_ticks.max(0) / 10_000_000) as u64;
            (pos, dur)
        } else {
            (0, 0)
        };

        Some(MediaTrackInfo {
            title,
            artist,
            album,
            thumb_id: if self.cached_thumb_data.is_some() {
                Some(self.cached_thumb_key.clone())
            } else {
                None
            },
            source_app,
            is_playing,
            position_sec,
            duration_sec,
        })
    }

    pub fn toggle_play_pause(&mut self) -> bool {
        if let Some(session) = self.get_best_session() {
            if let Ok(op) = session.TryTogglePlayPauseAsync() {
                return op.get().unwrap_or(false);
            }
        }
        false
    }

    pub fn skip_next(&mut self) -> bool {
        if let Some(session) = self.get_best_session() {
            if let Ok(op) = session.TrySkipNextAsync() {
                return op.get().unwrap_or(false);
            }
        }
        false
    }

    pub fn skip_prev(&mut self) -> bool {
        if let Some(session) = self.get_best_session() {
            if let Ok(op) = session.TrySkipPreviousAsync() {
                return op.get().unwrap_or(false);
            }
        }
        false
    }

    pub fn seek_position(&mut self, position_sec: u64) -> bool {
        if let Some(session) = self.get_best_session() {
            let requested_time = TimeSpan {
                Duration: (position_sec as i64) * 10_000_000,
            };
            if let Ok(op) = session.TryChangePlaybackPositionAsync(requested_time.Duration) {
                return op.get().unwrap_or(false);
            }
        }
        false
    }
}
