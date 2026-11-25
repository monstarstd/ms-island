use crate::system_tools::{self, ShelfFileInfo};
use qrcode::QrCode;
use serde::Serialize;
use std::collections::HashMap;
use std::net::{IpAddr, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;

const MAX_HEADER_BYTES: usize = 16 * 1024;
const MAX_UPLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024; // 2 GB cap
const MAX_CLIPBOARD_BYTES: usize = 64 * 1024;
const STREAM_BUF_SIZE: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct WifiShareStatus {
    pub running: bool,
    pub url: String,
    #[serde(rename = "displayUrl")]
    pub display_url: String,
    #[serde(rename = "qrSvg")]
    pub qr_svg: String,
    #[serde(rename = "saveDir")]
    pub save_dir: String,
    #[serde(rename = "receivedCount")]
    pub received_count: u64,
}

impl Default for WifiShareStatus {
    fn default() -> Self {
        Self {
            running: false,
            url: String::new(),
            display_url: String::new(),
            qr_svg: String::new(),
            save_dir: wifi_save_dir().to_string_lossy().to_string(),
            received_count: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
struct WifiToastEvent {
    kind: String,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
struct ApiShelfFile {
    idx: usize,
    name: String,
    #[serde(rename = "sizeBytes")]
    size_bytes: u64,
    ext: String,
}

struct RunningSession {
    shutdown_tx: watch::Sender<bool>,
    url: String,
    display_url: String,
    qr_svg: String,
}

pub struct WifiShareManager {
    session: Mutex<Option<RunningSession>>,
    shelf_files: Arc<Mutex<Vec<ShelfFileInfo>>>,
    received_count: Arc<AtomicU64>,
}

impl WifiShareManager {
    pub fn new() -> Self {
        Self {
            session: Mutex::new(None),
            shelf_files: Arc::new(Mutex::new(Vec::new())),
            received_count: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn sync_files(&self, files: Vec<ShelfFileInfo>) {
        if let Ok(mut guard) = self.shelf_files.lock() {
            *guard = files;
        }
    }

    pub fn status(&self) -> WifiShareStatus {
        let count = self.received_count.load(Ordering::Relaxed);
        let save_dir = wifi_save_dir().to_string_lossy().to_string();
        if let Ok(guard) = self.session.lock() {
            if let Some(ref s) = *guard {
                return WifiShareStatus {
                    running: true,
                    url: s.url.clone(),
                    display_url: s.display_url.clone(),
                    qr_svg: s.qr_svg.clone(),
                    save_dir,
                    received_count: count,
                };
            }
        }
        WifiShareStatus {
            running: false,
            url: String::new(),
            display_url: String::new(),
            qr_svg: String::new(),
            save_dir,
            received_count: count,
        }
    }

    pub fn stop(&self) -> WifiShareStatus {
        if let Ok(mut guard) = self.session.lock() {
            if let Some(prev) = guard.take() {
                let _ = prev.shutdown_tx.send(true);
            }
        }
        self.status()
    }

    pub async fn start(&self, app: AppHandle) -> Result<WifiShareStatus, String> {
        // If already running, return current status without rebinding
        {
            if let Ok(guard) = self.session.lock() {
                if guard.is_some() {
                    drop(guard);
                    return Ok(self.status());
                }
            }
        }

        let listener = match TcpListener::bind("0.0.0.0:8765").await {
            Ok(l) => l,
            Err(_) => TcpListener::bind("0.0.0.0:0")
                .await
                .map_err(|e| format!("Could not start Wi-Fi server: {}", e))?,
        };

        let port = listener
            .local_addr()
            .map(|a| a.port())
            .map_err(|e| format!("Failed to read bound port: {}", e))?;

        let ip = detect_lan_ipv4();
        let token = generate_session_token();
        let display_url = format!("http://{}:{}", ip, port);
        let full_url = format!("{}/?t={}", display_url, token);
        let qr_svg = render_qr_svg(&full_url)
            .ok_or_else(|| "Failed to generate QR code".to_string())?;

        let (shutdown_tx, mut shutdown_rx) = watch::channel(false);
        let shelf_files = self.shelf_files.clone();
        let received_count = self.received_count.clone();
        let token_arc = Arc::new(token);

        {
            let mut guard = self
                .session
                .lock()
                .map_err(|_| "Internal Wi-Fi state lock error".to_string())?;
            *guard = Some(RunningSession {
                shutdown_tx,
                url: full_url,
                display_url,
                qr_svg,
            });
        }

        tauri::async_runtime::spawn(async move {
            loop {
                tokio::select! {
                    changed = shutdown_rx.changed() => {
                        if changed.is_err() || *shutdown_rx.borrow() {
                            break;
                        }
                    }
                    accept_res = listener.accept() => {
                        match accept_res {
                            Ok((stream, _addr)) => {
                                let app_c = app.clone();
                                let files_c = shelf_files.clone();
                                let count_c = received_count.clone();
                                let tok_c = token_arc.clone();
                                tauri::async_runtime::spawn(async move {
                                    let _ = handle_connection(stream, app_c, files_c, count_c, tok_c).await;
                                });
                            }
                            Err(_) => {
                                tokio::time::sleep(Duration::from_millis(25)).await;
                            }
                        }
                    }
                }
            }
        });

        Ok(self.status())
    }
}

pub fn wifi_save_dir() -> PathBuf {
    let base = std::env::var("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    base.join("Downloads").join("MS Island")
}

fn detect_lan_ipv4() -> String {
    for target in ["192.0.2.1:80", "8.8.8.8:80", "10.255.255.255:1", "192.168.1.1:80"] {
        if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
            if sock.connect(target).is_ok() {
                if let Ok(local) = sock.local_addr() {
                    if let IpAddr::V4(v4) = local.ip() {
                        if !v4.is_loopback() && !v4.is_unspecified() {
                            return v4.to_string();
                        }
                    }
                }
            }
        }
    }
    "127.0.0.1".to_string()
}

fn generate_session_token() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9e37_79b9_7f4a_7c15);
    let pid = std::process::id() as u64;
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);

    // SplitMix64 mixing for clean unpredictable 64-bit hex token
    let mut z = nanos ^ (pid.rotate_left(21)) ^ (seq.wrapping_mul(0x9e37_79b9_7f4a_7c15));
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^= z >> 31;
    format!("{:016x}", z)
}

fn render_qr_svg(content: &str) -> Option<String> {
    let code = QrCode::new(content.as_bytes()).ok()?;
    let width = code.width();
    let quiet = 2usize;
    let total = width + quiet * 2;
    let colors = code.to_colors();

    let mut path_data = String::with_capacity(width * width * 6);
    for y in 0..width {
        for x in 0..width {
            if matches!(colors[y * width + x], qrcode::Color::Dark) {
                let gx = x + quiet;
                let gy = y + quiet;
                path_data.push_str(&format!("M{} {}h1v1h-1z", gx, gy));
            }
        }
    }

    Some(format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {t} {t}" shape-rendering="crispEdges"><rect width="{t}" height="{t}" fill="#ffffff"/><path fill="#09090b" d="{d}"/></svg>"##,
        t = total,
        d = path_data
    ))
}

fn sanitize_filename(raw: &str) -> String {
    let base = raw
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .trim();

    let mut clean: String = base
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'))
        .collect();

    clean = clean.trim_matches([' ', '.']).to_string();
    if clean.is_empty() {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        return format!("wifi_upload_{}.bin", ts);
    }

    // Cap overly long names while keeping extension intact
    if clean.chars().count() > 140 {
        let p = Path::new(&clean);
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        let stem: String = p
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("file")
            .chars()
            .take(120)
            .collect();
        if ext.is_empty() {
            return stem;
        }
        return format!("{}.{}", stem, ext);
    }

    clean
}

fn unique_dest_path(dir: &Path, filename: &str) -> PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }

    let p = Path::new(filename);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");

    for i in 1..1000u32 {
        let alt_name = if ext.is_empty() {
            format!("{} ({})", stem, i)
        } else {
            format!("{} ({}).{}", stem, i, ext)
        };
        let alt_path = dir.join(alt_name);
        if !alt_path.exists() {
            return alt_path;
        }
    }

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    dir.join(format!("{}_{}", ts, filename))
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n").map(|p| p + 4)
}

fn parse_query_params(raw_target: &str) -> (String, HashMap<String, String>) {
    if let Some((path, qs)) = raw_target.split_once('?') {
        let map = url::form_urlencoded::parse(qs.as_bytes())
            .into_owned()
            .collect();
        (path.to_string(), map)
    } else {
        (raw_target.to_string(), HashMap::new())
    }
}

async fn send_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
) -> std::io::Result<()> {
    let header = format!(
        "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        status,
        content_type,
        body.len()
    );
    stream.write_all(header.as_bytes()).await?;
    stream.write_all(body).await?;
    stream.flush().await
}

async fn handle_connection(
    mut stream: TcpStream,
    app: AppHandle,
    shelf_files: Arc<Mutex<Vec<ShelfFileInfo>>>,
    received_count: Arc<AtomicU64>,
    session_token: Arc<String>,
) -> std::io::Result<()> {
    let mut buf = Vec::with_capacity(4096);
    let mut temp = [0u8; 4096];

    let header_end = loop {
        if let Some(pos) = find_header_end(&buf) {
            break pos;
        }
        if buf.len() >= MAX_HEADER_BYTES {
            return send_response(
                &mut stream,
                "431 Request Header Fields Too Large",
                "text/plain; charset=utf-8",
                b"Headers too large",
            )
            .await;
        }
        let n = match tokio::time::timeout(Duration::from_secs(10), stream.read(&mut temp)).await {
            Ok(Ok(n)) if n > 0 => n,
            _ => return Ok(()),
        };
        buf.extend_from_slice(&temp[..n]);
    };

    let header_str = String::from_utf8_lossy(&buf[..header_end]);
    let mut lines = header_str.lines();
    let Some(req_line) = lines.next() else {
        return Ok(());
    };
    let parts: Vec<&str> = req_line.split_whitespace().collect();
    if parts.len() < 2 {
        return send_response(&mut stream, "400 Bad Request", "text/plain", b"Bad Request").await;
    }

    let method = parts[0];
    let (path, query) = parse_query_params(parts[1]);

    let mut content_length: u64 = 0;
    let mut expect_continue = false;
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            let kl = k.trim().to_ascii_lowercase();
            let vl = v.trim();
            if kl == "content-length" {
                content_length = vl.parse::<u64>().unwrap_or(0);
            } else if kl == "expect" && vl.eq_ignore_ascii_case("100-continue") {
                expect_continue = true;
            }
        }
    }

    // Strict per-session token verification
    let supplied_token = query.get("t").map(String::as_str).unwrap_or("");
    if supplied_token != session_token.as_str() {
        return send_response(
            &mut stream,
            "401 Unauthorized",
            "text/html; charset=utf-8",
            b"<!doctype html><html><body style=\"background:#0c0c0e;color:#e4e4e7;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0\"><div style=\"text-align:center;padding:24px\"><h3>Session Expired or Unauthorized</h3><p style=\"color:#a1a1aa;font-size:14px\">Scan the active QR code in MS Island Shelf to connect.</p></div></body></html>",
        )
        .await;
    }

    let leftover = &buf[header_end..];

    // 1. Mobile Web UI
    if method == "GET" && (path == "/" || path == "/index.html") {
        let html = MOBILE_UI_TEMPLATE.replace("__TOKEN__", session_token.as_str());
        return send_response(&mut stream, "200 OK", "text/html; charset=utf-8", html.as_bytes())
            .await;
    }

    // 2. List live Shelf files (only existing non-dir files)
    if method == "GET" && path == "/api/files" {
        let list: Vec<ApiShelfFile> = shelf_files
            .lock()
            .map(|guard| {
                guard
                    .iter()
                    .enumerate()
                    .filter(|(_, f)| !f.is_dir && Path::new(&f.path).is_file())
                    .map(|(idx, f)| ApiShelfFile {
                        idx,
                        name: f.name.clone(),
                        size_bytes: f.size_bytes,
                        ext: f.ext.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default();

        let json = serde_json::to_vec(&list).unwrap_or_else(|_| b"[]".to_vec());
        return send_response(&mut stream, "200 OK", "application/json", &json).await;
    }

    // 3. Stream download from PC Shelf to phone
    if method == "GET" && path.starts_with("/api/download/") {
        let idx_str = &path["/api/download/".len()..];
        let Ok(idx) = idx_str.parse::<usize>() else {
            return send_response(&mut stream, "400 Bad Request", "text/plain", b"Invalid index")
                .await;
        };

        let file_opt = shelf_files
            .lock()
            .ok()
            .and_then(|g| g.get(idx).cloned())
            .filter(|f| !f.is_dir && Path::new(&f.path).is_file());

        let Some(info) = file_opt else {
            return send_response(&mut stream, "404 Not Found", "text/plain", b"File not found")
                .await;
        };

        let Ok(mut file) = File::open(&info.path).await else {
            return send_response(&mut stream, "404 Not Found", "text/plain", b"Cannot open file")
                .await;
        };
        let file_len = file.metadata().await.map(|m| m.len()).unwrap_or(0);
        let safe_ascii = info.name.replace(['"', '\r', '\n'], "_");
        let encoded_utf8: String =
            url::form_urlencoded::byte_serialize(info.name.as_bytes()).collect();

        let header = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nContent-Disposition: attachment; filename=\"{}\"; filename*=UTF-8''{}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
            file_len, safe_ascii, encoded_utf8
        );
        stream.write_all(header.as_bytes()).await?;

        let mut chunk = vec![0u8; STREAM_BUF_SIZE];
        loop {
            let n = file.read(&mut chunk).await?;
            if n == 0 {
                break;
            }
            stream.write_all(&chunk[..n]).await?;
        }
        return stream.flush().await;
    }

    // 4. Stream upload from phone directly to Downloads\MS Island + push to Shelf
    if method == "POST" && path == "/api/upload" {
        if content_length == 0 {
            return send_response(&mut stream, "400 Bad Request", "application/json", b"{\"ok\":false,\"error\":\"Empty file\"}")
                .await;
        }
        if content_length > MAX_UPLOAD_BYTES {
            return send_response(&mut stream, "413 Payload Too Large", "application/json", b"{\"ok\":false,\"error\":\"File exceeds 2 GB limit\"}")
                .await;
        }

        if expect_continue {
            stream.write_all(b"HTTP/1.1 100 Continue\r\n\r\n").await?;
            stream.flush().await?;
        }

        let raw_name = query.get("name").map(String::as_str).unwrap_or("upload.bin");
        let safe_name = sanitize_filename(raw_name);
        let save_dir = wifi_save_dir();
        if let Err(e) = tokio::fs::create_dir_all(&save_dir).await {
            let msg = format!("{{\"ok\":false,\"error\":\"{}\"}}", e);
            return send_response(&mut stream, "500 Internal Server Error", "application/json", msg.as_bytes()).await;
        }

        let dest_path = unique_dest_path(&save_dir, &safe_name);
        let mut out_file = match File::create(&dest_path).await {
            Ok(f) => f,
            Err(e) => {
                let msg = format!("{{\"ok\":false,\"error\":\"{}\"}}", e);
                return send_response(&mut stream, "500 Internal Server Error", "application/json", msg.as_bytes()).await;
            }
        };

        let mut remaining = content_length;
        if !leftover.is_empty() {
            let take = (leftover.len() as u64).min(remaining) as usize;
            if out_file.write_all(&leftover[..take]).await.is_err() {
                let _ = tokio::fs::remove_file(&dest_path).await;
                return Ok(());
            }
            remaining -= take as u64;
        }

        let mut chunk = vec![0u8; STREAM_BUF_SIZE];
        while remaining > 0 {
            let to_read = (chunk.len() as u64).min(remaining) as usize;
            match stream.read(&mut chunk[..to_read]).await {
                Ok(0) => {
                    // Client disconnected mid-upload — remove partial file cleanly
                    drop(out_file);
                    let _ = tokio::fs::remove_file(&dest_path).await;
                    return Ok(());
                }
                Ok(n) => {
                    if out_file.write_all(&chunk[..n]).await.is_err() {
                        drop(out_file);
                        let _ = tokio::fs::remove_file(&dest_path).await;
                        return Ok(());
                    }
                    remaining -= n as u64;
                }
                Err(_) => {
                    drop(out_file);
                    let _ = tokio::fs::remove_file(&dest_path).await;
                    return Ok(());
                }
            }
        }
        out_file.flush().await?;
        drop(out_file);

        let info = system_tools::build_shelf_file_info(&dest_path);
        if let Ok(mut guard) = shelf_files.lock() {
            guard.retain(|f| f.path != info.path);
            guard.insert(0, info.clone());
            if guard.len() > 12 {
                guard.truncate(12);
            }
        }
        received_count.fetch_add(1, Ordering::Relaxed);

        let _ = app.emit("wifi-file-received", &info);
        let _ = app.emit(
            "island-toast",
            WifiToastEvent {
                kind: "shelf".to_string(),
                message: format!("Wi-Fi: {}", info.name),
            },
        );

        let resp_json = serde_json::json!({
            "ok": true,
            "name": info.name,
            "sizeBytes": info.size_bytes
        })
        .to_string();
        return send_response(&mut stream, "200 OK", "application/json", resp_json.as_bytes())
            .await;
    }

    // 5. Quick Text from phone -> Windows Clipboard
    if method == "POST" && path == "/api/clipboard" {
        if content_length == 0 || content_length > MAX_CLIPBOARD_BYTES as u64 {
            return send_response(
                &mut stream,
                "400 Bad Request",
                "application/json",
                b"{\"ok\":false,\"error\":\"Invalid text size\"}",
            )
            .await;
        }

        if expect_continue {
            stream.write_all(b"HTTP/1.1 100 Continue\r\n\r\n").await?;
            stream.flush().await?;
        }

        let target_len = content_length as usize;
        let mut body = Vec::with_capacity(target_len);
        let take = leftover.len().min(target_len);
        body.extend_from_slice(&leftover[..take]);

        while body.len() < target_len {
            let mut tmp = [0u8; 4096];
            let need = (target_len - body.len()).min(tmp.len());
            let n = stream.read(&mut tmp[..need]).await?;
            if n == 0 {
                break;
            }
            body.extend_from_slice(&tmp[..n]);
        }

        let text = String::from_utf8_lossy(&body).trim().to_string();
        if text.is_empty() {
            return send_response(
                &mut stream,
                "400 Bad Request",
                "application/json",
                b"{\"ok\":false,\"error\":\"Empty text\"}",
            )
            .await;
        }

        let text_for_clip = text.clone();
        let ok = tokio::task::spawn_blocking(move || {
            system_tools::activate_windows_clipboard_item("wifi", &text_for_clip)
        })
        .await
        .unwrap_or(false);

        if ok {
            let _ = app.emit(
                "island-toast",
                WifiToastEvent {
                    kind: "clipboard".to_string(),
                    message: "Clipboard updated from phone".to_string(),
                },
            );
            return send_response(&mut stream, "200 OK", "application/json", b"{\"ok\":true}")
                .await;
        }

        return send_response(
            &mut stream,
            "500 Internal Server Error",
            "application/json",
            b"{\"ok\":false}",
        )
        .await;
    }

    send_response(&mut stream, "404 Not Found", "text/plain", b"Not Found").await
}

const MOBILE_UI_TEMPLATE: &str = r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>MS Island · Wi-Fi Shelf</title>
<style>
:root{--bg:#0c0c0e;--card:#141418;--card2:#1b1b21;--border:#27272a;--text:#f4f4f5;--muted:#a1a1aa;--accent:#f97316;--ok:#10b981}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px 16px calc(24px + env(safe-area-inset-bottom))}
.wrap{max-width:480px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.hdr{display:flex;align-items:center;justify-content:space-between;padding:4px 2px}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:16px;letter-spacing:-.01em}
.dot{width:8px;height:8px;border-radius:99px;background:var(--ok)}
.badge{font-size:11px;color:var(--muted);background:var(--card);border:1px solid var(--border);padding:4px 9px;border-radius:99px}
.card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:10px}
.title{font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;display:flex;align-items:center;justify-content:space-between}
.btn{appearance:none;border:0;border-radius:12px;padding:13px 16px;font-size:14px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;width:100%;transition:transform .1s,opacity .15s}
.btn:active{transform:scale(.98)}
.btn-primary{background:var(--accent);color:#fff}
.btn-secondary{background:var(--card2);color:var(--text);border:1px solid var(--border);padding:10px 14px;font-size:13px}
.btn:disabled{opacity:.5;cursor:not-allowed}
input[type=file]{display:none}
textarea{width:100%;min-height:64px;resize:vertical;background:#0c0c0e;border:1px solid var(--border);border-radius:10px;padding:10px 12px;color:var(--text);font:inherit;font-size:14px;outline:none}
textarea:focus{border-color:var(--accent)}
.status{font-size:12px;color:var(--muted);min-height:16px}
.status.ok{color:var(--ok)}
.bar-wrap{height:6px;background:#27272a;border-radius:99px;overflow:hidden;display:none}
.bar{height:100%;width:0%;background:var(--accent);transition:width .12s linear}
.list{display:flex;flex-direction:column;gap:8px}
.item{background:#0c0c0e;border:1px solid var(--border);border-radius:12px;padding:10px 12px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px}
.ext{width:34px;height:34px;border-radius:8px;background:var(--card2);color:var(--accent);font:700 10px ui-monospace,monospace;display:grid;place-items:center;text-transform:uppercase}
.meta{min-width:0}
.fname{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fsize{font-size:11px;color:var(--muted);margin-top:2px;font-family:ui-monospace,monospace}
.dl{text-decoration:none;background:var(--card2);border:1px solid var(--border);color:var(--text);padding:7px 12px;border-radius:9px;font-size:12px;font-weight:600}
.empty{text-align:center;color:var(--muted);font-size:12px;padding:16px 8px}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <div class="brand"><span class="dot"></span><span>MS Island</span></div>
    <span class="badge">Local Wi-Fi Shelf</span>
  </div>

  <div class="card">
    <div class="title"><span>Send to PC Shelf</span></div>
    <label class="btn btn-primary" for="picker">Select Photos or Files</label>
    <input id="picker" type="file" multiple>
    <div id="barWrap" class="bar-wrap"><div id="bar" class="bar"></div></div>
    <div id="upStatus" class="status">Files appear immediately inside MS Island Shelf.</div>
  </div>

  <div class="card">
    <div class="title"><span>Send Text to PC Clipboard</span></div>
    <textarea id="clipText" placeholder="Paste a link, note, or OTP..."></textarea>
    <button id="clipBtn" class="btn btn-secondary" type="button">Copy to PC Clipboard</button>
    <div id="clipStatus" class="status"></div>
  </div>

  <div class="card">
    <div class="title">
      <span>From PC Shelf</span>
      <button id="refreshBtn" type="button" style="background:none;border:0;color:var(--accent);font-size:11px;font-weight:600;cursor:pointer;padding:2px 4px">Refresh</button>
    </div>
    <div id="fileList" class="list"><div class="empty">Loading Shelf files...</div></div>
  </div>
</div>

<script>
const TOKEN = "__TOKEN__";
const picker = document.getElementById("picker");
const upStatus = document.getElementById("upStatus");
const barWrap = document.getElementById("barWrap");
const bar = document.getElementById("bar");
const clipText = document.getElementById("clipText");
const clipBtn = document.getElementById("clipBtn");
const clipStatus = document.getElementById("clipStatus");
const fileList = document.getElementById("fileList");
const refreshBtn = document.getElementById("refreshBtn");

function fmtBytes(b){
  if(!b)return "0 B";
  const u=["B","KB","MB","GB"];let i=0;let v=b;
  while(v>=1024&&i<u.length-1){v/=1024;i++}
  return (v>=10||i===0?v.toFixed(0):v.toFixed(1))+" "+u[i];
}

function uploadOne(file, idx, total){
  return new Promise((resolve, reject)=>{
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload?t="+encodeURIComponent(TOKEN)+"&name="+encodeURIComponent(file.name));
    xhr.upload.onprogress = (e)=>{
      if(e.lengthComputable){
        const pct = Math.round((e.loaded / e.total) * 100);
        bar.style.width = pct + "%";
        upStatus.className = "status";
        upStatus.textContent = `Uploading (${idx+1}/${total}): ${file.name} · ${pct}%`;
      }
    };
    xhr.onload = ()=>{
      if(xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error("Upload failed ("+xhr.status+")"));
    };
    xhr.onerror = ()=>reject(new Error("Network error"));
    xhr.send(file);
  });
}

picker.addEventListener("change", async ()=>{
  const files = Array.from(picker.files || []);
  if(!files.length) return;
  barWrap.style.display = "block";
  bar.style.width = "0%";
  let sent = 0;
  try{
    for(let i=0;i<files.length;i++){
      await uploadOne(files[i], i, files.length);
      sent++;
    }
    bar.style.width = "100%";
    upStatus.className = "status ok";
    upStatus.textContent = `Sent ${sent} ${sent===1?"file":"files"} to MS Island Shelf!`;
    loadFiles();
  }catch(err){
    upStatus.className = "status";
    upStatus.textContent = err.message || "Upload interrupted";
  }finally{
    picker.value = "";
    setTimeout(()=>{ barWrap.style.display = "none"; }, 1800);
  }
});

clipBtn.addEventListener("click", async ()=>{
  const text = clipText.value.trim();
  if(!text) return;
  clipBtn.disabled = true;
  clipStatus.className = "status";
  clipStatus.textContent = "Sending...";
  try{
    const res = await fetch("/api/clipboard?t="+encodeURIComponent(TOKEN), {
      method: "POST",
      headers: {"Content-Type":"text/plain; charset=utf-8"},
      body: text
    });
    if(!res.ok) throw new Error();
    clipStatus.className = "status ok";
    clipStatus.textContent = "Copied to PC Clipboard!";
    clipText.value = "";
  }catch{
    clipStatus.textContent = "Could not send text to PC";
  }finally{
    clipBtn.disabled = false;
  }
});

async function loadFiles(){
  try{
    const res = await fetch("/api/files?t="+encodeURIComponent(TOKEN));
    if(!res.ok) throw new Error();
    const items = await res.json();
    if(!items.length){
      fileList.innerHTML = '<div class="empty">Drop files into MS Island Shelf on your PC to download them here.</div>';
      return;
    }
    fileList.innerHTML = "";
    for(const f of items){
      const row = document.createElement("div");
      row.className = "item";
      const ext = document.createElement("div");
      ext.className = "ext";
      ext.textContent = (f.ext || "FILE").slice(0,4);
      const meta = document.createElement("div");
      meta.className = "meta";
      const name = document.createElement("div");
      name.className = "fname";
      name.textContent = f.name;
      const size = document.createElement("div");
      size.className = "fsize";
      size.textContent = fmtBytes(f.sizeBytes);
      meta.appendChild(name);
      meta.appendChild(size);
      const a = document.createElement("a");
      a.className = "dl";
      a.href = "/api/download/"+f.idx+"?t="+encodeURIComponent(TOKEN);
      a.download = f.name;
      a.textContent = "Download";
      row.appendChild(ext);
      row.appendChild(meta);
      row.appendChild(a);
      fileList.appendChild(row);
    }
  }catch{
    fileList.innerHTML = '<div class="empty">Disconnected from MS Island.</div>';
  }
}

refreshBtn.addEventListener("click", loadFiles);
loadFiles();
setInterval(()=>{ if(!document.hidden) loadFiles(); }, 3500);
</script>
</body>
</html>
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qr_svg_generates_valid_vector() {
        let svg = render_qr_svg("http://192.168.1.10:8765/?t=0123456789abcdef").unwrap();
        assert!(svg.starts_with("<svg"));
        assert!(svg.contains("</svg>"));
    }

    #[test]
    fn sanitize_filename_blocks_traversal() {
        assert_eq!(sanitize_filename("../../evil.exe"), "evil.exe");
        assert_eq!(sanitize_filename("a/b/photo:1*.jpg"), "photo1.jpg");
    }
}
