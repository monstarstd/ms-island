#![windows_subsystem = "windows"]

mod audio_capture;
mod downloads;
mod drag_out;
mod hotkeys;
mod lyrics;
mod media_manager;
mod system_tools;
mod weather;
mod wifi_share;

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

#[derive(Debug, Clone, Copy)]
struct IslandHitRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    pad: f64,
    full_window: bool,
}

impl Default for IslandHitRect {
    fn default() -> Self {
        Self {
            x: 151.0,
            y: 0.0,
            width: 258.0,
            height: 36.0,
            pad: 0.0,
            full_window: false,
        }
    }
}

struct AppState {
    media_mgr: Arc<Mutex<MediaManager>>,
    cached_track: Arc<Mutex<Option<MediaTrackInfo>>>,
    cached_thumbnail: Arc<Mutex<Option<String>>>,
    sys_monitor: Arc<Mutex<SystemMonitor>>,
    audio_spectrum: Arc<AudioSpectrumCapture>,
    cached_lyrics: Arc<Mutex<lyrics::LyricsPayload>>,
    is_lyrics_open: Arc<Mutex<bool>>,
    clipboard_history: Arc<Mutex<ClipboardSyncPayload>>,
    auto_hide_fullscreen: Arc<AtomicBool>,
    hit_rect: Arc<Mutex<IslandHitRect>>,
    lyrics_hit_rect: Arc<Mutex<IslandHitRect>>,
    island_dock_edge: Arc<Mutex<String>>,
    lyrics_dock_edge: Arc<Mutex<String>>,
    bar_style: Arc<Mutex<String>>,
    lyrics_snapping: Arc<AtomicBool>,
    wifi_share: Arc<wifi_share::WifiShareManager>,
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
async fn get_full_lyrics(state: State<'_, AppState>) -> Result<lyrics::LyricsPayload, ()> {
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
async fn search_lyrics_manual(
    state: State<'_, AppState>,
    query: String,
) -> Result<lyrics::LyricsPayload, ()> {
    let payload = lyrics::manual_search_lyrics(&query).await;
    if payload.status == "found" {
        *lock_safe(&state.cached_lyrics) = payload.clone();
    }
    Ok(payload)
}

#[tauri::command]
async fn suggest_lyrics(query: String) -> Result<Vec<lyrics::LyricsSuggestion>, ()> {
    Ok(lyrics::suggest_lyrics(&query).await)
}

/// Opsi 1 Smart Vertical Stack: keeps Island and Lyrics neatly docked with zero overlap
/// even when both occupy the same screen edge (Right or Left) and both are expanded.
fn arrange_docked_windows(app: &AppHandle, state: &AppState) {
    let Ok(Some(monitor)) = app.primary_monitor() else {
        return;
    };
    let screen_size = monitor.size();
    let screen_w = screen_size.width as i32;
    let screen_h = screen_size.height as i32;
    let scale = monitor.scale_factor().max(1.0);

    let island_edge = lock_safe(&state.island_dock_edge).clone();
    let mut lyrics_edge = lock_safe(&state.lyrics_dock_edge).clone();
    let style = lock_safe(&state.bar_style).clone();

    let side_offset = if style == "island" {
        (10.0 * scale).round() as i32
    } else {
        0
    };
    let top_safe = (52.0 * scale).round() as i32;
    let default_lyrics_y = (72.0 * scale).round() as i32;
    let taskbar_h = (52.0 * scale).round() as i32;
    let gap = (12.0 * scale).round() as i32;

    let island_win = app.get_webview_window("island");
    let lyrics_win = app.get_webview_window("lyrics");
    let island_w = island_win
        .as_ref()
        .and_then(|w| w.outer_size().ok())
        .map(|s| s.width as i32)
        .unwrap_or((560.0 * scale).round() as i32);
    let island_h = island_win
        .as_ref()
        .and_then(|w| w.outer_size().ok())
        .map(|s| s.height as i32)
        .unwrap_or((286.0 * scale).round() as i32);
    let lyrics_w = lyrics_win
        .as_ref()
        .and_then(|w| w.outer_size().ok())
        .map(|s| s.width as i32)
        .unwrap_or((340.0 * scale).round() as i32);
    let lyrics_h = lyrics_win
        .as_ref()
        .and_then(|w| w.outer_size().ok())
        .map(|s| s.height as i32)
        .unwrap_or((468.0 * scale).round() as i32);

    let lyrics_visible = lyrics_win
        .as_ref()
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false);

    // Same-side collision prevention (Opsi 1 Smart Vertical Stack)
    let same_side = (island_edge == "right" || island_edge == "left") && lyrics_edge == island_edge;

    if same_side && lyrics_visible {
        let usable_bottom = screen_h - taskbar_h;
        let compact_top = (12.0 * scale).round() as i32;

        let stack_top_opt = if top_safe + island_h + gap + lyrics_h <= usable_bottom {
            Some(top_safe)
        } else if compact_top + island_h + gap + lyrics_h <= usable_bottom {
            Some(compact_top)
        } else {
            None
        };

        if let Some(stack_top) = stack_top_opt {
            if let Some(iw) = island_win.as_ref() {
                let ix = if island_edge == "right" {
                    (screen_w - island_w).max(0)
                } else {
                    0
                };
                let _ = iw.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                    x: ix,
                    y: stack_top,
                }));
            }
            if let Some(lw) = lyrics_win.as_ref() {
                let lx = if lyrics_edge == "right" {
                    (screen_w - lyrics_w - side_offset).max(0)
                } else {
                    side_offset
                };
                let ly = (stack_top + island_h + gap).min((usable_bottom - lyrics_h).max(12));
                state.lyrics_snapping.store(true, Ordering::Relaxed);
                let _ = lw.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                    x: lx,
                    y: ly,
                }));
                let snap_clear = state.lyrics_snapping.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(80)).await;
                    snap_clear.store(false, Ordering::Relaxed);
                });
            }
            return;
        } else {
            // Very short screen fallback: mirror Lyrics cleanly to opposite side
            lyrics_edge = if island_edge == "right" {
                "left".to_string()
            } else {
                "right".to_string()
            };
            *lock_safe(&state.lyrics_dock_edge) = lyrics_edge.clone();
            let _ = app.emit("lyrics-dock-changed", &lyrics_edge);
        }
    }

    // Standard snapped position when Lyrics is docked on left/right without colliding with Island
    if (lyrics_edge == "right" || lyrics_edge == "left") && lyrics_win.is_some() {
        if let Some(lw) = lyrics_win.as_ref() {
            let lx = if lyrics_edge == "right" {
                (screen_w - lyrics_w - side_offset).max(0)
            } else {
                side_offset
            };
            let current_y = lw.outer_position().map(|p| p.y).unwrap_or(default_lyrics_y);
            let max_y = (screen_h - taskbar_h - lyrics_h).max(top_safe);
            let ly = if current_y < top_safe || current_y > max_y {
                default_lyrics_y.clamp(top_safe, max_y)
            } else {
                current_y
            };
            state.lyrics_snapping.store(true, Ordering::Relaxed);
            let _ = lw.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: lx,
                y: ly,
            }));
            let snap_clear = state.lyrics_snapping.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(80)).await;
                snap_clear.store(false, Ordering::Relaxed);
            });
        }
    }
}

fn ensure_lyrics_on_screen(app: &AppHandle, state: &AppState, lyrics_win: &tauri::WebviewWindow) {
    let edge = lock_safe(&state.lyrics_dock_edge).clone();
    if edge == "right" || edge == "left" {
        arrange_docked_windows(app, state);
        return;
    }

    if let Ok(Some(monitor)) = app.primary_monitor() {
        let screen_size = monitor.size();
        let screen_w = screen_size.width as i32;
        let screen_h = screen_size.height as i32;
        let win_size = lyrics_win.outer_size().ok();
        let win_w = win_size.map(|s| s.width as i32).unwrap_or(340);
        let win_h = win_size.map(|s| s.height as i32).unwrap_or(468);

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
            let x = (screen_w - win_w - 24).max(20);
            let y = 72.min((screen_h - win_h).max(20));
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
            let _ = lyrics_win.unminimize();
            let _ = lyrics_win.show();
            ensure_lyrics_on_screen(&app, &state, &lyrics_win);
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

#[link(name = "dwmapi")]
extern "system" {
    fn DwmSetWindowAttribute(
        hwnd: isize,
        dw_attribute: u32,
        pv_attribute: *const std::ffi::c_void,
        cb_attribute: u32,
    ) -> i32;
}

/// Switches Lyrics window between clean transparent matte ("smoked") and native Windows DWM Acrylic ("acrylic")
#[tauri::command]
fn set_lyrics_backdrop(app: AppHandle, mode: String, is_light: bool) -> String {
    if let Some(lyrics_win) = app.get_webview_window("lyrics") {
        let is_acrylic = mode == "acrylic";

        if is_acrylic {
            let tint = if is_light {
                (244, 244, 241, 188)
            } else {
                (12, 12, 16, 178)
            };
            let _ = window_vibrancy::apply_acrylic(&lyrics_win, Some(tint));
            // Align native Windows 11 OS corners (DWMWCP_ROUND = 2) with the UI border
            if let Ok(hwnd) = lyrics_win.hwnd() {
                const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
                let pref: u32 = 2;
                unsafe {
                    let _ = DwmSetWindowAttribute(
                        hwnd.0 as isize,
                        DWMWA_WINDOW_CORNER_PREFERENCE,
                        &pref as *const u32 as *const std::ffi::c_void,
                        std::mem::size_of::<u32>() as u32,
                    );
                }
            }
            return "acrylic".to_string();
        } else {
            let _ = window_vibrancy::clear_acrylic(&lyrics_win);
            if let Ok(hwnd) = lyrics_win.hwnd() {
                const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
                let pref: u32 = 0; // DWMWCP_DEFAULT
                unsafe {
                    let _ = DwmSetWindowAttribute(
                        hwnd.0 as isize,
                        DWMWA_WINDOW_CORNER_PREFERENCE,
                        &pref as *const u32 as *const std::ffi::c_void,
                        std::mem::size_of::<u32>() as u32,
                    );
                }
            }
            return "smoked".to_string();
        }
    }
    "smoked".to_string()
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
async fn play_timer_chime() -> Result<(), ()> {
    let _ = tokio::task::spawn_blocking(system_tools::play_native_timer_chime).await;
    Ok(())
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
fn reset_island_position(app: AppHandle, state: State<AppState>) {
    *lock_safe(&state.island_dock_edge) = "top".to_string();
    center_island_on_primary_monitor(&app);
    let _ = app.emit("island-dock-changed", "top");
    arrange_docked_windows(&app, &state);
}

#[tauri::command]
fn dock_island_to_edge(app: AppHandle, state: State<AppState>, edge: String) {
    if let (Ok(Some(monitor)), Some(island_win)) =
        (app.primary_monitor(), app.get_webview_window("island"))
    {
        let screen_size = monitor.size();
        let screen_w = screen_size.width as i32;
        let screen_h = screen_size.height as i32;
        let win_size = island_win.outer_size().ok();
        let win_w = win_size.map(|s| s.width as i32).unwrap_or(560);
        let win_h = win_size.map(|s| s.height as i32).unwrap_or(286);

        let (x, y, normalized_edge) = match edge.as_str() {
            "left" => (0, ((screen_h - win_h) / 2).max(48), "left"),
            "right" => ((screen_w - win_w).max(0), ((screen_h - win_h) / 2).max(48), "right"),
            _ => ((screen_w - win_w) / 2, 0, "top"),
        };

        *lock_safe(&state.island_dock_edge) = normalized_edge.to_string();
        let _ = island_win.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x,
            y,
        }));
        let _ = app.emit("island-dock-changed", normalized_edge);
        arrange_docked_windows(&app, &state);
    }
}

#[tauri::command]
fn set_bar_style(app: AppHandle, state: State<AppState>, style: String) {
    let normalized = if style == "island" { "island" } else { "notch" };
    *lock_safe(&state.bar_style) = normalized.to_string();
    let _ = app.emit("bar-style-changed", normalized);
    arrange_docked_windows(&app, &state);
}

#[tauri::command]
fn dock_lyrics_to_edge(app: AppHandle, state: State<AppState>, edge: String) {
    let normalized = match edge.as_str() {
        "left" => "left",
        "right" => "right",
        _ => "floating",
    };
    *lock_safe(&state.lyrics_dock_edge) = normalized.to_string();
    let _ = app.emit("lyrics-dock-changed", normalized);
    arrange_docked_windows(&app, &state);
}

#[tauri::command]
fn set_lyrics_hit_rect(
    state: State<AppState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    pad: Option<f64>,
    full_window: bool,
) {
    *lock_safe(&state.lyrics_hit_rect) = IslandHitRect {
        x,
        y,
        width,
        height,
        pad: pad.unwrap_or(0.0).max(0.0),
        full_window,
    };
}

#[tauri::command]
async fn start_wifi_shelf(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<wifi_share::WifiShareStatus, String> {
    state.wifi_share.start(app).await
}

#[tauri::command]
fn stop_wifi_shelf(state: State<'_, AppState>) -> wifi_share::WifiShareStatus {
    state.wifi_share.stop()
}

#[tauri::command]
fn get_wifi_shelf_status(state: State<'_, AppState>) -> wifi_share::WifiShareStatus {
    state.wifi_share.status()
}

#[tauri::command]
fn sync_wifi_shelf_files(state: State<'_, AppState>, files: Vec<ShelfFileInfo>) {
    state.wifi_share.sync_files(files);
}

#[tauri::command]
async fn open_wifi_save_dir() -> Result<bool, ()> {
    Ok(tokio::task::spawn_blocking(|| {
        let dir = wifi_share::wifi_save_dir();
        let _ = std::fs::create_dir_all(&dir);
        system_tools::open_file_path(&dir.to_string_lossy())
    })
    .await
    .unwrap_or(false))
}

#[tauri::command]
fn quit_app(app: AppHandle, state: State<AppState>) {
    state.wifi_share.stop();
    app.exit(0);
}

#[tauri::command]
fn start_window_drag(window: tauri::WebviewWindow) {
    let _ = window.start_dragging();
}

#[tauri::command]
fn set_island_hit_rect(
    state: State<AppState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    pad: Option<f64>,
    full_window: bool,
) {
    *lock_safe(&state.hit_rect) = IslandHitRect {
        x,
        y,
        width,
        height,
        pad: pad.unwrap_or(0.0).max(0.0),
        full_window,
    };
}

fn main() {
    // 0. Single-instance guard: if already running, wake & re-center the existing instance before exiting
    let _instance_guard = match system_tools::acquire_single_instance_mutex() {
        Some(h) => h,
        None => {
            system_tools::signal_existing_instance_to_show();
            return;
        }
    };

    // Keep auto-start path & ONLOGON task synced to this executable in background
    std::thread::spawn(system_tools::sync_autostart_path_if_enabled);

    let media_mgr = Arc::new(Mutex::new(MediaManager::new()));
    let cached_track = Arc::new(Mutex::new(None::<MediaTrackInfo>));
    let cached_thumbnail = Arc::new(Mutex::new(None::<String>));
    let sys_monitor = Arc::new(Mutex::new(SystemMonitor::new()));
    let audio_spectrum = Arc::new(AudioSpectrumCapture::start());
    let cached_lyrics = Arc::new(Mutex::new(lyrics::LyricsPayload::idle()));
    let is_lyrics_open = Arc::new(Mutex::new(false));
    let clipboard_history = Arc::new(Mutex::new(ClipboardSyncPayload {
        items: Vec::new(),
        windows_history_enabled: false,
    }));
    let auto_hide_fullscreen = Arc::new(AtomicBool::new(true));
    let hit_rect = Arc::new(Mutex::new(IslandHitRect::default()));
    let lyrics_hit_rect = Arc::new(Mutex::new(IslandHitRect {
        x: 0.0,
        y: 0.0,
        width: 340.0,
        height: 468.0,
        pad: 0.0,
        full_window: true,
    }));
    let island_dock_edge = Arc::new(Mutex::new(String::from("top")));
    let lyrics_dock_edge = Arc::new(Mutex::new(String::from("right")));
    let bar_style = Arc::new(Mutex::new(String::from("notch")));
    let lyrics_snapping = Arc::new(AtomicBool::new(false));
    let wifi_share = Arc::new(wifi_share::WifiShareManager::new());

    let media_mgr_clone = media_mgr.clone();
    let cached_track_clone = cached_track.clone();
    let cached_thumb_clone = cached_thumbnail.clone();
    let cached_lyrics_clone = cached_lyrics.clone();
    let clipboard_clone = clipboard_history.clone();
    let auto_hide_clone = auto_hide_fullscreen.clone();
    let hit_rect_clone = hit_rect.clone();
    let lyrics_hit_rect_clone = lyrics_hit_rect.clone();
    let island_dock_edge_setup = island_dock_edge.clone();
    let lyrics_dock_edge_setup = lyrics_dock_edge.clone();
    let lyrics_snapping_setup = lyrics_snapping.clone();
    let own_hwnds_setup = Arc::new(Mutex::new(Vec::<isize>::new()));

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
            hit_rect,
            lyrics_hit_rect,
            island_dock_edge,
            lyrics_dock_edge,
            bar_style,
            lyrics_snapping,
            wifi_share,
        })
        .invoke_handler(tauri::generate_handler![
            get_current_track,
            get_current_thumbnail,
            get_audio_spectrum,
            get_full_lyrics,
            is_lyrics_window_open,
            search_lyrics_manual,
            suggest_lyrics,
            toggle_lyrics_window,
            close_lyrics_window,
            set_lyrics_always_on_top,
            set_lyrics_backdrop,
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
            play_timer_chime,
            reveal_shelf_file,
            start_file_drag_out,
            reset_island_position,
            dock_island_to_edge,
            set_bar_style,
            dock_lyrics_to_edge,
            set_lyrics_hit_rect,
            start_wifi_shelf,
            stop_wifi_shelf,
            get_wifi_shelf_status,
            sync_wifi_shelf_files,
            open_wifi_save_dir,
            quit_app,
            start_window_drag,
            set_island_hit_rect
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

            // 2. Position Main Window & Cache Native HWND ONCE on main thread
            center_island_on_primary_monitor(&app_handle);

            let mut island_hwnd_raw: isize = 0;
            let mut island_scale: f64 = 1.0;

            if let Some(island_win) = app.get_webview_window("island") {
                if let Ok(h) = island_win.hwnd() {
                    island_hwnd_raw = h.0 as isize;
                    lock_safe(&own_hwnds_setup).push(island_hwnd_raw);
                }
                if let Ok(sf) = island_win.scale_factor() {
                    if sf > 0.0 {
                        island_scale = sf;
                    }
                }
                let _ = island_win.show();

                let handle_drop = app_handle.clone();
                let last_edge = Arc::new(Mutex::new(String::from("top")));
                let move_seq = Arc::new(AtomicU64::new(0));
                let is_moving_flag = Arc::new(AtomicBool::new(false));
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

                        let (screen_w, screen_h, win_w, win_h) = match (
                            handle_drop.primary_monitor(),
                            handle_drop.get_webview_window("island"),
                        ) {
                            (Ok(Some(m)), Some(w)) => {
                                let sz = w.outer_size().ok();
                                (
                                    m.size().width as i32,
                                    m.size().height as i32,
                                    sz.map(|s| s.width as i32).unwrap_or(560),
                                    sz.map(|s| s.height as i32).unwrap_or(286),
                                )
                            }
                            _ => (1920, 1080, 560, 286),
                        };

                        let top_dist = pos.y;
                        let left_dist = pos.x;
                        let right_dist = screen_w - (pos.x + win_w);

                        let edge = if left_dist <= 40 && top_dist > 28 {
                            "left"
                        } else if right_dist <= 40 && top_dist > 28 {
                            "right"
                        } else if top_dist <= 24 {
                            "top"
                        } else if left_dist <= 40 {
                            "left"
                        } else if right_dist <= 40 {
                            "right"
                        } else {
                            "floating"
                        };

                        {
                            let mut prev = lock_safe(&last_edge);
                            if prev.as_str() != edge {
                                *prev = edge.to_string();
                                *lock_safe(&island_dock_edge_setup) = edge.to_string();
                                let _ = handle_drop.emit("island-dock-changed", edge);
                            }
                        }

                        let seq = move_seq.fetch_add(1, Ordering::SeqCst) + 1;
                        if !is_moving_flag.swap(true, Ordering::SeqCst) {
                            let _ = handle_drop.emit("island-moving", true);
                        }

                        let seq_check = move_seq.clone();
                        let moving_reset = is_moving_flag.clone();
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
                            if moving_reset.swap(false, Ordering::SeqCst) {
                                let _ = h_snap.emit("island-moving", false);
                            }

                            let max_side_y = (screen_h - win_h - 40).max(40);
                            let clamped_side_y = cur_y.clamp(40, max_side_y);
                            let target = match edge_owned.as_str() {
                                "top" if cur_y != 0 => {
                                    Some((cur_x.clamp(0, (screen_w - win_w).max(0)), 0))
                                }
                                "left" if cur_x != 0 || cur_y != clamped_side_y => {
                                    Some((0, clamped_side_y))
                                }
                                "right"
                                    if cur_x != (screen_w - win_w).max(0)
                                        || cur_y != clamped_side_y =>
                                {
                                    Some(((screen_w - win_w).max(0), clamped_side_y))
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

                            // Re-check Opsi 1 vertical stack if Island settled on Left or Right
                            if edge_owned == "left" || edge_owned == "right" {
                                let h_stack = h_snap.clone();
                                let _ = h_snap.run_on_main_thread(move || {
                                    if let Some(st) = h_stack.try_state::<AppState>() {
                                        arrange_docked_windows(&h_stack, &st);
                                    }
                                });
                            }
                        });
                    }
                    _ => {}
                });
            }

            // Pre-position hidden Lyrics window safely during setup (avoids Windows WebView2 main-thread build deadlock)
            let mut lyrics_hwnd_raw: isize = 0;
            let mut lyrics_scale: f64 = island_scale;

            if let Ok(Some(monitor)) = app.primary_monitor() {
                let screen_size = monitor.size();
                let screen_w = screen_size.width as i32;
                let screen_h = screen_size.height as i32;

                if let Some(lyrics_win) = app.get_webview_window("lyrics") {
                    if let Ok(h) = lyrics_win.hwnd() {
                        lyrics_hwnd_raw = h.0 as isize;
                        lock_safe(&own_hwnds_setup).push(lyrics_hwnd_raw);
                    }
                    if let Ok(sf) = lyrics_win.scale_factor() {
                        if sf > 0.0 {
                            lyrics_scale = sf;
                        }
                    }
                    let lyrics_w = lyrics_win
                        .outer_size()
                        .map(|s| s.width as i32)
                        .unwrap_or(340);
                    let lyrics_h = lyrics_win
                        .outer_size()
                        .map(|s| s.height as i32)
                        .unwrap_or(468);
                    let lyrics_x = (screen_w - lyrics_w).max(0);
                    let lyrics_y = (72.0 * lyrics_scale).round() as i32;
                    let clamped_y = lyrics_y.min((screen_h - lyrics_h - 48).max(20));
                    let _ = lyrics_win.set_position(tauri::Position::Physical(
                        tauri::PhysicalPosition {
                            x: lyrics_x,
                            y: clamped_y,
                        },
                    ));
                    let _ = lyrics_win.hide();

                    let lyrics_win_clone = lyrics_win.clone();
                    let app_handle_close = app_handle.clone();
                    let lyrics_move_seq = Arc::new(AtomicU64::new(0));
                    let lyrics_edge_evt = lyrics_dock_edge_setup.clone();
                    let lyrics_snap_evt = lyrics_snapping_setup.clone();

                    lyrics_win.on_window_event(move |event| match event {
                        WindowEvent::CloseRequested { api, .. } => {
                            api.prevent_close();
                            let _ = lyrics_win_clone.hide();
                            if let Some(st) = app_handle_close.try_state::<AppState>() {
                                *lock_safe(&st.is_lyrics_open) = false;
                            }
                            let _ = app_handle_close.emit("lyrics-visibility-changed", false);
                        }
                        WindowEvent::Moved(pos) => {
                            if lyrics_snap_evt.load(Ordering::Relaxed) {
                                return;
                            }
                            let seq = lyrics_move_seq.fetch_add(1, Ordering::SeqCst) + 1;
                            let seq_check = lyrics_move_seq.clone();
                            let h_snap = app_handle_close.clone();
                            let edge_store = lyrics_edge_evt.clone();
                            let px = pos.x;

                            tauri::async_runtime::spawn(async move {
                                tokio::time::sleep(Duration::from_millis(210)).await;
                                if seq_check.load(Ordering::SeqCst) != seq {
                                    return;
                                }
                                let (sw, lw) = match (
                                    h_snap.primary_monitor(),
                                    h_snap.get_webview_window("lyrics"),
                                ) {
                                    (Ok(Some(m)), Some(w)) => (
                                        m.size().width as i32,
                                        w.outer_size().map(|s| s.width as i32).unwrap_or(340),
                                    ),
                                    _ => (1920, 340),
                                };
                                let new_edge = if px <= 34 {
                                    "left"
                                } else if sw - (px + lw) <= 34 {
                                    "right"
                                } else {
                                    "floating"
                                };

                                let changed = {
                                    let mut guard = lock_safe(&edge_store);
                                    if guard.as_str() != new_edge {
                                        *guard = new_edge.to_string();
                                        true
                                    } else {
                                        false
                                    }
                                };
                                if changed {
                                    let _ = h_snap.emit("lyrics-dock-changed", new_edge);
                                }
                                if new_edge == "left" || new_edge == "right" {
                                    let h_ui = h_snap.clone();
                                    let _ = h_snap.run_on_main_thread(move || {
                                        if let Some(st) = h_ui.try_state::<AppState>() {
                                            arrange_docked_windows(&h_ui, &st);
                                        }
                                    });
                                }
                            });
                        }
                        _ => {}
                    });
                }
            }

            // 3A. Dedicated SMTC Media & Lyrics Thread (Isolated MTA COM — zero spam when unchanged)
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
                let mut last_emitted_track: Option<MediaTrackInfo> = None;
                let lyrics_fetch_seq = Arc::new(AtomicU64::new(0));

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
                            if last_emitted_track.as_ref() != Some(&track) {
                                last_emitted_track = Some(track.clone());
                                let _ = handle_media.emit("media-updated", &track);
                            }

                            if track.title != current_lyrics_title {
                                current_lyrics_title = track.title.clone();
                                let title_for_fetch = track.title.clone();
                                let artist_for_fetch = track.artist.clone();
                                let duration_sec = track.duration_sec;

                                let handle_inner = handle_media.clone();
                                let cached_inner = cached_lyrics_clone.clone();
                                let seq_inner = lyrics_fetch_seq.clone();
                                let my_seq = lyrics_fetch_seq.fetch_add(1, Ordering::SeqCst) + 1;

                                let loading_payload = lyrics::LyricsPayload::loading();
                                *lock_safe(&cached_inner) = loading_payload.clone();
                                let _ = handle_inner.emit("lyrics-updated", &loading_payload);

                                tauri::async_runtime::spawn(async move {
                                    let payload = lyrics::fetch_full_lyrics(
                                        &title_for_fetch,
                                        &artist_for_fetch,
                                        duration_sec,
                                    )
                                    .await;

                                    if seq_inner.load(Ordering::SeqCst) == my_seq {
                                        *lock_safe(&cached_inner) = payload.clone();
                                        let _ = handle_inner.emit("lyrics-updated", &payload);
                                    }
                                });
                            }
                        }
                        _ => {
                            if had_active_track {
                                had_active_track = false;
                                last_emitted_track = None;
                                current_lyrics_title.clear();
                                lyrics_fetch_seq.fetch_add(1, Ordering::SeqCst);
                                let idle_payload = lyrics::LyricsPayload::idle();
                                *lock_safe(&cached_lyrics_clone) = idle_payload.clone();
                                let _ = handle_media.emit("media-cleared", ());
                                let _ = handle_media.emit("lyrics-updated", &idle_payload);
                            }
                        }
                    }

                    std::thread::sleep(Duration::from_millis(450));
                }
            });

            // 3B. Dedicated System, Clipboard (Win+V), Battery & Fullscreen Thread (Event-driven Clipboard)
            let handle_bg = app_handle.clone();
            let own_hwnds_bg = own_hwnds_setup.clone();
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

                    // B. Windows Clipboard History (Win + V) — strictly sequence-driven (0 idle WinRT churn)
                    let prev_seq = last_clip_seq;
                    let clip_changed_text =
                        system_tools::read_clipboard_text_if_changed(&mut last_clip_seq);
                    if tick_count == 1 || last_clip_seq != prev_seq {
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
                            let hwnds_snapshot = lock_safe(&own_hwnds_bg).clone();
                            let is_fs = system_tools::is_other_app_fullscreen(&hwnds_snapshot);
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

            // 3E. Re-launch Wake Listener (if user runs ms-island again, immediately un-hide & re-center!)
            let wake_handle = app_handle.clone();
            system_tools::spawn_wake_event_listener(move || {
                let h_ui = wake_handle.clone();
                let _ = wake_handle.run_on_main_thread(move || {
                    center_island_on_primary_monitor(&h_ui);
                    let _ = h_ui.emit("island-dock-changed", "top");
                    if let Some(w) = h_ui.get_webview_window("island") {
                        let _ = w.unminimize();
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                    let _ = h_ui.emit(
                        "island-toast",
                        IslandToast {
                            kind: "refresh".to_string(),
                            message: "MS Island Ready".to_string(),
                        },
                    );
                });
            });

            // 3F. Smart Native Click-Through Hit-Test (strictly matches visible idle pill & Lyrics peek bounds)
            if island_hwnd_raw != 0 || lyrics_hwnd_raw != 0 {
                let h_hit = app_handle.clone();
                std::thread::spawn(move || {
                    let mut last_island_ignore = false;
                    let mut last_lyrics_ignore = false;

                    loop {
                        std::thread::sleep(Duration::from_millis(25));

                        // A. Island window click-through
                        if island_hwnd_raw != 0 {
                            let rect = *lock_safe(&hit_rect_clone);
                            let should_ignore = if rect.full_window {
                                false
                            } else if let Some(((cx, cy), (wx, wy))) =
                                system_tools::get_cursor_and_window_origin(island_hwnd_raw)
                            {
                                let pad_px: i32 = (rect.pad * island_scale).round() as i32;
                                let left = wx + (rect.x * island_scale).floor() as i32 - pad_px;
                                let top = wy + (rect.y * island_scale).floor() as i32 - pad_px;
                                let right = wx
                                    + ((rect.x + rect.width) * island_scale).ceil() as i32
                                    + pad_px;
                                let bottom = wy
                                    + ((rect.y + rect.height) * island_scale).ceil() as i32
                                    + pad_px;
                                !(cx >= left && cx <= right && cy >= top && cy <= bottom)
                            } else {
                                false
                            };

                            if should_ignore != last_island_ignore {
                                last_island_ignore = should_ignore;
                                let h_ui = h_hit.clone();
                                let _ = h_hit.run_on_main_thread(move || {
                                    if let Some(w) = h_ui.get_webview_window("island") {
                                        let _ = w.set_ignore_cursor_events(should_ignore);
                                    }
                                });
                            }
                        }

                        // B. Lyrics window Auto-Peek click-through
                        if lyrics_hwnd_raw != 0 {
                            let rect = *lock_safe(&lyrics_hit_rect_clone);
                            let should_ignore = if rect.full_window {
                                false
                            } else if let Some(((cx, cy), (wx, wy))) =
                                system_tools::get_cursor_and_window_origin(lyrics_hwnd_raw)
                            {
                                let pad_px: i32 = (rect.pad * lyrics_scale).round() as i32;
                                let left = wx + (rect.x * lyrics_scale).floor() as i32 - pad_px;
                                let top = wy + (rect.y * lyrics_scale).floor() as i32 - pad_px;
                                let right = wx
                                    + ((rect.x + rect.width) * lyrics_scale).ceil() as i32
                                    + pad_px;
                                let bottom = wy
                                    + ((rect.y + rect.height) * lyrics_scale).ceil() as i32
                                    + pad_px;
                                !(cx >= left && cx <= right && cy >= top && cy <= bottom)
                            } else {
                                false
                            };

                            if should_ignore != last_lyrics_ignore {
                                last_lyrics_ignore = should_ignore;
                                let h_ui = h_hit.clone();
                                let _ = h_hit.run_on_main_thread(move || {
                                    if let Some(w) = h_ui.get_webview_window("lyrics") {
                                        let _ = w.set_ignore_cursor_events(should_ignore);
                                    }
                                });
                            }
                        }
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running MSIsland application");
}
