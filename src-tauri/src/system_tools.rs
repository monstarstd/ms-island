use serde::{Deserialize, Serialize};
use windows::core::{PCWSTR, HSTRING};
use windows::Win32::Foundation::FILETIME;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
use windows::Win32::System::Registry::{
    RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW, HKEY,
    HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_SZ,
};
use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows::Win32::System::Threading::GetSystemTimes;

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
// 2. Native Windows CPU & RAM Hardware Monitor
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
// 3. Auto-Start on Windows Boot (HKCU\Software\Microsoft\Windows\CurrentVersion\Run)
// -----------------------------------------------------------------------------

const RUN_SUBKEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const APP_REG_NAME: &str = "MSIsland";

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
            wide.push(0); // null terminator

            let byte_slice = std::slice::from_raw_parts(
                wide.as_ptr() as *const u8,
                wide.len() * std::mem::size_of::<u16>(),
            );

            RegSetValueExW(
                hkey,
                PCWSTR(value_name.as_ptr()),
                0,
                REG_SZ,
                Some(byte_slice),
            )
            .ok()
            .map(|_| true)
            .map_err(|e| format!("Failed to write startup entry: {}", e))
        } else {
            let _ = RegDeleteValueW(hkey, PCWSTR(value_name.as_ptr()));
            Ok(false)
        };

        let _ = RegCloseKey(hkey);
        result
    }
}
