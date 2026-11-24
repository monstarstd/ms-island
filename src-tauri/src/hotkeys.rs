use std::thread;
use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_ALT, MOD_NOREPEAT, MOD_SHIFT,
};
use windows::Win32::UI::WindowsAndMessaging::{GetMessageW, MSG, WM_HOTKEY};

const HOTKEY_TOGGLE_ISLAND: i32 = 1; // Alt + I
const HOTKEY_TOGGLE_LYRICS: i32 = 2; // Alt + L
const HOTKEY_PLAY_PAUSE: i32 = 3; // Alt + Shift + Space

const VK_I: u32 = 0x49;
const VK_L: u32 = 0x4C;
const VK_SPACE: u32 = 0x20;

/// Spawns a zero-CPU kernel-blocking Win32 RegisterHotKey listener thread.
/// Dispatches actions via callbacks/events cleanly without blocking the UI thread.
pub fn spawn_global_hotkeys<F, G>(app: AppHandle, on_toggle_lyrics: F, on_play_pause: G)
where
    F: Fn(&AppHandle) + Send + 'static,
    G: Fn(&AppHandle) + Send + 'static,
{
    thread::spawn(move || unsafe {
        let hwnd = HWND::default();
        let _ = RegisterHotKey(
            hwnd,
            HOTKEY_TOGGLE_ISLAND,
            HOT_KEY_MODIFIERS(MOD_ALT.0 | MOD_NOREPEAT.0),
            VK_I,
        );
        let _ = RegisterHotKey(
            hwnd,
            HOTKEY_TOGGLE_LYRICS,
            HOT_KEY_MODIFIERS(MOD_ALT.0 | MOD_NOREPEAT.0),
            VK_L,
        );
        let _ = RegisterHotKey(
            hwnd,
            HOTKEY_PLAY_PAUSE,
            HOT_KEY_MODIFIERS(MOD_ALT.0 | MOD_SHIFT.0 | MOD_NOREPEAT.0),
            VK_SPACE,
        );

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, hwnd, 0, 0).as_bool() {
            if msg.message == WM_HOTKEY {
                match msg.wParam.0 as i32 {
                    HOTKEY_TOGGLE_ISLAND => {
                        let h_ui = app.clone();
                        let _ = app.run_on_main_thread(move || {
                            if let Some(w) = h_ui.get_webview_window("island") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                            let _ = h_ui.emit("island-hotkey-toggle", ());
                        });
                    }
                    HOTKEY_TOGGLE_LYRICS => {
                        on_toggle_lyrics(&app);
                    }
                    HOTKEY_PLAY_PAUSE => {
                        on_play_pause(&app);
                    }
                    _ => {}
                }
            }
        }

        let _ = UnregisterHotKey(hwnd, HOTKEY_TOGGLE_ISLAND);
        let _ = UnregisterHotKey(hwnd, HOTKEY_TOGGLE_LYRICS);
        let _ = UnregisterHotKey(hwnd, HOTKEY_PLAY_PAUSE);
    });
}
