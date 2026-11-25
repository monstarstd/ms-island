use serde::{Deserialize, Serialize};
use std::os::windows::process::CommandExt;
use windows::core::{GUID, HSTRING, PCWSTR};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS, FILETIME, HWND, POINT, RECT};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTOPRIMARY};
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{
    eCommunications, eConsole, eMultimedia, eRender, ERole, IMMDeviceEnumerator,
    MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber, OpenClipboard,
    SetClipboardData,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::System::Registry::{
    RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW, HKEY,
    HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_SZ,
};
use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows::Win32::System::Threading::{
    CreateEventW, CreateMutexW, GetSystemTimes, OpenEventW, SetEvent, WaitForSingleObject,
    EVENT_MODIFY_STATE, INFINITE,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CAPITAL};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetCursorPos, GetForegroundWindow, GetWindowLongW, GetWindowRect,
    IsWindowVisible, GWL_STYLE, SW_SHOWNORMAL, WS_CAPTION, WS_THICKFRAME,
};

const CREATE_NO_WINDOW: u32 = 0x08000000;
const CF_UNICODETEXT: u32 = 13;
const MONITORINFOF_PRIMARY: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeInfo {
    pub level: u8,
    pub muted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemStats {
    #[serde(rename = "cpuPercent")]
    pub cpu_percent: f32,
    #[serde(rename = "ramPercent")]
    pub ram_percent: f32,
    #[serde(rename = "ramUsedGb")]
    pub ram_used_gb: f32,
    #[serde(rename = "ramTotalGb")]
    pub ram_total_gb: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatteryInfo {
    #[serde(rename = "hasBattery")]
    pub has_battery: bool,
    pub percent: u8,
    #[serde(rename = "isCharging")]
    pub is_charging: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
    #[serde(rename = "isDefault")]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClipboardEntry {
    pub id: String,
    pub text: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClipboardSyncPayload {
    pub items: Vec<ClipboardEntry>,
    #[serde(rename = "windowsHistoryEnabled")]
    pub windows_history_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShelfFileInfo {
    pub name: String,
    pub path: String,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: u64,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    pub ext: String,
}

// -----------------------------------------------------------------------------
// 1. Windows Core Audio Master Volume Control
// -----------------------------------------------------------------------------

unsafe fn with_audio_endpoint<F, R>(f: F) -> Option<R>
where
    F: FnOnce(&IAudioEndpointVolume) -> windows::core::Result<R>,
{
    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    let enumerator: IMMDeviceEnumerator =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
    let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).ok()?;
    let endpoint: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None).ok()?;
    f(&endpoint).ok()
}

pub fn get_volume_info() -> VolumeInfo {
    unsafe {
        with_audio_endpoint(|ep| {
            let scalar = ep.GetMasterVolumeLevelScalar().unwrap_or(0.5);
            let muted = ep.GetMute().map(|b| b.as_bool()).unwrap_or(false);
            let level = (scalar * 100.0).round().clamp(0.0, 100.0) as u8;
            Ok(VolumeInfo { level, muted })
        })
        .unwrap_or(VolumeInfo {
            level: 50,
            muted: false,
        })
    }
}

pub fn set_volume_level(level: u8) -> VolumeInfo {
    let clamped = level.min(100);
    let scalar = (clamped as f32) / 100.0;
    unsafe {
        with_audio_endpoint(|ep| {
            let _ = ep.SetMasterVolumeLevelScalar(scalar, std::ptr::null());
            if clamped > 0 {
                let _ = ep.SetMute(false, std::ptr::null());
            }
            let muted = ep.GetMute().map(|b| b.as_bool()).unwrap_or(false);
            Ok(VolumeInfo {
                level: clamped,
                muted,
            })
        })
        .unwrap_or(VolumeInfo {
            level: clamped,
            muted: false,
        })
    }
}

pub fn adjust_volume_delta(delta: i8) -> VolumeInfo {
    let current = get_volume_info();
    let next = (current.level as i16 + delta as i16).clamp(0, 100) as u8;
    set_volume_level(next)
}

pub fn toggle_volume_mute() -> VolumeInfo {
    unsafe {
        with_audio_endpoint(|ep| {
            let currently_muted = ep.GetMute().map(|b| b.as_bool()).unwrap_or(false);
            let next_muted = !currently_muted;
            let _ = ep.SetMute(next_muted, std::ptr::null());
            let scalar = ep.GetMasterVolumeLevelScalar().unwrap_or(0.5);
            let level = (scalar * 100.0).round().clamp(0.0, 100.0) as u8;
            Ok(VolumeInfo {
                level,
                muted: next_muted,
            })
        })
        .unwrap_or_else(get_volume_info)
    }
}

// -----------------------------------------------------------------------------
// 2. Audio Output Device Enumerator & Switcher (COM IPolicyConfig)
// -----------------------------------------------------------------------------

pub fn list_audio_output_devices() -> Vec<AudioDeviceInfo> {
    let mut result = Vec::new();
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            match CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) {
                Ok(e) => e,
                Err(_) => return result,
            };

        let default_id = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .ok()
            .and_then(|d| d.GetId().ok())
            .map(|pw| {
                let s = pw.to_string().unwrap_or_default();
                CoTaskMemFree(Some(pw.0 as *const _));
                s
            })
            .unwrap_or_default();

        let collection = match enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) {
            Ok(c) => c,
            Err(_) => return result,
        };

        let count = collection.GetCount().unwrap_or(0);
        for i in 0..count {
            if let Ok(device) = collection.Item(i) {
                let id = device
                    .GetId()
                    .ok()
                    .map(|pw| {
                        let s = pw.to_string().unwrap_or_default();
                        CoTaskMemFree(Some(pw.0 as *const _));
                        s
                    })
                    .unwrap_or_default();

                let name = device
                    .OpenPropertyStore(STGM_READ)
                    .ok()
                    .and_then(|store| store.GetValue(&PKEY_Device_FriendlyName).ok())
                    .and_then(|prop| PropVariantToStringAlloc(&prop).ok())
                    .map(|pw| {
                        let s = pw.to_string().unwrap_or_default();
                        CoTaskMemFree(Some(pw.0 as *const _));
                        s
                    })
                    .unwrap_or_else(|| format!("Audio Device {}", i + 1));

                if !id.is_empty() {
                    result.push(AudioDeviceInfo {
                        is_default: id == default_id,
                        id,
                        name,
                    });
                }
            }
        }
    }
    result
}

// Undocumented standard Windows COM interface for switching default audio output device
const CLSID_POLICY_CONFIG_CLIENT: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);
const IID_IPOLICY_CONFIG: GUID = GUID::from_u128(0xf8679f50_850a_41cf_9c72_430f290290c8);

#[repr(C)]
struct IPolicyConfigVtbl {
    query_interface: unsafe extern "system" fn(*mut std::ffi::c_void, *const GUID, *mut *mut std::ffi::c_void) -> i32,
    add_ref: unsafe extern "system" fn(*mut std::ffi::c_void) -> u32,
    release: unsafe extern "system" fn(*mut std::ffi::c_void) -> u32,
    _pad: [*const std::ffi::c_void; 10],
    set_default_endpoint: unsafe extern "system" fn(*mut std::ffi::c_void, PCWSTR, ERole) -> i32,
}

#[repr(C)]
struct IPolicyConfigRaw {
    vtbl: *const IPolicyConfigVtbl,
}

pub fn set_default_audio_device(device_id: &str) -> Result<bool, String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let mut raw_ptr: *mut std::ffi::c_void = std::ptr::null_mut();

        // Call CoCreateInstance via windows::Win32::System::Com::CoCreateInstance using IUnknown then QI
        let unk: windows::core::IUnknown =
            CoCreateInstance(&CLSID_POLICY_CONFIG_CLIENT, None, CLSCTX_ALL)
                .map_err(|e| format!("PolicyConfig init failed: {}", e))?;

        let hr = (windows::core::Interface::vtable(&unk).QueryInterface)(
            windows::core::Interface::as_raw(&unk),
            &IID_IPOLICY_CONFIG,
            &mut raw_ptr,
        );

        if hr.is_err() || raw_ptr.is_null() {
            return Err("Failed to query IPolicyConfig interface".to_string());
        }

        let cfg = raw_ptr as *mut IPolicyConfigRaw;
        let id_wide = HSTRING::from(device_id);
        let set_fn = (*(*cfg).vtbl).set_default_endpoint;

        let r1 = set_fn(raw_ptr, PCWSTR(id_wide.as_ptr()), eConsole);
        let _ = set_fn(raw_ptr, PCWSTR(id_wide.as_ptr()), eMultimedia);
        let _ = set_fn(raw_ptr, PCWSTR(id_wide.as_ptr()), eCommunications);

        ((*(*cfg).vtbl).release)(raw_ptr);

        if r1 >= 0 {
            Ok(true)
        } else {
            Err(format!("SetDefaultEndpoint returned HRESULT 0x{:X}", r1))
        }
    }
}

// -----------------------------------------------------------------------------
// 3. Native Windows CPU & RAM Hardware Monitor
// -----------------------------------------------------------------------------

fn filetime_to_u64(ft: FILETIME) -> u64 {
    ((ft.dwHighDateTime as u64) << 32) | (ft.dwLowDateTime as u64)
}

pub struct SystemMonitor {
    prev_idle: u64,
    prev_kernel: u64,
    prev_user: u64,
    initialized: bool,
}

impl SystemMonitor {
    pub fn new() -> Self {
        let mut monitor = Self {
            prev_idle: 0,
            prev_kernel: 0,
            prev_user: 0,
            initialized: false,
        };
        let _ = monitor.read_cpu_percent();
        monitor
    }

    fn read_cpu_percent(&mut self) -> f32 {
        let mut idle = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();

        unsafe {
            if GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)).is_err() {
                return 0.0;
            }
        }

        let idle_now = filetime_to_u64(idle);
        let kernel_now = filetime_to_u64(kernel);
        let user_now = filetime_to_u64(user);

        if !self.initialized {
            self.prev_idle = idle_now;
            self.prev_kernel = kernel_now;
            self.prev_user = user_now;
            self.initialized = true;
            return 0.0;
        }

        let idle_diff = idle_now.saturating_sub(self.prev_idle);
        let kernel_diff = kernel_now.saturating_sub(self.prev_kernel);
        let user_diff = user_now.saturating_sub(self.prev_user);

        self.prev_idle = idle_now;
        self.prev_kernel = kernel_now;
        self.prev_user = user_now;

        let total = kernel_diff + user_diff;
        if total == 0 {
            return 0.0;
        }

        let active = total.saturating_sub(idle_diff);
        ((active as f64 / total as f64) * 100.0).clamp(0.0, 100.0) as f32
    }

    pub fn get_stats(&mut self) -> SystemStats {
        let cpu_percent = (self.read_cpu_percent() * 10.0).round() / 10.0;

        let mut mem = MEMORYSTATUSEX {
            dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
            ..Default::default()
        };

        let (ram_percent, ram_used_gb, ram_total_gb) = unsafe {
            if GlobalMemoryStatusEx(&mut mem).is_ok() {
                let total_gb = (mem.ullTotalPhys as f64) / (1024.0 * 1024.0 * 1024.0);
                let avail_gb = (mem.ullAvailPhys as f64) / (1024.0 * 1024.0 * 1024.0);
                let used_gb = (total_gb - avail_gb).max(0.0);
                let pct = if total_gb > 0.0 {
                    (used_gb / total_gb) * 100.0
                } else {
                    mem.dwMemoryLoad as f64
                };
                (
                    (pct * 10.0).round() as f32 / 10.0,
                    (used_gb * 10.0).round() as f32 / 10.0,
                    (total_gb * 10.0).round() as f32 / 10.0,
                )
            } else {
                (0.0, 0.0, 0.0)
            }
        };

        SystemStats {
            cpu_percent,
            ram_percent,
            ram_used_gb,
            ram_total_gb,
        }
    }
}

// -----------------------------------------------------------------------------
// 4. Battery Status, Caps Lock & Fullscreen Detection
// -----------------------------------------------------------------------------

pub fn get_battery_info() -> BatteryInfo {
    let mut status = SYSTEM_POWER_STATUS::default();
    unsafe {
        if GetSystemPowerStatus(&mut status).is_ok() {
            let has_battery = (status.BatteryFlag & 128) == 0 && status.BatteryFlag != 255;
            let percent = if status.BatteryLifePercent <= 100 {
                status.BatteryLifePercent
            } else {
                100
            };
            let is_charging = status.ACLineStatus == 1;
            return BatteryInfo {
                has_battery,
                percent,
                is_charging,
            };
        }
    }
    BatteryInfo {
        has_battery: false,
        percent: 100,
        is_charging: true,
    }
}

pub fn is_caps_lock_on() -> bool {
    unsafe { (GetKeyState(VK_CAPITAL.0 as i32) & 1) != 0 }
}

/// Returns `(cursor_pos, window_top_left)` in physical screen pixels for smart click-through hit-testing.
pub fn get_cursor_and_window_origin(hwnd_raw: isize) -> Option<((i32, i32), (i32, i32))> {
    if hwnd_raw == 0 {
        return None;
    }
    unsafe {
        let mut pt = POINT::default();
        if GetCursorPos(&mut pt).is_err() {
            return None;
        }
        let mut rect = RECT::default();
        let hwnd = HWND(hwnd_raw as *mut std::ffi::c_void);
        if GetWindowRect(hwnd, &mut rect).is_err() {
            return None;
        }
        Some(((pt.x, pt.y), (rect.left, rect.top)))
    }
}

pub fn is_other_app_fullscreen(own_hwnds: &[isize]) -> bool {
    unsafe {
        let fg = GetForegroundWindow();
        if fg.0.is_null() {
            return false;
        }
        let fg_val = fg.0 as isize;
        if own_hwnds.contains(&fg_val) {
            return false;
        }
        if !IsWindowVisible(fg).as_bool() {
            return false;
        }

        // Exclude Windows desktop shell / system overlay windows
        let mut class_buf = [0u16; 128];
        let len = GetClassNameW(fg, &mut class_buf);
        if len > 0 {
            let class_name = String::from_utf16_lossy(&class_buf[..len as usize]);
            if matches!(
                class_name.as_str(),
                "Progman"
                    | "WorkerW"
                    | "Shell_TrayWnd"
                    | "Shell_SecondaryTrayWnd"
                    | "Windows.UI.Core.CoreWindow"
                    | "XamlExplorerHostIslandWindow"
                    | "ForegroundStaging"
                    | "MultitaskingViewFrame"
            ) {
                return false;
            }
        }

        // Normal maximized desktop windows (VS Code, Explorer, Browser) keep standard framed caption;
        // true fullscreen videos (F11 / HTML5) and games strip WS_CAPTION + WS_THICKFRAME.
        let style = GetWindowLongW(fg, GWL_STYLE) as u32;
        if (style & WS_CAPTION.0) == WS_CAPTION.0 && (style & WS_THICKFRAME.0) != 0 {
            return false;
        }

        let mut win_rect = RECT::default();
        if GetWindowRect(fg, &mut win_rect).is_err() {
            return false;
        }

        let monitor = MonitorFromWindow(fg, MONITOR_DEFAULTTOPRIMARY);
        let mut mon_info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut mon_info).as_bool() {
            return false;
        }

        // Only hide when fullscreen is on the primary monitor (where the Island lives)
        if (mon_info.dwFlags & MONITORINFOF_PRIMARY) == 0 {
            return false;
        }

        let m = mon_info.rcMonitor;
        win_rect.left <= m.left
            && win_rect.top <= m.top
            && win_rect.right >= m.right
            && win_rect.bottom >= m.bottom
    }
}

// -----------------------------------------------------------------------------
// 5. Windows Built-in Clipboard History (Win + V) Two-Way Sync + Local Fallback
// -----------------------------------------------------------------------------

pub fn is_windows_clipboard_history_enabled() -> bool {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    windows::ApplicationModel::DataTransfer::Clipboard::IsHistoryEnabled().unwrap_or(false)
}

pub fn fetch_windows_clipboard_history() -> Option<Vec<ClipboardEntry>> {
    use windows::ApplicationModel::DataTransfer::{
        Clipboard, ClipboardHistoryItemsResultStatus, StandardDataFormats,
    };

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }

    if !Clipboard::IsHistoryEnabled().unwrap_or(false) {
        return None;
    }

    let result = Clipboard::GetHistoryItemsAsync().ok()?.get().ok()?;
    if result.Status().ok()? != ClipboardHistoryItemsResultStatus::Success {
        return None;
    }

    let items = result.Items().ok()?;
    let count = items.Size().unwrap_or(0).min(20);
    let text_format = StandardDataFormats::Text().ok()?;
    let mut entries = Vec::new();

    for i in 0..count {
        if let Ok(item) = items.GetAt(i) {
            let id = item.Id().map(|s| s.to_string()).unwrap_or_default();
            if let Ok(content) = item.Content() {
                if content.Contains(&text_format).unwrap_or(false) {
                    if let Ok(op) = content.GetTextAsync() {
                        if let Ok(txt) = op.get() {
                            let s = txt.to_string();
                            let trimmed = s.trim();
                            if !trimmed.is_empty() {
                                let capped: String = trimmed.chars().take(4000).collect();
                                entries.push(ClipboardEntry {
                                    id,
                                    text: capped,
                                    source: "windows".to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    Some(entries)
}

pub fn activate_windows_clipboard_item(id: &str, fallback_text: &str) -> bool {
    use windows::ApplicationModel::DataTransfer::Clipboard;

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }

    if !id.is_empty() && Clipboard::IsHistoryEnabled().unwrap_or(false) {
        if let Ok(op) = Clipboard::GetHistoryItemsAsync() {
            if let Ok(res) = op.get() {
                if let Ok(items) = res.Items() {
                    let count = items.Size().unwrap_or(0);
                    for i in 0..count {
                        if let Ok(item) = items.GetAt(i) {
                            if item.Id().map(|s| s.to_string()).unwrap_or_default() == id {
                                if Clipboard::SetHistoryItemAsContent(&item).is_ok() {
                                    return true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    write_clipboard_text(fallback_text)
}

pub fn delete_windows_clipboard_item(id: &str) -> bool {
    use windows::ApplicationModel::DataTransfer::Clipboard;

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }

    if id.is_empty() || !Clipboard::IsHistoryEnabled().unwrap_or(false) {
        return false;
    }

    if let Ok(op) = Clipboard::GetHistoryItemsAsync() {
        if let Ok(res) = op.get() {
            if let Ok(items) = res.Items() {
                let count = items.Size().unwrap_or(0);
                for i in 0..count {
                    if let Ok(item) = items.GetAt(i) {
                        if item.Id().map(|s| s.to_string()).unwrap_or_default() == id {
                            return Clipboard::DeleteItemFromHistory(&item).unwrap_or(false);
                        }
                    }
                }
            }
        }
    }
    false
}

pub fn clear_windows_clipboard_history() -> bool {
    use windows::ApplicationModel::DataTransfer::Clipboard;

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }

    if Clipboard::IsHistoryEnabled().unwrap_or(false) {
        return Clipboard::ClearHistory().unwrap_or(false);
    }
    false
}

pub fn read_clipboard_text_if_changed(last_seq: &mut u32) -> Option<String> {
    unsafe {
        let seq = GetClipboardSequenceNumber();
        if seq == 0 || seq == *last_seq {
            return None;
        }
        *last_seq = seq;

        if OpenClipboard(HWND::default()).is_err() {
            return None;
        }

        let mut extracted: Option<String> = None;
        if let Ok(handle) = GetClipboardData(CF_UNICODETEXT) {
            let hmem = windows::Win32::Foundation::HGLOBAL(handle.0);
            let ptr = GlobalLock(hmem) as *const u16;
            if !ptr.is_null() {
                let mut len = 0usize;
                while len < 4000 && *ptr.add(len) != 0 {
                    len += 1;
                }
                let slice = std::slice::from_raw_parts(ptr, len);
                let text = String::from_utf16_lossy(slice).trim().to_string();
                if !text.is_empty() {
                    extracted = Some(text);
                }
                let _ = GlobalUnlock(hmem);
            }
        }
        let _ = CloseClipboard();
        extracted
    }
}

pub fn write_clipboard_text(text: &str) -> bool {
    unsafe {
        if OpenClipboard(HWND::default()).is_err() {
            return false;
        }
        let _ = EmptyClipboard();

        let mut wide: Vec<u16> = text.encode_utf16().collect();
        wide.push(0);
        let bytes = wide.len() * std::mem::size_of::<u16>();

        let ok = if let Ok(hmem) = GlobalAlloc(GMEM_MOVEABLE, bytes) {
            let dst = GlobalLock(hmem) as *mut u16;
            if !dst.is_null() {
                std::ptr::copy_nonoverlapping(wide.as_ptr(), dst, wide.len());
                let _ = GlobalUnlock(hmem);
                SetClipboardData(CF_UNICODETEXT, windows::Win32::Foundation::HANDLE(hmem.0)).is_ok()
            } else {
                false
            }
        } else {
            false
        };

        let _ = CloseClipboard();
        ok
    }
}

// -----------------------------------------------------------------------------
// 6. File Drop Shelf Helpers (Open / Reveal in Explorer)
// -----------------------------------------------------------------------------

pub fn build_shelf_file_info(path: &std::path::Path) -> ShelfFileInfo {
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());
    let ext = path
        .extension()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let meta = std::fs::metadata(path).ok();
    let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
    let size_bytes = meta.as_ref().map(|m| if m.is_dir() { 0 } else { m.len() }).unwrap_or(0);

    ShelfFileInfo {
        name,
        path: path.to_string_lossy().to_string(),
        size_bytes,
        is_dir,
        ext,
    }
}

#[link(name = "winmm")]
extern "system" {
    fn PlaySoundW(psz_sound: *const u16, hmod: isize, fdw_sound: u32) -> i32;
}

#[link(name = "user32")]
extern "system" {
    fn MessageBeep(u_type: u32) -> i32;
}

/// Plays a reliable native Windows notification chime (bypasses WebView2 AudioContext autoplay locks)
pub fn play_native_timer_chime() {
    const SND_ASYNC: u32 = 0x0001;
    const SND_NODEFAULT: u32 = 0x0002;
    const SND_ALIAS: u32 = 0x0001_0000;
    const MB_ICONASTERISK_VAL: u32 = 0x0000_0040;

    let alias = HSTRING::from("SystemNotification");
    unsafe {
        let ok = PlaySoundW(alias.as_ptr(), 0, SND_ALIAS | SND_ASYNC | SND_NODEFAULT);
        if ok == 0 {
            let _ = MessageBeep(MB_ICONASTERISK_VAL);
        }
    }
}

pub fn open_file_path(path: &str) -> bool {
    if !std::path::Path::new(path).exists() {
        return false;
    }
    let verb = HSTRING::from("open");
    let wide_path = HSTRING::from(path);
    unsafe {
        let res = ShellExecuteW(
            HWND::default(),
            PCWSTR(verb.as_ptr()),
            PCWSTR(wide_path.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        );
        (res.0 as isize) > 32
    }
}

pub fn reveal_file_in_explorer(path: &str) -> bool {
    if !std::path::Path::new(path).exists() {
        return false;
    }
    std::process::Command::new("explorer")
        .arg(format!("/select,{}", path))
        .spawn()
        .is_ok()
}

// -----------------------------------------------------------------------------
// 7. Single-Instance Guard & Instant Auto-Start on Windows Boot
// -----------------------------------------------------------------------------

const RUN_SUBKEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const APP_REG_NAME: &str = "MSIsland";
const STARTUP_TASK_NAME: &str = "MSIslandAutoStart";
const WAKE_EVENT_NAME: &str = "Local\\MSIsland_ShowWakeEvent_v1";

/// Ensures only one instance of MS Island runs at a time.
/// Returns Some(handle) if this is the primary instance, or None if another instance is already running.
pub fn acquire_single_instance_mutex() -> Option<isize> {
    let name = HSTRING::from("Local\\MSIsland_SingleInstance_Mutex_v1");
    unsafe {
        if let Ok(handle) = CreateMutexW(None, false, PCWSTR(name.as_ptr())) {
            if GetLastError() == ERROR_ALREADY_EXISTS {
                return None;
            }
            return Some(handle.0 as isize);
        }
    }
    Some(0)
}

/// Signals the already-running MS Island instance to immediately un-hide and re-center on screen.
pub fn signal_existing_instance_to_show() {
    let name = HSTRING::from(WAKE_EVENT_NAME);
    unsafe {
        if let Ok(ev) = OpenEventW(EVENT_MODIFY_STATE, false, PCWSTR(name.as_ptr())) {
            let _ = SetEvent(ev);
            let _ = windows::Win32::Foundation::CloseHandle(ev);
        }
    }
}

/// Zero-CPU kernel wait thread that wakes & re-centers MS Island whenever a second instance is launched.
pub fn spawn_wake_event_listener<F>(on_wake: F)
where
    F: Fn() + Send + 'static,
{
    std::thread::spawn(move || {
        let name = HSTRING::from(WAKE_EVENT_NAME);
        unsafe {
            if let Ok(ev) = CreateEventW(None, false, false, PCWSTR(name.as_ptr())) {
                loop {
                    let wait = WaitForSingleObject(ev, INFINITE);
                    if wait.0 == 0 {
                        on_wake();
                    } else {
                        std::thread::sleep(std::time::Duration::from_millis(500));
                    }
                }
            }
        }
    });
}

pub fn is_autostart_enabled() -> bool {
    let subkey = HSTRING::from(RUN_SUBKEY);
    let value_name = HSTRING::from(APP_REG_NAME);
    let mut hkey = HKEY::default();

    unsafe {
        if RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey.as_ptr()),
            0,
            KEY_READ,
            &mut hkey,
        )
        .is_err()
        {
            return false;
        }

        let mut data_len: u32 = 0;
        let exists = RegQueryValueExW(
            hkey,
            PCWSTR(value_name.as_ptr()),
            None,
            None,
            None,
            Some(&mut data_len),
        )
        .is_ok();

        let _ = RegCloseKey(hkey);
        exists && data_len > 0
    }
}

fn get_startup_lnk_path() -> Option<std::path::PathBuf> {
    std::env::var("APPDATA").ok().map(|appdata| {
        std::path::PathBuf::from(appdata)
            .join("Microsoft")
            .join("Windows")
            .join("Start Menu")
            .join("Programs")
            .join("Startup")
            .join("MSIsland.lnk")
    })
}

fn create_startup_lnk(exe_path: &std::path::Path) {
    if let Some(lnk_path) = get_startup_lnk_path() {
        let exe_escaped = exe_path.to_string_lossy().replace('\'', "''");
        let lnk_escaped = lnk_path.to_string_lossy().replace('\'', "''");
        let work_dir = exe_path
            .parent()
            .map(|p| p.to_string_lossy().replace('\'', "''"))
            .unwrap_or_default();

        let ps_cmd = format!(
            "$ws=New-Object -ComObject WScript.Shell;$s=$ws.CreateShortcut('{}');$s.TargetPath='{}';$s.WorkingDirectory='{}';$s.Save()",
            lnk_escaped, exe_escaped, work_dir
        );

        let _ = std::process::Command::new("powershell")
            .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &ps_cmd])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
}

fn remove_startup_lnk() {
    if let Some(lnk_path) = get_startup_lnk_path() {
        let _ = std::fs::remove_file(lnk_path);
    }
}

/// Registers both HKCU\...\Run AND a user Startup Folder shortcut (`MSIsland.lnk`)
/// so MS Island launches reliably on Windows logon with standard user privileges.
pub fn set_autostart_enabled(enabled: bool) -> Result<bool, String> {
    let subkey = HSTRING::from(RUN_SUBKEY);
    let value_name = HSTRING::from(APP_REG_NAME);
    let mut hkey = HKEY::default();

    unsafe {
        if RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey.as_ptr()),
            0,
            KEY_WRITE,
            &mut hkey,
        )
        .is_err()
        {
            return Err("Failed to open Windows Startup registry key".to_string());
        }

        let result = if enabled {
            let exe_path = std::env::current_exe()
                .map_err(|e| format!("Failed to locate executable: {}", e))?;
            let quoted_path = format!("\"{}\"", exe_path.to_string_lossy());
            let mut wide: Vec<u16> = quoted_path.encode_utf16().collect();
            wide.push(0);

            let byte_slice = std::slice::from_raw_parts(
                wide.as_ptr() as *const u8,
                wide.len() * std::mem::size_of::<u16>(),
            );

            let reg_res = RegSetValueExW(
                hkey,
                PCWSTR(value_name.as_ptr()),
                0,
                REG_SZ,
                Some(byte_slice),
            )
            .ok()
            .map(|_| true)
            .map_err(|e| format!("Failed to write startup entry: {}", e));

            // Create/refresh Startup Folder shortcut (.lnk) — works cleanly without admin rights
            create_startup_lnk(&exe_path);

            reg_res
        } else {
            let _ = RegDeleteValueW(hkey, PCWSTR(value_name.as_ptr()));
            remove_startup_lnk();
            let _ = std::process::Command::new("schtasks")
                .args(["/Delete", "/TN", STARTUP_TASK_NAME, "/F"])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            Ok(false)
        };

        let _ = RegCloseKey(hkey);
        result
    }
}

/// Ensures existing auto-start entries always point to the current running executable path
pub fn sync_autostart_path_if_enabled() {
    if is_autostart_enabled() {
        let _ = set_autostart_enabled(true);
    }
}

#[link(name = "user32")]
extern "system" {
    fn BeginDeferWindowPos(num_windows: i32) -> isize;
    fn DeferWindowPos(
        hdwp: isize,
        hwnd: isize,
        hwnd_insert_after: isize,
        x: i32,
        y: i32,
        cx: i32,
        cy: i32,
        flags: u32,
    ) -> isize;
    fn EndDeferWindowPos(hdwp: isize) -> i32;
}

/// Moves multiple Win32 windows atomically in a single DWM compositor frame without activating/stealing focus.
pub fn move_windows_atomic(moves: &[(isize, i32, i32)]) {
    if moves.is_empty() {
        return;
    }
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const FLAGS: u32 = SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE;

    unsafe {
        let mut hdwp = BeginDeferWindowPos(moves.len() as i32);
        if hdwp == 0 {
            return;
        }
        for &(hwnd, x, y) in moves {
            if hwnd == 0 {
                continue;
            }
            let next = DeferWindowPos(hdwp, hwnd, 0, x, y, 0, 0, FLAGS);
            if next == 0 {
                return;
            }
            hdwp = next;
        }
        let _ = EndDeferWindowPos(hdwp);
    }
}

/// Reads current physical top-left origin of a Win32 window.
pub fn get_window_origin(hwnd_raw: isize) -> Option<(i32, i32)> {
    if hwnd_raw == 0 {
        return None;
    }
    unsafe {
        let mut rect = RECT::default();
        if GetWindowRect(HWND(hwnd_raw as *mut _), &mut rect).is_ok() {
            Some((rect.left, rect.top))
        } else {
            None
        }
    }
}
