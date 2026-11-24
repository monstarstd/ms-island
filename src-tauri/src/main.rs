#![windows_subsystem = "windows"]

mod lyrics;
mod media_manager;

use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use media_manager::{MediaManager, MediaTrackInfo};

struct AppState {
    media_mgr: Arc<Mutex<MediaManager>>,
    cached_lyrics: Arc<Mutex<String>>,
    is_lyrics_open: Arc<Mutex<bool>>,
}

#[tauri::command]
fn get_current_track(state: State<AppState>) -> Option<MediaTrackInfo> {
    let mut mgr = state.media_mgr.lock().unwrap();
    mgr.get_current_track_info()
}

#[tauri::command]
fn get_full_lyrics(state: State<AppState>) -> String {
    let lyrics_lock = state.cached_lyrics.lock().unwrap();
    lyrics_lock.clone()
}

#[tauri::command]
fn is_lyrics_window_open(state: State<AppState>) -> bool {
    let open_lock = state.is_lyrics_open.lock().unwrap();
    *open_lock
}

#[tauri::command]
async fn search_lyrics_manual(state: State<'_, AppState>, query: String) -> Result<String, ()> {
    if let Some(lyrics) = lyrics::manual_search_lyrics(&query).await {
        *state.cached_lyrics.lock().unwrap() = lyrics.clone();
        Ok(lyrics)
    } else {
        Ok(String::from("No lyrics found in LRCLIB or Genius for this query."))
    }
}

#[tauri::command]
fn toggle_lyrics_window(app: AppHandle, state: State<AppState>) -> bool {
    let mut open_lock = state.is_lyrics_open.lock().unwrap();
    let new_state = !*open_lock;
    *open_lock = new_state;

    if let Some(lyrics_win) = app.get_webview_window("lyrics") {
        if new_state {
            let _ = lyrics_win.show();
            let _ = lyrics_win.set_focus();
        } else {
            let _ = lyrics_win.hide();
        }
    }

    let _ = app.emit("lyrics-visibility-changed", new_state);
    new_state
}

#[tauri::command]
fn close_lyrics_window(app: AppHandle, state: State<AppState>) {
    let mut open_lock = state.is_lyrics_open.lock().unwrap();
    *open_lock = false;
    if let Some(lyrics_win) = app.get_webview_window("lyrics") {
        let _ = lyrics_win.hide();
    }
    let _ = app.emit("lyrics-visibility-changed", false);
}

#[tauri::command]
fn toggle_play_pause(state: State<AppState>) -> bool {
    let mut mgr = state.media_mgr.lock().unwrap();
    mgr.toggle_play_pause()
}

#[tauri::command]
fn skip_next(state: State<AppState>) -> bool {
    let mut mgr = state.media_mgr.lock().unwrap();
    mgr.skip_next()
}

#[tauri::command]
fn skip_prev(state: State<AppState>) -> bool {
    let mut mgr = state.media_mgr.lock().unwrap();
    mgr.skip_prev()
}

#[tauri::command]
fn seek_position(state: State<AppState>, position_sec: u64) -> bool {
    let mut mgr = state.media_mgr.lock().unwrap();
    mgr.seek_position(position_sec)
}

fn main() {
    let media_mgr = Arc::new(Mutex::new(MediaManager::new()));
    let cached_lyrics = Arc::new(Mutex::new(String::new()));
    let is_lyrics_open = Arc::new(Mutex::new(false));

    let media_mgr_clone = media_mgr.clone();
    let cached_lyrics_clone = cached_lyrics.clone();

    tauri::Builder::default()
        .manage(AppState {
            media_mgr,
            cached_lyrics,
            is_lyrics_open,
        })
        .invoke_handler(tauri::generate_handler![
            get_current_track,
            get_full_lyrics,
            is_lyrics_window_open,
            search_lyrics_manual,
            toggle_lyrics_window,
            close_lyrics_window,
            toggle_play_pause,
            skip_next,
            skip_prev,
            seek_position
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();

            // Auto-position windows
            if let Ok(Some(monitor)) = app.primary_monitor() {
                let screen_size = monitor.size();
                let screen_w = screen_size.width as i32;
                let screen_h = screen_size.height as i32;

                // Dynamic Island: centered horizontally at top bezel
                if let Some(island_win) = app.get_webview_window("island") {
                    let island_w = 500;
                    let island_x = (screen_w - island_w) / 2;
                    let _ = island_win.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                        x: island_x,
                        y: 0,
                    }));
                    let _ = island_win.show();
                }

                // Dedicated Full Lyrics Window: positioned at right side of screen, hidden by default
                if let Some(lyrics_win) = app.get_webview_window("lyrics") {
                    let lyrics_w = 420;
                    let lyrics_h = 560;
                    let lyrics_x = screen_w - lyrics_w - 40;
                    let lyrics_y = (screen_h - lyrics_h) / 2;
                    let _ = lyrics_win.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                        x: lyrics_x,
                        y: lyrics_y,
                    }));
                    let _ = lyrics_win.hide();
                }
            }

            // Background media & full lyrics sync loop
            tauri::async_runtime::spawn(async move {
                let mut current_lyrics_title = String::new();

                loop {
                    tokio::time::sleep(Duration::from_millis(500)).await;

                    let track_opt = {
                        let mut mgr = media_mgr_clone.lock().unwrap();
                        mgr.get_current_track_info()
                    };

                    if let Some(track) = track_opt {
                        let _ = app_handle.emit("media-updated", &track);

                        // If song changed, fetch new full lyrics
                        if !track.title.is_empty() && track.title != current_lyrics_title {
                            current_lyrics_title = track.title.clone();
                            let title_for_fetch = track.title.clone();
                            let artist_for_fetch = track.artist.clone();
                            let duration_sec = track.duration_sec;

                            let handle_inner = app_handle.clone();
                            let cached_inner = cached_lyrics_clone.clone();

                            // Clear previous lyrics while fetching
                            *cached_inner.lock().unwrap() = String::from("Searching for lyrics...");
                            let _ = handle_inner.emit("lyrics-updated", "Searching for lyrics...");

                            tauri::async_runtime::spawn(async move {
                                let lyrics_text = match lyrics::fetch_full_lyrics(
                                    &title_for_fetch,
                                    &artist_for_fetch,
                                    duration_sec,
                                ).await {
                                    Some(full) => full,
                                    None => String::from("No lyrics found online for this track. Use the search bar above to search manually."),
                                };

                                *cached_inner.lock().unwrap() = lyrics_text.clone();
                                let _ = handle_inner.emit("lyrics-updated", &lyrics_text);
                            });
                        }
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running MSIsland application");
}
