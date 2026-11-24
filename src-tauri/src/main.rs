#![windows_subsystem = "windows"]

mod audio_capture;
mod lyrics;
mod media_manager;
mod system_tools;
mod weather;

use audio_capture::AudioSpectrumCapture;
use media_manager::{MediaManager, MediaTrackInfo};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use system_tools::{
    AudioDeviceInfo, BatteryInfo, ClipboardEntry, ShelfFileInfo, SystemMonitor, SystemStats,
    VolumeInfo,
};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, State, WindowEvent};
use weather::WeatherInfo;

#[derive(Debug, Clone, Serialize)]
struct IslandToast {
    kind: String,
    message: String,
}

struct AppState {
    media_mgr: Arc<Mutex<MediaManager>>,
    sys_monitor: Arc<Mutex<SystemMonitor>>,
    audio_spectrum: Arc<AudioSpectrumCapture>,
    cached_lyrics: Arc<Mutex<String>>,
    is_lyrics_open: Arc<Mutex<bool>>,
    clipboard_history: Arc<Mutex<Vec<ClipboardEntry>>>,
    auto_hide_fullscreen: Arc<AtomicBool>,
}

#[tauri::command]
fn get_current_track(state: State<AppState>) -> Option<MediaTrackInfo> {
    let mut mgr = state.media_mgr.lock().unwrap();
    mgr.get_current_track_info()
}

#[tauri::command]
fn get_audio_spectrum(state: State<AppState>) -> [f32; 8] {
    state.audio_spectrum.get_bands()
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
        let win_w = win_size.map(|s| s.width as i32).unwrap_or(440);
        let win_h = win_size.map(|s| s.height as i32).unwrap_or(580);

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

fn center_island_on_primary_monitor(app: &AppHandle) {
    if let (Ok(Some(monitor)), Some(island_win)) =
        (app.primary_monitor(), app.get_webview_window("island"))
    {
        let screen_w = monitor.size().width as i32;
        let island_w = island_win
            .outer_size()
            .map(|s| s.width as i32)
            .unwrap_or(560);
        let island_x = (screen_w - island_w) / 2;
        let _ = island_win.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: island_x,
            y: 0,
        }));
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
fn set_lyrics_always_on_top(app: AppHandle, pinned: bool) -> bool {
    if let Some(lyrics_win) = app.get_webview_window("lyrics") {
        let _ = lyrics_win.set_always_on_top(pinned);
        return pinned;
    }
    pinned
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
// Volume, Audio Output Switcher, System Monitor, Battery, Clipboard & Shelf
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
fn get_audio_devices() -> Vec<AudioDeviceInfo> {
    system_tools::list_audio_output_devices()
}

#[tauri::command]
fn switch_audio_device(device_id: String) -> Result<bool, String> {
    system_tools::set_default_audio_device(&device_id)
}

#[tauri::command]
fn get_system_stats(state: State<AppState>) -> SystemStats {
    let mut mon = state.sys_monitor.lock().unwrap();
    mon.get_stats()
}

#[tauri::command]
fn get_battery_info() -> BatteryInfo {
    system_tools::get_battery_info()
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
fn get_auto_hide_fullscreen(state: State<AppState>) -> bool {
    state.auto_hide_fullscreen.load(Ordering::Relaxed)
}

#[tauri::command]
fn set_auto_hide_fullscreen(app: AppHandle, state: State<AppState>, enabled: bool) -> bool {
    state.auto_hide_fullscreen.store(enabled, Ordering::Relaxed);
    if !enabled {
        if let Some(island_win) = app.get_webview_window("island") {
            let _ = island_win.show();
        }
    }
    enabled
}

#[tauri::command]
fn get_clipboard_history(state: State<AppState>) -> Vec<ClipboardEntry> {
    state.clipboard_history.lock().unwrap().clone()
}

#[tauri::command]
fn copy_clipboard_item(text: String) -> bool {
    system_tools::write_clipboard_text(&text)
}

#[tauri::command]
fn clear_clipboard_history(state: State<AppState>) {
    state.clipboard_history.lock().unwrap().clear();
}

#[tauri::command]
fn open_shelf_file(path: String) -> bool {
    system_tools::open_file_path(&path)
}

#[tauri::command]
fn reveal_shelf_file(path: String) -> bool {
    system_tools::reveal_file_in_explorer(&path)
}

#[tauri::command]
fn reset_island_position(app: AppHandle) {
    center_island_on_primary_monitor(&app);
}

#[tauri::command]
fn start_window_drag(window: tauri::WebviewWindow) {
    let _ = window.start_dragging();
}

fn format_local_hhmm() -> String {
    // Simple local-ish short tag for clipboard entries
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", secs)
}

fn main() {
    let media_mgr = Arc::new(Mutex::new(MediaManager::new()));
    let sys_monitor = Arc::new(Mutex::new(SystemMonitor::new()));
    let audio_spectrum = Arc::new(AudioSpectrumCapture::start());
    let cached_lyrics = Arc::new(Mutex::new(String::new()));
    let is_lyrics_open = Arc::new(Mutex::new(false));
    let clipboard_history = Arc::new(Mutex::new(Vec::<ClipboardEntry>::new()));
    let auto_hide_fullscreen = Arc::new(AtomicBool::new(true));

    let media_mgr_clone = media_mgr.clone();
    let cached_lyrics_clone = cached_lyrics.clone();
    let clipboard_clone = clipboard_history.clone();
    let auto_hide_clone = auto_hide_fullscreen.clone();

    tauri::Builder::default()
        .manage(AppState {
            media_mgr,
            sys_monitor,
            audio_spectrum,
            cached_lyrics,
            is_lyrics_open,
            clipboard_history,
            auto_hide_fullscreen,
        })
        .invoke_handler(tauri::generate_handler![
            get_current_track,
            get_audio_spectrum,
            get_full_lyrics,
            is_lyrics_window_open,
            search_lyrics_manual,
            toggle_lyrics_window,
            close_lyrics_window,
            set_lyrics_always_on_top,
            toggle_play_pause,
            skip_next,
            skip_prev,
            seek_position,
            get_volume,
            set_volume,
            adjust_volume,
            toggle_mute,
            get_audio_devices,
            switch_audio_device,
            get_system_stats,
            get_battery_info,
            get_weather,
            get_autostart,
            set_autostart,
            get_auto_hide_fullscreen,
            set_auto_hide_fullscreen,
            get_clipboard_history,
            copy_clipboard_item,
            clear_clipboard_history,
            open_shelf_file,
            reveal_shelf_file,
            reset_island_position,
            start_window_drag
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();

            // 1. Setup System Tray Icon & Menu
            if let (Ok(show_i), Ok(lyrics_i), Ok(reset_i), Ok(quit_i)) = (
                MenuItem::with_id(app, "show_island", "Show Dynamic Island", true, None::<&str>),
                MenuItem::with_id(app, "toggle_lyrics", "Toggle Lyrics Window", true, None::<&str>),
                MenuItem::with_id(app, "reset_pos", "Reset Island Position", true, None::<&str>),
                MenuItem::with_id(app, "quit", "Quit MS Island", true, None::<&str>),
            ) {
                if let Ok(menu) = Menu::with_items(app, &[&show_i, &lyrics_i, &reset_i, &quit_i]) {
                    let mut tray_builder = TrayIconBuilder::new()
                        .menu(&menu)
                        .tooltip("MS Island")
                        .on_menu_event(|app_h, event| match event.id.as_ref() {
                            "show_island" => {
                                if let Some(w) = app_h.get_webview_window("island") {
                                    let _ = w.show();
                                    let _ = w.set_focus();
                                }
                            }
                            "toggle_lyrics" => {
                                if let Some(st) = app_h.try_state::<AppState>() {
                                    let _ = toggle_lyrics_window(app_h.clone(), st);
                                }
                            }
                            "reset_pos" => {
                                center_island_on_primary_monitor(app_h);
                                if let Some(w) = app_h.get_webview_window("island") {
                                    let _ = w.show();
                                }
                            }
                            "quit" => {
                                app_h.exit(0);
                            }
                            _ => {}
                        })
                        .on_tray_icon_event(|tray, event| {
                            if let TrayIconEvent::Click {
                                button: MouseButton::Left,
                                button_state: MouseButtonState::Up,
                                ..
                            } = event
                            {
                                let app_h = tray.app_handle();
                                if let Some(w) = app_h.get_webview_window("island") {
                                    let _ = w.show();
                                    let _ = w.set_focus();
                                }
                            }
                        });

                    if let Some(icon) = app.default_window_icon() {
                        tray_builder = tray_builder.icon(icon.clone());
                    }
                    let _ = tray_builder.build(app);
                }
            }

            // 2. Position Windows & Bind Native Events
            center_island_on_primary_monitor(&app_handle);
            if let Some(island_win) = app.get_webview_window("island") {
                let _ = island_win.show();

                // Native Drag & Drop File Shelf listener
                let handle_drop = app_handle.clone();
                island_win.on_window_event(move |event| {
                    if let WindowEvent::DragDrop(dd) = event {
                        match dd {
                            DragDropEvent::Enter { .. } => {
                                let _ = handle_drop.emit("shelf-drag-state", true);
                            }
                            DragDropEvent::Leave => {
                                let _ = handle_drop.emit("shelf-drag-state", false);
                            }
                            DragDropEvent::Drop { paths, .. } => {
                                let _ = handle_drop.emit("shelf-drag-state", false);
                                let files: Vec<ShelfFileInfo> = paths
                                    .iter()
                                    .map(|p| system_tools::build_shelf_file_info(p))
                                    .collect();
                                if !files.is_empty() {
                                    let _ = handle_drop.emit("shelf-files-dropped", files);
                                }
                            }
                            _ => {}
                        }
                    }
                });
            }

            if let Ok(Some(monitor)) = app.primary_monitor() {
                let screen_size = monitor.size();
                let screen_w = screen_size.width as i32;
                let screen_h = screen_size.height as i32;

                if let Some(lyrics_win) = app.get_webview_window("lyrics") {
                    let lyrics_w = lyrics_win
                        .outer_size()
                        .map(|s| s.width as i32)
                        .unwrap_or(440);
                    let lyrics_h = lyrics_win
                        .outer_size()
                        .map(|s| s.height as i32)
                        .unwrap_or(580);
                    let lyrics_x = (screen_w - lyrics_w - 40).max(0);
                    let lyrics_y = ((screen_h - lyrics_h) / 2).max(0);
                    let _ = lyrics_win.set_position(tauri::Position::Physical(
                        tauri::PhysicalPosition {
                            x: lyrics_x,
                            y: lyrics_y,
                        },
                    ));
                    let _ = lyrics_win.hide();

                    // Intercept OS/Alt+F4 close so the lyrics window is hidden, never destroyed
                    let lyrics_win_clone = lyrics_win.clone();
                    let app_handle_close = app_handle.clone();
                    lyrics_win.on_window_event(move |event| {
                        if let WindowEvent::CloseRequested { api, .. } = event {
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

            // 3. Background Loop: Media, Lyrics, Clipboard, CapsLock, Battery & Fullscreen Auto-Hide
            let handle_bg = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                let mut current_lyrics_title = String::new();
                let mut last_clip_seq: u32 = 0;
                let mut clip_id_counter: u64 = 1;
                let mut last_caps = system_tools::is_caps_lock_on();
                let mut last_battery = system_tools::get_battery_info();
                let mut hidden_by_fullscreen = false;
                let mut tick_count: u64 = 0;

                // Prime clipboard sequence without emitting old content on startup
                let _ = system_tools::read_clipboard_text_if_changed(&mut last_clip_seq);

                loop {
                    tokio::time::sleep(Duration::from_millis(350)).await;
                    tick_count += 1;

                    // A. Caps Lock live indicator
                    let caps_now = system_tools::is_caps_lock_on();
                    if caps_now != last_caps {
                        last_caps = caps_now;
                        let _ = handle_bg.emit(
                            "island-toast",
                            IslandToast {
                                kind: "caps".to_string(),
                                message: if caps_now {
                                    "Caps Lock ON".to_string()
                                } else {
                                    "Caps Lock OFF".to_string()
                                },
                            },
                        );
                    }

                    // B. Clipboard Watcher (every 350ms, sequence-checked = ~0 CPU)
                    if let Some(copied) = system_tools::read_clipboard_text_if_changed(&mut last_clip_seq) {
                        let mut hist = clipboard_clone.lock().unwrap();
                        hist.retain(|e| e.text != copied);
                        hist.insert(
                            0,
                            ClipboardEntry {
                                id: clip_id_counter,
                                text: copied,
                                timestamp: format_local_hhmm(),
                            },
                        );
                        clip_id_counter += 1;
                        if hist.len() > 10 {
                            hist.truncate(10);
                        }
                        let snapshot = hist.clone();
                        drop(hist);
                        let _ = handle_bg.emit("clipboard-updated", snapshot);
                    }

                    // C. Fullscreen Auto-Hide & Battery Watcher (~every 700ms)
                    if tick_count % 2 == 0 {
                        // Battery plug/unplug & low battery toast
                        let bat_now = system_tools::get_battery_info();
                        if bat_now.has_battery {
                            if bat_now.is_charging != last_battery.is_charging {
                                let msg = if bat_now.is_charging {
                                    format!("Charging • {}%", bat_now.percent)
                                } else {
                                    format!("On Battery • {}%", bat_now.percent)
                                };
                                let _ = handle_bg.emit(
                                    "island-toast",
                                    IslandToast {
                                        kind: "battery".to_string(),
                                        message: msg,
                                    },
                                );
                            } else if !bat_now.is_charging
                                && bat_now.percent <= 15
                                && last_battery.percent > 15
                            {
                                let _ = handle_bg.emit(
                                    "island-toast",
                                    IslandToast {
                                        kind: "battery".to_string(),
                                        message: format!("Low Battery • {}%", bat_now.percent),
                                    },
                                );
                            }
                        }
                        last_battery = bat_now;

                        // Smart Fullscreen Auto-Hide
                        if auto_hide_clone.load(Ordering::Relaxed) {
                            let mut own_hwnds = Vec::new();
                            if let Some(w) = handle_bg.get_webview_window("island") {
                                if let Ok(h) = w.hwnd() {
                                    own_hwnds.push(h.0 as isize);
                                }
                            }
                            if let Some(w) = handle_bg.get_webview_window("lyrics") {
                                if let Ok(h) = w.hwnd() {
                                    own_hwnds.push(h.0 as isize);
                                }
                            }

                            let is_fs = system_tools::is_other_app_fullscreen(&own_hwnds);
                            if is_fs && !hidden_by_fullscreen {
                                hidden_by_fullscreen = true;
                                if let Some(w) = handle_bg.get_webview_window("island") {
                                    let _ = w.hide();
                                }
                            } else if !is_fs && hidden_by_fullscreen {
                                hidden_by_fullscreen = false;
                                if let Some(w) = handle_bg.get_webview_window("island") {
                                    let _ = w.show();
                                }
                            }
                        } else if hidden_by_fullscreen {
                            hidden_by_fullscreen = false;
                            if let Some(w) = handle_bg.get_webview_window("island") {
                                let _ = w.show();
                            }
                        }
                    }

                    // D. Media SMTC & Full Lyrics Sync
                    let track_opt = {
                        let mut mgr = media_mgr_clone.lock().unwrap();
                        mgr.get_current_track_info()
                    };

                    if let Some(track) = track_opt {
                        let _ = handle_bg.emit("media-updated", &track);

                        if !track.title.is_empty() && track.title != current_lyrics_title {
                            current_lyrics_title = track.title.clone();
                            let title_for_fetch = track.title.clone();
                            let artist_for_fetch = track.artist.clone();
                            let duration_sec = track.duration_sec;

                            let handle_inner = handle_bg.clone();
                            let cached_inner = cached_lyrics_clone.clone();

                            *cached_inner.lock().unwrap() = String::from("Searching for lyrics...");
                            let _ = handle_inner.emit("lyrics-updated", "Searching for lyrics...");

                            tauri::async_runtime::spawn(async move {
                                let lyrics_text = match lyrics::fetch_full_lyrics(
                                    &title_for_fetch,
                                    &artist_for_fetch,
                                    duration_sec,
                                )
                                .await
                                {
                                    Some(full) => full,
                                    None => String::from(
                                        "No lyrics found online for this track. Use the search bar above to search manually.",
                                    ),
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
