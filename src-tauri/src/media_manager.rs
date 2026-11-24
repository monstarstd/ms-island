use serde::{Deserialize, Serialize};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession,
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};
use windows::Foundation::TimeSpan;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaTrackInfo {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub thumbnail: Option<String>,
    #[serde(rename = "sourceApp")]
    pub source_app: String,
    #[serde(rename = "isPlaying")]
    pub is_playing: bool,
    #[serde(rename = "positionSec")]
    pub position_sec: u64,
    #[serde(rename = "durationSec")]
    pub duration_sec: u64,
}

pub struct MediaManager {
    manager: Option<GlobalSystemMediaTransportControlsSessionManager>,
}

impl MediaManager {
    pub fn new() -> Self {
        Self { manager: None }
    }

    pub fn ensure_manager(&mut self) -> bool {
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

    pub fn get_current_session(&mut self) -> Option<GlobalSystemMediaTransportControlsSession> {
        if !self.ensure_manager() {
            return None;
        }
        self.manager.as_ref()?.GetCurrentSession().ok()
    }

    pub fn get_current_track_info(&mut self) -> Option<MediaTrackInfo> {
        let session = self.get_current_session()?;
        let app_id = session.SourceAppUserModelId().unwrap_or_default().to_string();

        let source_app = if app_id.to_lowercase().contains("chrome") {
            "Chrome".to_string()
        } else if app_id.to_lowercase().contains("brave") {
            "Brave".to_string()
        } else if app_id.to_lowercase().contains("edge") {
            "Edge".to_string()
        } else if app_id.to_lowercase().contains("spotify") {
            "Spotify".to_string()
        } else {
            "Windows Media".to_string()
        };

        let media_props = session.TryGetMediaPropertiesAsync().ok().and_then(|op| op.get().ok());
        let title = media_props.as_ref().and_then(|p| p.Title().ok()).map(|s| s.to_string()).unwrap_or_default();
        let artist = media_props.as_ref().and_then(|p| p.Artist().ok()).map(|s| s.to_string()).unwrap_or_default();
        let album = media_props.as_ref().and_then(|p| p.AlbumTitle().ok()).map(|s| s.to_string()).unwrap_or_default();

        let is_playing = session
            .GetPlaybackInfo()
            .ok()
            .and_then(|info| info.PlaybackStatus().ok())
            .map(|s| s == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
            .unwrap_or(true);

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
            thumbnail: None, // Can be extended with thumbnail stream conversion
            source_app,
            is_playing,
            position_sec,
            duration_sec,
        })
    }

    pub fn toggle_play_pause(&mut self) -> bool {
        if let Some(session) = self.get_current_session() {
            if let Ok(op) = session.TryTogglePlayPauseAsync() {
                return op.get().unwrap_or(false);
            }
        }
        false
    }

    pub fn skip_next(&mut self) -> bool {
        if let Some(session) = self.get_current_session() {
            if let Ok(op) = session.TrySkipNextAsync() {
                return op.get().unwrap_or(false);
            }
        }
        false
    }

    pub fn skip_prev(&mut self) -> bool {
        if let Some(session) = self.get_current_session() {
            if let Ok(op) = session.TrySkipPreviousAsync() {
                return op.get().unwrap_or(false);
            }
        }
        false
    }

    pub fn seek_position(&mut self, position_sec: u64) -> bool {
        if let Some(session) = self.get_current_session() {
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
