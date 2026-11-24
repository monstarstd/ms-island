#![windows_subsystem = "windows"]

mod audio_capture;
mod downloads;
mod drag_out;
mod hotkeys;
mod lyrics;
mod media_manager;
mod system_tools;
mod weather;

use audio_capture::AudioSpectrumCapture;
use media_manager::{MediaManager, MediaTrackInfo};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;
use system_tools::{
    AudioDeviceInfo, BatteryInfo, ClipboardEntry, ClipboardSyncPayload, ShelfFileInfo,
    SystemMonitor, SystemStats, VolumeInfo,
};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, State, WindowEvent};
use weather::WeatherInfo;

/// Poison-safe mutex helper so a panic on one thread can never cascade across threads
fn lock_safe<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

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
    clipboard_history: Arc<Mutex<ClipboardSyncPayload>>,
    auto_hide_fullscreen: Arc<AtomicBool>,
}

// -----------------------------------------------------------------------------
// Fast Non-Blocking Cache Reads
// -----------------------------------------------------------------------------

#[tauri::command]
async fn get_current_track(state: State<'_, AppState>) -> Result<Option<MediaTrackInfo>, ()> {
    Ok(lock_safe(&state.cached_track).clone())
}

#[tauri::command]
async fn get_current_thumbnail(state: State<'_, AppState>) -> Result<Option<String>, ()> {
    Ok(lock_safe(&state.cached_thumbnail).clone())
}

#[tauri::command]
async fn get_audio_spectrum(state: State<'_, AppState>) -> Result<[f32; 8], ()> {
    Ok(state.audio_spectrum.get_bands())
}

#[tauri::command]
async fn get_full_lyrics(state: State<'_, AppState>) -> Result<String, ()> {
    Ok(lock_safe(&state.cached_lyrics).clone())
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
    *lock_safe(&state.is_lyrics_open) = actual_open;
    actual_open
}

#[tauri::command]
async fn search_lyrics_manual(state: State<'_, AppState>, query: String) -> Result<String, ()> {
    if let Some(lyrics) = lyrics::manual_search_lyrics(&query).await {
        *lock_safe(&state.cached_lyrics) = lyrics.clone();
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
    let mut open_lock = lock_safe(&state.is_lyrics_open);

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
    *lock_safe(&state.is_lyrics_open) = false;
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
// Async Media Transport & Win32/COM Commands (Worker Thread Pool)
// -----------------------------------------------------------------------------

#[tauri::command]
async fn toggle_play_pause(state: State<'_, AppState>) -> Result<bool, ()> {
    let mgr = state.media_mgr.clone();
    Ok(
        tokio::task::spawn_blocking(move || lock_safe(&mgr).toggle_play_pause())
            .await
            .unwrap_or(false),
    )
}

#[tauri::command]
async fn skip_next(state: State<'_, AppState>) -> Result<bool, ()> {
    let mgr = state.media_mgr.clone();
    Ok(
        tokio::task::spawn_blocking(move || lock_safe(&mgr).skip_next())
            .await
            .unwrap_or(false),
    )
}

#[tauri::command]
async fn skip_prev(state: State<'_, AppState>) -> Result<bool, ()> {
    let mgr = state.media_mgr.clone();
    Ok(
        tokio::task::spawn_blocking(move || lock_safe(&mgr).skip_prev())
            .await
            .unwrap_or(false),
    )
}

#[tauri::command]
async fn seek_position(state: State<'_, AppState>, position_sec: u64) -> Result<bool, ()> {
    let mgr = state.media_mgr.clone();
    Ok(
        tokio::task::spawn_blocking(move || lock_safe(&mgr).seek_position(position_sec))
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
        tokio::task::spawn_blocking(move || lock_safe(&mon).get_stats())
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
async fn get_clipboard_history(state: State<'_, AppState>) -> Result<ClipboardSyncPayload, ()> {
    let store = state.clipboard_history.clone();
    let payload = tokio::task::spawn_blocking(move || {
        if let Some(win_items) = system_tools::fetch_windows_clipboard_history() {
            let next = ClipboardSyncPayload {
                items: win_items,
                windows_history_enabled: true,
            };
            *lock_safe(&store) = next.clone();
            next
        } else {
            let mut guard = lock_safe(&store);
            guard.windows_history_enabled = false;
            guard.clone()
        }
    })
    .await
    .unwrap_or(ClipboardSyncPayload {
        items: vec![],
        windows_history_enabled: false,
    });
    Ok(payload)
}

#[tauri::command]
async fn copy_clipboard_item(id: String, text: String) -> Result<bool, ()> {
    Ok(tokio::task::spawn_blocking(move || {
        system_tools::activate_windows_clipboard_item(&id, &text)
    })
    .await
    .unwrap_or(false))
}

#[tauri::command]
async fn delete_clipboard_item(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<ClipboardSyncPayload, ()> {
    let store = state.clipboard_history.clone();
    let updated = tokio::task::spawn_blocking(move || {
        let _ = system_tools::delete_windows_clipboard_item(&id);
        if let Some(win_items) = system_tools::fetch_windows_clipboard_history() {
            let next = ClipboardSyncPayload {
                items: win_items,
                windows_history_enabled: true,
            };
            *lock_safe(&store) = next.clone();
            next
        } else {
            let mut guard = lock_safe(&store);
            guard.items.retain(|item| item.id != id);
            guard.windows_history_enabled = false;
            guard.clone()
        }
    })
    .await
    .unwrap_or(ClipboardSyncPayload {
        items: vec![],
        windows_history_enabled: false,
    });

    let _ = app.emit("clipboard-updated", &updated);
    Ok(updated)
}

#[tauri::command]
async fn clear_clipboard_history(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ClipboardSyncPayload, ()> {
    let store = state.clipboard_history.clone();
    let updated = tokio::task::spawn_blocking(move || {
        let win_enabled = system_tools::is_windows_clipboard_history_enabled();
        if win_enabled {
            let _ = system_tools::clear_windows_clipboard_history();
        }
        let next = ClipboardSyncPayload {
            items: vec![],
            windows_history_enabled: win_enabled,
        };
        *lock_safe(&store) = next.clone();
        next
    })
    .await
    .unwrap_or(ClipboardSyncPayload {
        items: vec![],
        windows_history_enabled: false,
    });

    let _ = app.emit("clipboard-updated", &updated);
    Ok(updated)
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
async fn start_file_drag_out(app: AppHandle, path: String) -> Result<bool, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let res = drag_out::start_native_file_drag(&path);
        let _ = tx.send(res);
    })
    .map_err(|e| format!("Failed to dispatch OLE drag to main thread: {}", e))?;

    rx.await
        .map_err(|_| "Drag operation cancelled".to_string())?
}

#[tauri::command]
fn reset_island_position(app: AppHandle) {
    center_island_on_primary_monitor(&app);
    let _ = app.emit("island-dock-changed", "top");
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn start_window_drag(window: tauri::WebviewWindow) {
    let _ = window.start_dragging();
}

fn main() {
    // 0. Single-instance guard: exit immediately if another MS Island is already running
    let _instance_guard = match system_tools::acquire_single_instance_mutex() {
        Some(h) => h,
        None => return,
    };

    // Keep auto-start path & ONLOGON task synced to this executable in background
    std::thread::spawn(system_tools::sync_autostart_path_if_enabled);

    let media_mgr = Arc::new(Mutex::new(MediaManager::new()));
    let cached_track = Arc::new(Mutex::new(None::<MediaTrackInfo>));
    let cached_thumbnail = Arc::new(Mutex::new(None::<String>));
    let sys_monitor = Arc::new(Mutex::new(SystemMonitor::new()));
    let audio_spectrum = Arc::new(AudioSpectrumCapture::start());
    let cached_lyrics = Arc::new(Mutex::new(String::new()));
    let is_lyrics_open = Arc::new(Mutex::new(false));
    let clipboard_history = Arc::new(Mutex::new(ClipboardSyncPayload {
        items: Vec::new(),
        windows_history_enabled: false,
    }));
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
            delete_clipboard_item,
            clear_clipboard_history,
            open_shelf_file,
            reveal_shelf_file,
            start_file_drag_out,
            reset_island_position,
            quit_app,
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
                                let _ = app_h.emit("island-dock-changed", "top");
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
                let last_edge = Arc::new(Mutex::new(String::from("top")));
                let move_seq = Arc::new(AtomicU64::new(0));
                let is_snapping = Arc::new(AtomicBool::new(false));
                let snap_flag_evt = is_snapping.clone();

                island_win.on_window_event(move |event| match event {
                    WindowEvent::DragDrop(dd) => match dd {
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
                    },
                    WindowEvent::Moved(pos) => {
                        if snap_flag_evt.load(Ordering::Relaxed) {
                            return;
                        }

                        let (screen_w, win_w) = match (
                            handle_drop.primary_monitor(),
                            handle_drop.get_webview_window("island"),
                        ) {
                            (Ok(Some(m)), Some(w)) => (
                                m.size().width as i32,
                                w.outer_size().map(|s| s.width as i32).unwrap_or(560),
                            ),
                            _ => (1920, 560),
                        };

                        let top_dist = pos.y;
                        let left_dist = pos.x;
                        let right_dist = screen_w - (pos.x + win_w);

                        let edge = if top_dist <= 24 {
                            "top"
                        } else if left_dist <= 26 {
                            "left"
                        } else if right_dist <= 26 {
                            "right"
                        } else {
                            "floating"
                        };

                        {
                            let mut prev = lock_safe(&last_edge);
                            if prev.as_str() != edge {
                                *prev = edge.to_string();
                                let _ = handle_drop.emit("island-dock-changed", edge);
                            }
                        }

                        let seq = move_seq.fetch_add(1, Ordering::SeqCst) + 1;
                        let _ = handle_drop.emit("island-moving", true);

                        let seq_check = move_seq.clone();
                        let h_snap = handle_drop.clone();
                        let snap_guard = snap_flag_evt.clone();
                        let edge_owned = edge.to_string();
                        let cur_x = pos.x;
                        let cur_y = pos.y;

                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(Duration::from_millis(190)).await;
                            if seq_check.load(Ordering::SeqCst) != seq {
                                return;
                            }
                            let _ = h_snap.emit("island-moving", false);

                            let target = match edge_owned.as_str() {
                                "top" if cur_y != 0 => {
                                    Some((cur_x.clamp(0, (screen_w - win_w).max(0)), 0))
                                }
                                "left" if cur_x != 0 => Some((0, cur_y.max(0))),
                                "right" if cur_x != screen_w - win_w => {
                                    Some(((screen_w - win_w).max(0), cur_y.max(0)))
                                }
                                _ => None,
                            };

                            if let Some((tx, ty)) = target {
                                snap_guard.store(true, Ordering::Relaxed);
                                let steps = 6;
                                for step in 1..=steps {
                                    let t = (step as f32) / (steps as f32);
                                    let ease = 1.0 - (1.0 - t).powi(3);
                                    let nx = cur_x + ((tx - cur_x) as f32 * ease).round() as i32;
                                    let ny = cur_y + ((ty - cur_y) as f32 * ease).round() as i32;
                                    let h_ui = h_snap.clone();
                                    let _ = h_snap.run_on_main_thread(move || {
                                        if let Some(w) = h_ui.get_webview_window("island") {
                                            let _ = w.set_position(tauri::Position::Physical(
                                                tauri::PhysicalPosition { x: nx, y: ny },
                                            ));
                                        }
                                    });
                                    tokio::time::sleep(Duration::from_millis(12)).await;
                                }
                                tokio::time::sleep(Duration::from_millis(40)).await;
                                snap_guard.store(false, Ordering::Relaxed);
                            }
                        });
                    }
                    _ => {}
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
                                *lock_safe(&st.is_lyrics_open) = false;
                            }
                            let _ = app_handle_close.emit("lyrics-visibility-changed", false);
                        }
                    });
                }
            }

            // 3A. Dedicated SMTC Media & Lyrics Thread (Isolated MTA COM — NEVER blocked by Clipboard!)
            let media_for_hotkey = media_mgr_clone.clone();
            let handle_media = app_handle.clone();
            std::thread::spawn(move || {
                unsafe {
                    let _ = windows::Win32::System::Com::CoInitializeEx(
                        None,
                        windows::Win32::System::Com::COINIT_MULTITHREADED,
                    );
                }

                let mut current_lyrics_title = String::new();
                let mut had_active_track = false;

                loop {
                    let (track_opt, thumb_opt) = {
                        let mut mgr = lock_safe(&media_mgr_clone);
                        let t = mgr.get_current_track_info();
                        let thumb = if t.is_some() {
                            mgr.get_cached_thumbnail()
                        } else {
                            None
                        };
                        (t, thumb)
                    };

                    *lock_safe(&cached_track_clone) = track_opt.clone();
                    *lock_safe(&cached_thumb_clone) = thumb_opt;

                    match track_opt {
                        Some(track) if !track.title.is_empty() => {
                            had_active_track = true;
                            let _ = handle_media.emit("media-updated", &track);

                            if track.title != current_lyrics_title {
                                current_lyrics_title = track.title.clone();
                                let title_for_fetch = track.title.clone();
                                let artist_for_fetch = track.artist.clone();
                                let duration_sec = track.duration_sec;

                                let handle_inner = handle_media.clone();
                                let cached_inner = cached_lyrics_clone.clone();

                                *lock_safe(&cached_inner) = String::from("Searching for lyrics...");
                                let _ =
                                    handle_inner.emit("lyrics-updated", "Searching for lyrics...");

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

                                    *lock_safe(&cached_inner) = lyrics_text.clone();
                                    let _ = handle_inner.emit("lyrics-updated", &lyrics_text);
                                });
                            }
                        }
                        _ => {
                            if had_active_track {
                                had_active_track = false;
                                current_lyrics_title.clear();
                                *lock_safe(&cached_lyrics_clone) = String::new();
                                let _ = handle_media.emit("media-cleared", ());
                                let _ = handle_media.emit("lyrics-updated", "");
                            }
                        }
                    }

                    std::thread::sleep(Duration::from_millis(400));
                }
            });

            // 3B. Dedicated System, Clipboard (Win+V), Battery & Fullscreen Thread (Isolated MTA COM)
            let handle_bg = app_handle.clone();
            std::thread::spawn(move || {
                unsafe {
                    let _ = windows::Win32::System::Com::CoInitializeEx(
                        None,
                        windows::Win32::System::Com::COINIT_MULTITHREADED,
                    );
                }

                // Post-boot safety re-center once Windows desktop settles
                let h_settle = handle_bg.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    let h_ui = h_settle.clone();
                    let _ = h_settle.run_on_main_thread(move || {
                        center_island_on_primary_monitor(&h_ui);
                        if let Some(w) = h_ui.get_webview_window("island") {
                            let _ = w.show();
                        }
                    });
                });

                let mut last_clip_seq: u32 = 0;
                let mut clip_id_counter: u64 = 1;
                let mut last_caps = system_tools::is_caps_lock_on();
                let mut last_battery = system_tools::get_battery_info();
                let mut hidden_by_fullscreen = false;
                let mut tick_count: u64 = 0;

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

                    // B. Windows Clipboard History (Win + V) Two-Way Sync + Local Fallback
                    let clip_changed_text =
                        system_tools::read_clipboard_text_if_changed(&mut last_clip_seq);
                    if tick_count == 1 || clip_changed_text.is_some() || tick_count % 4 == 0 {
                        if let Some(win_items) = system_tools::fetch_windows_clipboard_history() {
                            let next = ClipboardSyncPayload {
                                items: win_items,
                                windows_history_enabled: true,
                            };
                            let mut guard = lock_safe(&clipboard_clone);
                            if *guard != next {
                                *guard = next.clone();
                                drop(guard);
                                let _ = handle_bg.emit("clipboard-updated", next);
                            }
                        } else if let Some(copied) = clip_changed_text {
                            let mut guard = lock_safe(&clipboard_clone);
                            guard.windows_history_enabled = false;
                            guard.items.retain(|e| e.text != copied);
                            guard.items.insert(
                                0,
                                ClipboardEntry {
                                    id: format!("local-{}", clip_id_counter),
                                    text: copied,
                                    source: "local".to_string(),
                                },
                            );
                            clip_id_counter += 1;
                            if guard.items.len() > 15 {
                                guard.items.truncate(15);
                            }
                            let snapshot = guard.clone();
                            drop(guard);
                            let _ = handle_bg.emit("clipboard-updated", snapshot);
                        }
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

                        // Wait 3s after boot before enabling fullscreen hide so Windows login transitions never hide it
                        if tick_count > 6 && auto_hide_clone.load(Ordering::Relaxed) {
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
                }
            });

            // 3C. Global Keyboard Shortcuts (Alt+I, Alt+L, Alt+Shift+Space)
            hotkeys::spawn_global_hotkeys(
                app_handle.clone(),
                |app_h| {
                    let h_ui = app_h.clone();
                    let _ = app_h.run_on_main_thread(move || {
                        if let Some(st) = h_ui.try_state::<AppState>() {
                            let _ = toggle_lyrics_window(h_ui.clone(), st);
                        }
                    });
                },
                move |app_h| {
                    let mgr = media_for_hotkey.clone();
                    let h = app_h.clone();
                    tauri::async_runtime::spawn_blocking(move || {
                        let _ = lock_safe(&mgr).toggle_play_pause();
                        let _ = h.emit(
                            "island-toast",
                            IslandToast {
                                kind: "media".to_string(),
                                message: "Play / Pause".to_string(),
                            },
                        );
                    });
                },
            );

            // 3D. Live Browser Downloads Watcher (Brave / Chrome / Edge / Firefox -> Auto-Shelf)
            downloads::spawn_downloads_watcher(app_handle.clone());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running MSIsland application");
}
