# MS Island

**Lightweight Windows Dynamic Island & Desktop Command Center** by **Monstar Studio**.

Built with **Tauri v2 (Rust + native Win32/WinRT APIs)** and **React + TypeScript + Tailwind CSS**. Designed with a flat matte aesthetic, album-art adaptive accent color, and near-zero idle CPU usage.

---

## Key Features

- **4 Universal Styles** (synced automatically between MS Island and Floating Lyrics):
  - **Notch**: Flush edge capsule attached to the screen border.
  - **Pill (+ Auto-Split Twin)**: Floating capsule that splits into Twin-Islands when Music and Timer/Pomodoro/Stopwatch/Download run together.
  - **Orb (`48x48px`)**: Circular floating bubble with a live circular progress ring.
  - **Handle**: Ultra-slim `10px` edge strip for distraction-free focus.
- **5 Dock Positions**: `Top`, `Left`, `Right`, `Bottom-Left`, and `Bottom-Right` (respecting Windows Taskbar work area), plus free drag-and-snap.
- **8 Built-in Tabs**:
  1. **Music**: Native Windows SMTC media controls, real WASAPI audio visualizer (`Bars`, `Wave`, `Dots`), scrubbar, volume, and **Back to Tab** button to jump straight to YouTube / Spotify / Browser.
  2. **Clock**: Real-time digital clock & date.
  3. **Timer & Pomodoro**: Countdown presets + Pomodoro (`Focus 25m / Short 5m / Long 15m`, 4-cycle tracker) with native Windows chime.
  4. **Stopwatch**: Precision lap stopwatch.
  5. **Weather**: Live local weather with city search & auto-detect reset.
  6. **Notes, Snippets & Clipboard**: Quick notes, reusable 1-click **Quick Snippets**, native Windows Clipboard History (`Win+V`) sync, and **Screen Color Picker (Eyedropper)** with live HUD.
  7. **File Shelf & Wi-Fi LAN Shelf**: Drag-in/drag-out temporary file shelf, live browser download monitor, and QR-authenticated local Wi-Fi transfer between phone and PC.
  8. **System**: Live CPU/RAM/Battery monitor, Audio Output Switcher, Master Volume, Fullscreen Auto-Hide, Start with Windows, and GitHub Release update checker.
- **Floating Lyrics Window**:
  - Synced (auto-scroll + click-to-seek) & Static modes powered by smart LRCLIB search & live autocomplete.
  - Shows the exact active lyrics version loaded at the top of the lyrics panel, plus a **Back to Tab** shortcut and slim mini player.
  - Edge **Auto-Peek** with **Smart Side-Follow** that automatically follows MS Island between Left and Right edges.

---

## Global Shortcuts

| Shortcut | Action |
| --- | --- |
| `Alt + I` | Focus / reveal MS Island |
| `Alt + L` | Toggle Floating Lyrics window |
| `Alt + Shift + Space` | Play / Pause active media |
| `1` - `8` *(when expanded)* | Switch tabs |
| `Scroll` *(on idle bar)* | Adjust system master volume |
| `Right-Click` *(on Island)* | Dock Position, Style picker, Eyedropper, Theme, Quit |

---

## Development & Release Packaging

```powershell
# Development
npm install
npm run tauri dev

# Build signed v1.0.0 Release (NSIS Installer + Portable ZIP)
powershell -ExecutionPolicy Bypass -File scripts\build_release.ps1
```

Outputs are generated in `release-dist/`:
- `MS-Island_1.0.0_Setup.exe` (Signed Windows Installer)
- `MS-Island_1.0.0_Portable.zip` (Signed Portable Executable)

---

Copyright (C) 2026 **Monstar Studio**.
