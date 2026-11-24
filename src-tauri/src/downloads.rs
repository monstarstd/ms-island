use crate::system_tools::{build_shelf_file_info, ShelfFileInfo};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActiveDownloadInfo {
    pub name: String,
    pub path: String,
    #[serde(rename = "bytesDownloaded")]
    pub bytes_downloaded: u64,
    #[serde(rename = "speedBytesPerSec")]
    pub speed_bytes_per_sec: u64,
}

#[derive(Debug, Clone, Serialize)]
struct DownloadToast {
    kind: String,
    message: String,
}

struct TrackedPartial {
    display_name: String,
    final_path: PathBuf,
    last_bytes: u64,
    last_check: Instant,
    smoothed_speed: f64,
}

fn get_downloads_dir() -> Option<PathBuf> {
    if let Ok(profile) = std::env::var("USERPROFILE") {
        let p = PathBuf::from(profile).join("Downloads");
        if p.is_dir() {
            return Some(p);
        }
    }
    None
}

fn parse_partial_file(path: &Path) -> Option<(String, PathBuf)> {
    let fname = path.file_name()?.to_string_lossy().to_string();
    let lower = fname.to_lowercase();

    for suffix in &[".crdownload", ".part", ".opdownload"] {
        if lower.ends_with(suffix) {
            let trimmed = fname[..fname.len() - suffix.len()].to_string();
            let final_path = path.with_file_name(&trimmed);
            let display = if trimmed.to_lowercase().starts_with("unconfirmed ") {
                "Browser Download".to_string()
            } else {
                trimmed
            };
            return Some((display, final_path));
        }
    }
    None
}

fn is_temp_or_hidden(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".crdownload")
        || lower.ends_with(".part")
        || lower.ends_with(".opdownload")
        || lower.ends_with(".tmp")
        || lower.starts_with('.')
        || lower == "desktop.ini"
}

/// Spawns a lightweight background watcher on `%USERPROFILE%\Downloads`.
/// - Emits `"downloads-updated"` (`Option<ActiveDownloadInfo>`) while Chromium/Firefox downloads run
/// - Emits `"download-completed"` (`ShelfFileInfo`) + `"island-toast"` when a download finishes so it auto-lands on Shelf!
pub fn spawn_downloads_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let downloads_dir = match get_downloads_dir() {
            Some(d) => d,
            None => return,
        };

        // Snapshot existing files on startup so old downloads don't trigger notifications
        let mut known_files: HashSet<PathBuf> = HashSet::new();
        if let Ok(entries) = std::fs::read_dir(&downloads_dir) {
            for entry in entries.flatten() {
                known_files.insert(entry.path());
            }
        }

        let mut active_partials: HashMap<PathBuf, TrackedPartial> = HashMap::new();
        let mut last_emitted_active: Option<ActiveDownloadInfo> = None;

        loop {
            std::thread::sleep(Duration::from_millis(650));

            let entries = match std::fs::read_dir(&downloads_dir) {
                Ok(rd) => rd,
                Err(_) => continue,
            };

            let now = Instant::now();
            let mut seen_partials: HashSet<PathBuf> = HashSet::new();
            let mut current_files: HashSet<PathBuf> = HashSet::new();
            let mut best_active: Option<ActiveDownloadInfo> = None;

            for entry in entries.flatten() {
                let path = entry.path();
                let meta = match entry.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                if meta.is_dir() {
                    continue;
                }

                if let Some((display_name, final_path)) = parse_partial_file(&path) {
                    seen_partials.insert(path.clone());
                    let bytes = meta.len();

                    let entry_state = active_partials
                        .entry(path.clone())
                        .or_insert_with(|| TrackedPartial {
                            display_name: display_name.clone(),
                            final_path: final_path.clone(),
                            last_bytes: bytes,
                            last_check: now,
                            smoothed_speed: 0.0,
                        });

                    let dt = now.duration_since(entry_state.last_check).as_secs_f64();
                    if dt >= 0.25 {
                        let delta = bytes.saturating_sub(entry_state.last_bytes) as f64;
                        let inst_speed = delta / dt;
                        entry_state.smoothed_speed = if entry_state.smoothed_speed <= 1.0 {
                            inst_speed
                        } else {
                            entry_state.smoothed_speed * 0.45 + inst_speed * 0.55
                        };
                        entry_state.last_bytes = bytes;
                        entry_state.last_check = now;
                    }

                    let info = ActiveDownloadInfo {
                        name: entry_state.display_name.clone(),
                        path: path.to_string_lossy().to_string(),
                        bytes_downloaded: bytes,
                        speed_bytes_per_sec: entry_state.smoothed_speed.round() as u64,
                    };

                    // Pick the most active (highest speed or largest) download to display
                    match &best_active {
                        Some(existing)
                            if existing.speed_bytes_per_sec > info.speed_bytes_per_sec => {}
                        _ => best_active = Some(info),
                    }
                } else {
                    current_files.insert(path.clone());
                }
            }

            // Detect completed downloads:
            // 1) Partial file disappeared AND its final file now exists
            // 2) OR a brand-new completed non-temp file appeared (fast small downloads < 650ms!)
            let mut completed_paths: Vec<PathBuf> = Vec::new();
            let finished_partials: Vec<PathBuf> = active_partials
                .keys()
                .filter(|p| !seen_partials.contains(*p))
                .cloned()
                .collect();

            for partial_path in finished_partials {
                if let Some(tracked) = active_partials.remove(&partial_path) {
                    if tracked.final_path.is_file() && !known_files.contains(&tracked.final_path) {
                        completed_paths.push(tracked.final_path);
                    }
                }
            }

            // Also catch fast small downloads that completed between ticks
            let sys_now = SystemTime::now();
            for path in &current_files {
                if known_files.contains(path) || completed_paths.contains(path) {
                    continue;
                }
                let fname = path
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                if is_temp_or_hidden(&fname) {
                    continue;
                }
                if let Ok(meta) = std::fs::metadata(path) {
                    if meta.len() > 0 {
                        let recently_modified = meta
                            .modified()
                            .ok()
                            .and_then(|m| sys_now.duration_since(m).ok())
                            .map(|age| age.as_secs() <= 10)
                            .unwrap_or(false);
                        if recently_modified {
                            completed_paths.push(path.clone());
                        }
                    }
                }
            }

            // Update known files set
            known_files = current_files;

            // Emit completed downloads -> auto-add to Shelf + brief toast
            for done_path in completed_paths {
                let info: ShelfFileInfo = build_shelf_file_info(&done_path);
                let _ = app.emit("download-completed", &info);
                let _ = app.emit(
                    "island-toast",
                    DownloadToast {
                        kind: "download".to_string(),
                        message: format!("Downloaded · {}", info.name),
                    },
                );
            }

            // Emit active download progress only when changed
            if best_active != last_emitted_active {
                last_emitted_active = best_active.clone();
                let _ = app.emit("downloads-updated", &best_active);
            }
        }
    });
}
