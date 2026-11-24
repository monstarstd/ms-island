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
    cached_track: Arc<Mutex<Option<MediaTrackInfo>>>,
    cached_thumbnail: Arc<Mutex<Option<String>>>,
    sys_monitor: Arc<Mutex<SystemMonitor>>,
    audio_spectrum: Arc<AudioSpectrumCapture>,
    cached_lyrics: Arc<Mutex<String>>,
    is_lyrics_open: Arc<Mutex<bool>>,
    clipboard_history: Arc<Mutex<Vec<ClipboardEntry>>>,
    auto_hide_fullscreen: Arc<AtomicBool>,
}

// -----------------------------------------------------------------------------
// Fast Non-Blocking Cache Reads (NEVER block Main UI Thread!)
// -----------------------------------------------------------------------------

#[tauri::command]
async fn get_current_track(state: State<'_, AppState>) -> Result<Option<MediaTrackInfo>, ()> {
    Ok(state.cached_track.lock().unwrap().clone())
}

#[tauri::command]
async fn get_current_thumbnail(state: State<'_, AppState>) -> Result<Option<String>, ()> {
    Ok(state.cached_thumbnail.lock().unwrap().clone())
}

#[tauri::command]
async fn get_audio_spectrum(state: State<'_, AppState>) -> Result<[f32; 8], ()> {
    Ok(state.audio_spectrum.get_bands())
}

#[tauri::command]
async fn get_full_lyrics(state: State<'_, AppState>) -> Result<String, ()> {
    Ok(state.cached_lyrics.lock().unwrap().clone())
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

// -----------------------------------------------------------------------------
// Async Media Transport & Win32/COM Commands (Offloaded to MTA worker pool!)
// -----------------------------------------------------------------------------

#[tauri::command]
async fn toggle_play_pause(state: State<'_, AppState>) -> Result<bool, ()> {
    let mgr = state.media_mgr.clone();
    Ok(tokio::task::spawn_blocking(move || mgr.lock().unwrap().toggle_play_pause())
        .await
        .unwrap_or(false))
}

#[tauri::command]
async fn skip_next(state: State<'_, AppState>) -> Result<bool, ()> {
    let mgr = state.media_mgr.clone();
    Ok(tokio::task::spawn_blocking(move || mgr.lock().unwrap().skip_next())
        .await
        .unwrap_or(false))
}

#[tauri::command]
async fn skip_prev(state: State<'_, AppState>) -> Result<bool, ()> {
    let mgr = state.media_mgr.clone();
    Ok(tokio::task::spawn_blocking(move || mgr.lock().unwrap().skip_prev())
        .await
        .unwrap_or(false))
}

#[tauri::command]
async fn seek_position(state: State<'_, AppState>, position_sec: u64) -> Result<bool, ()> {
    let mgr = state.media_mgr.clone();
    Ok(
        tokio::task::spawn_blocking(move || mgr.lock().unwrap().seek_position(position_sec))
            .await
            .unwrap_or(false),
    )
}

#[tauri::command]
async fn get_volume() -> Result<VolumeInfo, ()> {
    Ok(tokio::task::spawn_blocking(system_tools::get_volume_info)
        .await
        .unwrap_or(VolumeInfo {
            level: 50,
            muted: false,
        }))
}

#[tauri::command]
async fn set_volume(level: u8) -> Result<VolumeInfo, ()> {
    Ok(
        tokio::task::spawn_blocking(move || system_tools::set_volume_level(level))
            .await
            .unwrap_or(VolumeInfo {
                level,
                muted: false,
            }),
    )
}

#[tauri::command]
async fn adjust_volume(delta: i8) -> Result<VolumeInfo, ()> {
    Ok(
        tokio::task::spawn_blocking(move || system_tools::adjust_volume_delta(delta))
            .await
            .unwrap_or(VolumeInfo {
                level: 50,
                muted: false,
            }),
    )
}

#[tauri::command]
async fn toggle_mute() -> Result<VolumeInfo, ()> {
    Ok(
        tokio::task::spawn_blocking(system_tools::toggle_volume_mute)
            .await
            .unwrap_or(VolumeInfo {
                level: 50,
                muted: false,
            }),
    )
}

#[tauri::command]
async fn get_audio_devices() -> Result<Vec<AudioDeviceInfo>, ()> {
    Ok(
        tokio::task::spawn_blocking(system_tools::list_audio_output_devices)
            .await
            .unwrap_or_default(),
    )
}

#[tauri::command]
async fn switch_audio_device(device_id: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || system_tools::set_default_audio_device(&device_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_system_stats(state: State<'_, AppState>) -> Result<SystemStats, ()> {
    let mon = state.sys_monitor.clone();
    Ok(
        tokio::task::spawn_blocking(move || mon.lock().unwrap().get_stats())
            .await
            .unwrap_or(SystemStats {
                cpu_percent: 0.0,
                ram_percent: 0.0,
                ram_used_gb: 0.0,
                ram_total_gb: 0.0,
            }),
    )
}

#[tauri::command]
async fn get_battery_info() -> Result<BatteryInfo, ()> {
    Ok(tokio::task::spawn_blocking(system_tools::get_battery_info)
        .await
        .unwrap_or(BatteryInfo {
            has_battery: false,
            percent: 100,
            is_charging: true,
        }))
}

#[tauri::command]
async fn get_weather(city: Option<String>) -> Result<WeatherInfo, String> {
    weather::fetch_weather(city).await
}

#[tauri::command]
async fn get_autostart() -> Result<bool, ()> {
    Ok(
        tokio::task::spawn_blocking(system_tools::is_autostart_enabled)
            .await
            .unwrap_or(false),
    )
}

#[tauri::command]
async fn set_autostart(enabled: bool) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || system_tools::set_autostart_enabled(enabled))
        .await
        .map_err(|e| e.to_string())?
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
async fn get_clipboard_history(state: State<'_, AppState>) -> Result<Vec<ClipboardEntry>, ()> {
    Ok(state.clipboard_history.lock().unwrap().clone())
}

#[tauri::command]
async fn copy_clipboard_item(text: String) -> Result<bool, ()> {
    Ok(
        tokio::task::spawn_blocking(move || system_tools::write_clipboard_text(&text))
            .await
            .unwrap_or(false),
    )
}

#[tauri::command]
fn clear_clipboard_history(state: State<AppState>) {
    state.clipboard_history.lock().unwrap().clear();
}

#[tauri::command]
async fn open_shelf_file(path: String) -> Result<bool, ()> {
    Ok(
        tokio::task::spawn_blocking(move || system_tools::open_file_path(&path))
            .await
            .unwrap_or(false),
    )
}

#[tauri::command]
async fn reveal_shelf_file(path: String) -> Result<bool, ()> {
    Ok(
        tokio::task::spawn_blocking(move || system_tools::reveal_file_in_explorer(&path))
            .await
            .unwrap_or(false),
    )
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
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", secs)
}

fn main() {
    let media_mgr = Arc::new(Mutex::new(MediaManager::new()));
    let cached_track = Arc::new(Mutex::new(None::<MediaTrackInfo>));
    let cached_thumbnail = Arc::new(Mutex::new(None::<String>));
    let sys_monitor = Arc::new(Mutex::new(SystemMonitor::new()));
    let audio_spectrum = Arc::new(AudioSpectrumCapture::start());
    let cached_lyrics = Arc::new(Mutex::new(String::new()));
    let is_lyrics_open = Arc::new(Mutex::new(false));
    let clipboard_history = Arc::new(Mutex::new(Vec::<ClipboardEntry>::new()));
    let auto_hide_fullscreen = Arc::new(AtomicBool::new(true));

    let media_mgr_clone = media_mgr.clone();
    let cached_track_clone = cached_track.clone();
    let cached_thumb_clone = cached_thumbnail.clone();
    let cached_lyrics_clone = cached_lyrics.clone();
    let clipboard_clone = clipboard_history.clone();
    let auto_hide_clone = auto_hide_fullscreen.clone();

    tauri::Builder::default()
        .manage(AppState {
            media_mgr,
            cached_track,
            cached_thumbnail,
            sys_monitor,
            audio_spectrum,
            cached_lyrics,
            is_lyrics_open,
            clipboard_history,
            auto_hide_fullscreen,
        })
        .invoke_handler(tauri::generate_handler![
            get_current_track,
            get_current_thumbnail,
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

            // 2. Position Windows & Cache Native HWNDs ONCE on main thread
            let mut own_hwnds: Vec<isize> = Vec::new();
            center_island_on_primary_monitor(&app_handle);

            if let Some(island_win) = app.get_webview_window("island") {
                if let Ok(h) = island_win.hwnd() {
                    own_hwnds.push(h.0 as isize);
                }
                let _ = island_win.show();

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
                    if let Ok(h) = lyrics_win.hwnd() {
                        own_hwnds.push(h.0 as isize);
                    }
                    let lyrics_w = lyrics_win
                        .outer_size()
                        .map(|s| s.width as i32)
                        .unwrap_or(440);
                    let lyrics_h = lyrics_win
                        .outer_size()
                        .map(|s| s.height as i32)
                        .unwrap_or(580);
                    let lyrics_x = (screen_w - lyrics_w - 40).max(0);
                    let lyrics_y = ((screen_h - lyrics_h) / 2).max(40);
                    let _ = lyrics_win.set_position(tauri::Position::Physical(
                        tauri::PhysicalPosition {
                            x: lyrics_x,
                            y: lyrics_y,
                        },
                    ));
                    let _ = lyrics_win.hide();

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

            // 3. Dedicated Background OS Thread (MTA COM) — NEVER touches Main UI thread locks!
            let handle_bg = app_handle.clone();
            std::thread::spawn(move || {
                let mut current_lyrics_title = String::new();
                let mut last_clip_seq: u32 = 0;
                let mut clip_id_counter: u64 = 1;
                let mut last_caps = system_tools::is_caps_lock_on();
                let mut last_battery = system_tools::get_battery_info();
                let mut hidden_by_fullscreen = false;
                let mut tick_count: u64 = 0;

                // Prime clipboard sequence without capturing pre-existing clipboard
                let _ = system_tools::read_clipboard_text_if_changed(&mut last_clip_seq);

                loop {
                    std::thread::sleep(Duration::from_millis(450));
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

                    // B. Clipboard Watcher (sequence-checked = 0% CPU when idle)
                    if let Some(copied) =
                        system_tools::read_clipboard_text_if_changed(&mut last_clip_seq)
                    {
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

                    // C. Fullscreen Auto-Hide & Battery Watcher (~every 900ms)
                    if tick_count % 2 == 0 {
                        let bat_now = system_tools::get_battery_info();
                        if bat_now.has_battery {
                            if bat_now.is_charging != last_battery.is_charging {
                                let msg = if bat_now.is_charging {
                                    format!("Charging · {}%", bat_now.percent)
                                } else {
                                    format!("On Battery · {}%", bat_now.percent)
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
                                        message: format!("Low Battery · {}%", bat_now.percent),
                                    },
                                );
                            }
                        }
                        last_battery = bat_now;

                        // Smart Fullscreen Auto-Hide (uses cached HWNDs, dispatches show/hide safely)
                        if auto_hide_clone.load(Ordering::Relaxed) {
                            let is_fs = system_tools::is_other_app_fullscreen(&own_hwnds);
                            if is_fs && !hidden_by_fullscreen {
                                hidden_by_fullscreen = true;
                                let h_ui = handle_bg.clone();
                                let _ = handle_bg.run_on_main_thread(move || {
                                    if let Some(w) = h_ui.get_webview_window("island") {
                                        let _ = w.hide();
                                    }
                                });
                            } else if !is_fs && hidden_by_fullscreen {
                                hidden_by_fullscreen = false;
                                let h_ui = handle_bg.clone();
                                let _ = handle_bg.run_on_main_thread(move || {
                                    if let Some(w) = h_ui.get_webview_window("island") {
                                        let _ = w.show();
                                    }
                                });
                            }
                        } else if hidden_by_fullscreen {
                            hidden_by_fullscreen = false;
                            let h_ui = handle_bg.clone();
                            let _ = handle_bg.run_on_main_thread(move || {
                                if let Some(w) = h_ui.get_webview_window("island") {
                                    let _ = w.show();
                                }
                            });
                        }
                    }

                    // D. Media SMTC & Cached Thumbnail Update (runs ONLY on this background thread)
                    let (track_opt, thumb_opt) = {
                        let mut mgr = media_mgr_clone.lock().unwrap();
                        let t = mgr.get_current_track_info();
                        let thumb = mgr.get_cached_thumbnail();
                        (t, thumb)
                    };

                    *cached_track_clone.lock().unwrap() = track_opt.clone();
                    *cached_thumb_clone.lock().unwrap() = thumb_opt;

                    if let Some(track) = track_opt {
                        // Lightweight emit (NO giant base64 image in payload!)
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
