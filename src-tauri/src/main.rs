#![windows_subsystem = "windows"]

mod lyrics;
mod media_manager;
mod system_tools;
mod weather;

use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use media_manager::{MediaManager, MediaTrackInfo};
use system_tools::{SystemMonitor, SystemStats, VolumeInfo};
use weather::WeatherInfo;

struct AppState {
    media_mgr: Arc<Mutex<MediaManager>>,
    sys_monitor: Arc<Mutex<SystemMonitor>>,
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
fn is_lyrics_window_open(app: AppHandle, state: State<AppState>) -> bool {
    let actual_open = if let Some(lyrics_win) = app.get_webview_window("lyrics") {
        let visible = lyrics_win.is_visible().unwrap_or(false);
        let minimized = lyrics_win.is_minimized().unwrap_or(false);
        visible && !minimized
    } else {
        false
    };
    *state.is_lyrics_open.lock().unwrap() = actual_open;
    actual_open
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

fn ensure_lyrics_on_screen(app: &AppHandle, lyrics_win: &tauri::WebviewWindow) {
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let screen_size = monitor.size();
        let screen_w = screen_size.width as i32;
        let screen_h = screen_size.height as i32;
        let win_size = lyrics_win.outer_size().ok();
        let win_w = win_size.map(|s| s.width as i32).unwrap_or(420);
        let win_h = win_size.map(|s| s.height as i32).unwrap_or(560);

        let needs_reposition = match lyrics_win.outer_position() {
            Ok(pos) => {
                pos.x < -win_w + 80
                    || pos.x > screen_w - 80
                    || pos.y < 0
                    || pos.y > screen_h - 80
            }
            Err(_) => true,
        };

        if needs_reposition {
            let x = (screen_w - win_w - 40).max(20);
            let y = ((screen_h - win_h) / 2).max(40);
            let _ = lyrics_win.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x,
                y,
            }));
        }
    }
}

#[tauri::command]
fn toggle_lyrics_window(app: AppHandle, state: State<AppState>) -> bool {
    let mut open_lock = state.is_lyrics_open.lock().unwrap();

    if let Some(lyrics_win) = app.get_webview_window("lyrics") {
        let currently_visible = lyrics_win.is_visible().unwrap_or(false);
        let currently_minimized = lyrics_win.is_minimized().unwrap_or(false);
        let should_show = !currently_visible || currently_minimized;

        if should_show {
            ensure_lyrics_on_screen(&app, &lyrics_win);
            let _ = lyrics_win.unminimize();
            let _ = lyrics_win.show();
            let _ = lyrics_win.set_always_on_top(true);
            let _ = lyrics_win.set_focus();
            *open_lock = true;
        } else {
            let _ = lyrics_win.hide();
            *open_lock = false;
        }
    } else {
        *open_lock = false;
    }

    let new_state = *open_lock;
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

// -----------------------------------------------------------------------------
// Volume, System Monitor, Weather & Auto-Start Commands
// -----------------------------------------------------------------------------

#[tauri::command]
fn get_volume() -> VolumeInfo {
    system_tools::get_volume_info()
}

#[tauri::command]
fn set_volume(level: u8) -> VolumeInfo {
    system_tools::set_volume_level(level)
}

#[tauri::command]
fn adjust_volume(delta: i8) -> VolumeInfo {
    system_tools::adjust_volume_delta(delta)
}

#[tauri::command]
fn toggle_mute() -> VolumeInfo {
    system_tools::toggle_volume_mute()
}

#[tauri::command]
fn get_system_stats(state: State<AppState>) -> SystemStats {
    let mut mon = state.sys_monitor.lock().unwrap();
    mon.get_stats()
}

#[tauri::command]
async fn get_weather(city: Option<String>) -> Result<WeatherInfo, String> {
    weather::fetch_weather(city).await
}

#[tauri::command]
fn get_autostart() -> bool {
    system_tools::is_autostart_enabled()
}

#[tauri::command]
fn set_autostart(enabled: bool) -> Result<bool, String> {
    system_tools::set_autostart_enabled(enabled)
}

#[tauri::command]
fn start_window_drag(window: tauri::WebviewWindow) {
    let _ = window.start_dragging();
}

fn main() {
    let media_mgr = Arc::new(Mutex::new(MediaManager::new()));
    let sys_monitor = Arc::new(Mutex::new(SystemMonitor::new()));
    let cached_lyrics = Arc::new(Mutex::new(String::new()));
    let is_lyrics_open = Arc::new(Mutex::new(false));

    let media_mgr_clone = media_mgr.clone();
    let cached_lyrics_clone = cached_lyrics.clone();

    tauri::Builder::default()
        .manage(AppState {
            media_mgr,
            sys_monitor,
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
            seek_position,
            get_volume,
            set_volume,
            adjust_volume,
            toggle_mute,
            get_system_stats,
            get_weather,
            get_autostart,
            set_autostart,
            start_window_drag
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();

            // Auto-position windows
            if let Ok(Some(monitor)) = app.primary_monitor() {
                let screen_size = monitor.size();
                let screen_w = screen_size.width as i32;
                let screen_h = screen_size.height as i32;

                // Dynamic Island: centered horizontally at top bezel (DPI-aware)
                if let Some(island_win) = app.get_webview_window("island") {
                    let island_w = island_win
                        .outer_size()
                        .map(|s| s.width as i32)
                        .unwrap_or(540);
                    let island_x = (screen_w - island_w) / 2;
                    let _ = island_win.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                        x: island_x,
                        y: 0,
                    }));
                    let _ = island_win.show();
                }

                // Dedicated Full Lyrics Window: positioned at right side of screen, hidden by default
                if let Some(lyrics_win) = app.get_webview_window("lyrics") {
                    let lyrics_w = lyrics_win
                        .outer_size()
                        .map(|s| s.width as i32)
                        .unwrap_or(420);
                    let lyrics_h = lyrics_win
                        .outer_size()
                        .map(|s| s.height as i32)
                        .unwrap_or(560);
                    let lyrics_x = (screen_w - lyrics_w - 40).max(0);
                    let lyrics_y = ((screen_h - lyrics_h) / 2).max(0);
                    let _ = lyrics_win.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                        x: lyrics_x,
                        y: lyrics_y,
                    }));
                    let _ = lyrics_win.hide();

                    // Never allow OS/Alt+F4/taskbar close to destroy the lyrics window — hide it instead!
                    let lyrics_win_clone = lyrics_win.clone();
                    let app_handle_close = app_handle.clone();
                    lyrics_win.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            api.prevent_close();
                            let _ = lyrics_win_clone.hide();
                            if let Some(st) = app_handle_close.try_state::<AppState>() {
                                *st.is_lyrics_open.lock().unwrap() = false;
                            }
                            let _ = app_handle_close.emit("lyrics-visibility-changed", false);
                        }
                    });
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
