import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Clock,
  CloudSun,
  Cpu,
  GripHorizontal,
  Hourglass,
  Inbox,
  Moon,
  Music,
  PanelTop,
  RectangleHorizontal,
  StickyNote,
  Sun,
  Timer as TimerIcon,
} from "lucide-react";
import { MediaTrack } from "../types/media";
import { ThemeMode } from "../types/theme";
import {
  ActiveDownloadInfo,
  AudioDeviceInfo,
  BatteryInfo,
  ClipboardEntry,
  ClipboardSyncPayload,
  IslandToast,
  ShelfFileInfo,
  SystemStats,
  VisualizerStyle,
  VolumeInfo,
  WeatherInfo,
  WifiShareStatus,
} from "../types/system";
import {
  formatAmPmTime,
  formatBytes,
  formatSpeed,
  getIslandThemeTokens,
  playSoftChime,
  unlockAudioContext,
} from "./island/helpers";
import { IdleBar } from "./island/IdleBar";
import { ContextMenu } from "./island/ContextMenu";
import { MusicTab } from "./island/MusicTab";
import { ClockTab } from "./island/ClockTab";
import { TimerTab } from "./island/TimerTab";
import { StopwatchTab } from "./island/StopwatchTab";
import { WeatherTab } from "./island/WeatherTab";
import { NotesTab } from "./island/NotesTab";
import { ShelfTab } from "./island/ShelfTab";
import { SystemTab } from "./island/SystemTab";

interface DynamicIslandProps {
  media: MediaTrack;
  isLyricsOpen: boolean;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onTogglePlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (positionSec: number) => void;
  onToggleLyricsWindow: () => void;
  onStartDrag: () => void;
}

type TabType =
  | "music"
  | "clock"
  | "timer"
  | "stopwatch"
  | "weather"
  | "notes"
  | "shelf"
  | "system";

const TABS: { id: TabType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "music", label: "Music", icon: Music },
  { id: "clock", label: "Clock", icon: Clock },
  { id: "timer", label: "Timer", icon: Hourglass },
  { id: "stopwatch", label: "Stopwatch", icon: TimerIcon },
  { id: "weather", label: "Weather", icon: CloudSun },
  { id: "notes", label: "Notes", icon: StickyNote },
  { id: "shelf", label: "Shelf", icon: Inbox },
  { id: "system", label: "System", icon: Cpu },
];

export const DynamicIsland: React.FC<DynamicIslandProps> = ({
  media,
  isLyricsOpen,
  theme,
  onToggleTheme,
  onTogglePlayPause,
  onNext,
  onPrev,
  onSeek,
  onToggleLyricsWindow,
  onStartDrag,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("music");
  const [dockEdge, setDockEdge] = useState<"top" | "left" | "right" | "floating">("top");
  const [barStyle, setBarStyle] = useState<"notch" | "island">(() => {
    const saved = localStorage.getItem("ms-island-bar-style");
    return saved === "island" ? "island" : "notch";
  });
  const [isMoving, setIsMoving] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const hoverTimeoutRef = useRef<number | null>(null);
  const hoverEnterTimeoutRef = useRef<number | null>(null);
  const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
  const isLight = theme === "light";
  const tokens = useMemo(() => getIslandThemeTokens(isLight), [isLight]);

  // Keep Rust and Lyrics window synced with initial barStyle
  useEffect(() => {
    if (!isTauri) return;
    invoke("set_bar_style", { style: barStyle }).catch(() => {});
  }, [isTauri]);

  // 1. Dock Edge & Drag Motion Sync
  useEffect(() => {
    if (!isTauri) return;
    let active = true;
    let unlistenEdge: (() => void) | undefined;
    let unlistenMove: (() => void) | undefined;

    Promise.all([
      listen<string>("island-dock-changed", (e) => {
        if (
          e.payload === "top" ||
          e.payload === "left" ||
          e.payload === "right" ||
          e.payload === "floating"
        ) {
          setDockEdge(e.payload);
        }
      }),
      listen<boolean>("island-moving", (e) => {
        setIsMoving(e.payload);
      }),
    ]).then(([uEdge, uMove]) => {
      if (active) {
        unlistenEdge = uEdge;
        unlistenMove = uMove;
      } else {
        uEdge();
        uMove();
      }
    });

    return () => {
      active = false;
      if (unlistenEdge) unlistenEdge();
      if (unlistenMove) unlistenMove();
    };
  }, [isTauri]);

  // 2. Visualizer Preference (WASAPI spectrum polling is isolated inside AudioVisualizer)
  const [visualizerStyle, setVisualizerStyle] = useState<VisualizerStyle>(() => {
    const saved = localStorage.getItem("ms-island-visualizer");
    return saved === "wave" || saved === "dots" || saved === "bars" ? saved : "bars";
  });

  const handleSetVisualizer = useCallback((style: VisualizerStyle) => {
    setVisualizerStyle(style);
    localStorage.setItem("ms-island-visualizer", style);
  }, []);

  // 3. Smart Real-Time Clock (1 render/min when idle; instant + 1s tick ONLY on Clock tab)
  const [currentTime, setCurrentTime] = useState<Date>(() => new Date());
  const needsSecondsTick = isHovered && activeTab === "clock";
  useEffect(() => {
    if (needsSecondsTick) {
      setCurrentTime(new Date());
    }
    const id = window.setInterval(() => {
      const now = new Date();
      if (needsSecondsTick) {
        setCurrentTime(now);
      } else {
        setCurrentTime((prev) =>
          prev.getMinutes() === now.getMinutes() && prev.getHours() === now.getHours() ? prev : now
        );
      }
    }, 1000);
    return () => clearInterval(id);
  }, [needsSecondsTick]);

  // 4. Transient Toasts (Caps Lock, Charger, Audio Output, Refresh)
  const [toast, setToast] = useState<IslandToast | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const showToast = useCallback((kind: string, message: string, durationMs = 2000) => {
    setToast({ kind, message });
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = window.setTimeout(() => setToast(null), durationMs);
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    listen<IslandToast>("island-toast", (e) => {
      showToast(e.payload.kind, e.payload.message, 2200);
    }).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    });
    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, [isTauri, showToast]);

  // 5. Volume, Scroll Wheel HUD & Audio Output Switcher (zero idle polling)
  const [volume, setVolume] = useState<VolumeInfo>({ level: 50, muted: false });
  const [showVolumeHud, setShowVolumeHud] = useState(false);
  const volumeHudTimeoutRef = useRef<number | null>(null);
  const lastWheelTimeRef = useRef(0);
  const [audioDevices, setAudioDevices] = useState<AudioDeviceInfo[]>([]);

  const loadAudioDevices = useCallback(async () => {
    if (!isTauri) return;
    try {
      const list = await invoke<AudioDeviceInfo[]>("get_audio_devices");
      setAudioDevices(list);
    } catch {}
  }, [isTauri]);

  const loadVolume = useCallback(async () => {
    if (!isTauri) return;
    try {
      const v = await invoke<VolumeInfo>("get_volume");
      setVolume(v);
    } catch {}
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri) return;
    loadVolume();
    loadAudioDevices();
  }, [isTauri, loadVolume, loadAudioDevices]);

  useEffect(() => {
    if (!isHovered) return;
    loadVolume();
    if (activeTab === "system") loadAudioDevices();
  }, [isHovered, activeTab, loadVolume, loadAudioDevices]);

  const handleSwitchAudioDevice = useCallback(
    async (device: AudioDeviceInfo) => {
      if (!isTauri) return;
      try {
        await invoke("switch_audio_device", { deviceId: device.id });
        await loadAudioDevices();
        showToast("audio", `Output: ${device.name}`, 2000);
      } catch {
        showToast("audio", "Could not switch audio device", 2200);
      }
    },
    [isTauri, loadAudioDevices, showToast]
  );

  const handleSetVolume = useCallback(
    async (newLevel: number) => {
      const clamped = Math.max(0, Math.min(100, Math.round(newLevel)));
      setVolume((prev) => ({ level: clamped, muted: clamped === 0 ? prev.muted : false }));
      if (isTauri) {
        try {
          const updated = await invoke<VolumeInfo>("set_volume", { level: clamped });
          setVolume(updated);
        } catch {}
      }
    },
    [isTauri]
  );

  const handleToggleMute = useCallback(async () => {
    setVolume((prev) => ({ ...prev, muted: !prev.muted }));
    if (isTauri) {
      try {
        const updated = await invoke<VolumeInfo>("toggle_mute");
        setVolume(updated);
      } catch {}
    }
  }, [isTauri]);

  const handleWheelVolume = async (e: React.WheelEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "TEXTAREA" || target.closest(".scrollable-area"))) return;

    const now = performance.now();
    if (now - lastWheelTimeRef.current < 45) return;
    lastWheelTimeRef.current = now;

    const delta = e.deltaY < 0 ? 5 : -5;
    setShowVolumeHud(true);
    if (volumeHudTimeoutRef.current) clearTimeout(volumeHudTimeoutRef.current);
    volumeHudTimeoutRef.current = window.setTimeout(() => setShowVolumeHud(false), 1700);

    if (isTauri) {
      try {
        const updated = await invoke<VolumeInfo>("adjust_volume", { delta });
        setVolume(updated);
      } catch {}
    } else {
      setVolume((prev) => ({
        level: Math.max(0, Math.min(100, prev.level + delta)),
        muted: false,
      }));
    }
  };

  // 6. Countdown Timer (Wall-Clock Accurate + Native Chime + Auto-Open on Complete)
  const [timerDuration, setTimerDuration] = useState(300);
  const [timerRemaining, setTimerRemaining] = useState(300);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [isTimerFinished, setIsTimerFinished] = useState(false);
  const timerEndAtRef = useRef<number>(0);

  useEffect(() => {
    if (!isTimerRunning) return;
    const id = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((timerEndAtRef.current - Date.now()) / 1000));
      setTimerRemaining((prev) => (prev === left ? prev : left));
    }, 250);
    return () => clearInterval(id);
  }, [isTimerRunning]);

  useEffect(() => {
    if (isTimerRunning && timerRemaining === 0) {
      setIsTimerRunning(false);
      setIsTimerFinished(true);
      setActiveTab("timer");
      setIsHovered(true);
      playSoftChime();
    }
  }, [isTimerRunning, timerRemaining]);

  const handleStartPauseTimer = useCallback(() => {
    unlockAudioContext();
    if (!isTimerRunning) {
      const startSec = timerRemaining === 0 ? timerDuration : timerRemaining;
      if (timerRemaining === 0) {
        setIsTimerFinished(false);
        setTimerRemaining(startSec);
      }
      timerEndAtRef.current = Date.now() + startSec * 1000;
      setIsTimerRunning(true);
      return;
    }
    const left = Math.max(0, Math.ceil((timerEndAtRef.current - Date.now()) / 1000));
    setTimerRemaining(left);
    setIsTimerRunning(false);
  }, [isTimerRunning, timerRemaining, timerDuration]);

  const handleResetTimer = useCallback(() => {
    setIsTimerRunning(false);
    setIsTimerFinished(false);
    setTimerRemaining(timerDuration);
  }, [timerDuration]);

  const handleSetPresetTimer = useCallback((seconds: number, autoStart = false) => {
    if (autoStart) {
      unlockAudioContext();
      timerEndAtRef.current = Date.now() + seconds * 1000;
    }
    setIsTimerRunning(autoStart);
    setIsTimerFinished(false);
    setTimerDuration(seconds);
    setTimerRemaining(seconds);
  }, []);

  const handleAdjustTimer = useCallback(
    (diff: number) => {
      setTimerRemaining((prev) => {
        const floor = isTimerRunning ? 1 : Math.min(10, prev);
        const next = diff < 0 ? Math.max(floor, prev + diff) : Math.max(10, prev + diff);
        if (!isTimerRunning) {
          setTimerDuration(next);
        } else {
          timerEndAtRef.current = Date.now() + next * 1000;
          if (next > timerDuration) setTimerDuration(next);
        }
        return next;
      });
      setIsTimerFinished(false);
    },
    [isTimerRunning, timerDuration]
  );

  // 7. Millisecond Stopwatch (~30fps UI tick backed by exact performance.now())
  const [stopwatchTimeMs, setStopwatchTimeMs] = useState(0);
  const [isStopwatchRunning, setIsStopwatchRunning] = useState(false);
  const [stopwatchLaps, setStopwatchLaps] = useState<number[]>([]);
  const stopwatchStartRef = useRef(0);
  const stopwatchAccRef = useRef(0);

  useEffect(() => {
    if (!isStopwatchRunning) return;
    stopwatchStartRef.current = performance.now();
    const id = window.setInterval(() => {
      setStopwatchTimeMs(stopwatchAccRef.current + (performance.now() - stopwatchStartRef.current));
    }, 33);
    return () => clearInterval(id);
  }, [isStopwatchRunning]);

  const handleToggleStopwatch = useCallback(() => {
    if (isStopwatchRunning) {
      const elapsed = stopwatchAccRef.current + (performance.now() - stopwatchStartRef.current);
      stopwatchAccRef.current = elapsed;
      setStopwatchTimeMs(elapsed);
      setIsStopwatchRunning(false);
    } else {
      stopwatchStartRef.current = performance.now();
      setIsStopwatchRunning(true);
    }
  }, [isStopwatchRunning]);

  const handleResetStopwatch = useCallback(() => {
    setIsStopwatchRunning(false);
    stopwatchAccRef.current = 0;
    setStopwatchTimeMs(0);
    setStopwatchLaps([]);
  }, []);

  const handleLapStopwatch = useCallback(() => {
    if (isStopwatchRunning) {
      const nowMs = stopwatchAccRef.current + (performance.now() - stopwatchStartRef.current);
      setStopwatchLaps((prev) => [nowMs, ...prev]);
    }
  }, [isStopwatchRunning]);

  // 8. Weather (Single API call, safe localStorage commit only on valid city)
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [savedWeatherCity, setSavedWeatherCity] = useState(
    () => localStorage.getItem("ms-island-weather-city") || ""
  );
  const savedWeatherCityRef = useRef(savedWeatherCity);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState("");

  const loadWeather = useCallback(
    async (cityOverride?: string) => {
      if (!isTauri) return;
      setWeatherLoading(true);
      setWeatherError("");
      try {
        const targetCity = cityOverride !== undefined ? cityOverride : savedWeatherCityRef.current;
        const trimmed = targetCity.trim();
        const data = await invoke<WeatherInfo>("get_weather", {
          city: trimmed ? trimmed : null,
        });
        setWeather(data);
        if (cityOverride !== undefined) {
          savedWeatherCityRef.current = trimmed;
          setSavedWeatherCity(trimmed);
          localStorage.setItem("ms-island-weather-city", trimmed);
        }
      } catch (e: any) {
        setWeatherError(typeof e === "string" ? e : "Could not reach weather service");
      } finally {
        setWeatherLoading(false);
      }
    },
    [isTauri]
  );

  useEffect(() => {
    if (!isTauri) return;
    loadWeather();
    const id = setInterval(() => loadWeather(), 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [isTauri, loadWeather]);

  const handleSearchWeatherCity = useCallback(
    (nextCity: string) => {
      loadWeather(nextCity.trim());
    },
    [loadWeather]
  );

  // 9. Notes & Windows Win+V Clipboard Two-Way Sync
  const [notesMode, setNotesMode] = useState<"scratchpad" | "clipboard">("scratchpad");
  const [notesText, setNotesText] = useState(() => localStorage.getItem("ms-island-notes") || "");
  const [clipboardHistory, setClipboardHistory] = useState<ClipboardEntry[]>([]);
  const [winClipboardSynced, setWinClipboardSynced] = useState(false);

  const loadClipboardHistory = useCallback(async () => {
    if (!isTauri) return;
    try {
      const payload = await invoke<ClipboardSyncPayload>("get_clipboard_history");
      setClipboardHistory(payload.items || []);
      setWinClipboardSynced(Boolean(payload.windowsHistoryEnabled));
    } catch {}
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    loadClipboardHistory();
    listen<ClipboardSyncPayload>("clipboard-updated", (e) => {
      setClipboardHistory(e.payload.items || []);
      setWinClipboardSynced(Boolean(e.payload.windowsHistoryEnabled));
    }).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    });
    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, [isTauri, loadClipboardHistory]);

  useEffect(() => {
    if (isHovered && activeTab === "notes" && notesMode === "clipboard") {
      loadClipboardHistory();
    }
  }, [isHovered, activeTab, notesMode, loadClipboardHistory]);

  const handleNotesChange = useCallback((val: string) => {
    setNotesText(val);
    localStorage.setItem("ms-island-notes", val);
  }, []);

  const handleCopyClipItem = useCallback(
    async (item: ClipboardEntry) => {
      if (isTauri) {
        try {
          await invoke("copy_clipboard_item", { id: item.id, text: item.text });
          return;
        } catch {}
      }
      navigator.clipboard.writeText(item.text);
    },
    [isTauri]
  );

  const handleDeleteClipItem = useCallback(
    async (id: string) => {
      setClipboardHistory((prev) => prev.filter((item) => item.id !== id));
      if (!isTauri) return;
      try {
        const updated = await invoke<ClipboardSyncPayload>("delete_clipboard_item", { id });
        setClipboardHistory(updated.items || []);
        setWinClipboardSynced(Boolean(updated.windowsHistoryEnabled));
      } catch {}
    },
    [isTauri]
  );

  const handleClearClipboard = useCallback(async () => {
    setClipboardHistory([]);
    if (!isTauri) return;
    try {
      const updated = await invoke<ClipboardSyncPayload>("clear_clipboard_history");
      setClipboardHistory(updated.items || []);
      setWinClipboardSynced(Boolean(updated.windowsHistoryEnabled));
    } catch {}
  }, [isTauri]);

  // 10. File Drop Shelf, Native Drag-Out & Live Browser Downloads
  const [shelfFiles, setShelfFiles] = useState<ShelfFileInfo[]>(() => {
    try {
      const saved = localStorage.getItem("ms-island-shelf");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [isDragOver, setIsDragOver] = useState(false);
  const [activeDownload, setActiveDownload] = useState<ActiveDownloadInfo | null>(null);
  const [shelfMode, setShelfMode] = useState<"files" | "wifi">("files");
  const [wifiStatus, setWifiStatus] = useState<WifiShareStatus>({
    running: false,
    url: "",
    displayUrl: "",
    qrSvg: "",
    saveDir: "",
    receivedCount: 0,
  });
  const [wifiBusy, setWifiBusy] = useState(false);
  const [wifiError, setWifiError] = useState("");
  const isDraggingOutRef = useRef(false);
  const mouseInsideRef = useRef(false);

  useEffect(() => {
    localStorage.setItem("ms-island-shelf", JSON.stringify(shelfFiles));
    if (isTauri) {
      invoke("sync_wifi_shelf_files", { files: shelfFiles }).catch(() => {});
    }
  }, [shelfFiles, isTauri]);

  useEffect(() => {
    if (!isTauri) return;
    let active = true;
    let unlisteners: Array<() => void> = [];

    Promise.all([
      listen<boolean>("shelf-drag-state", (e) => setIsDragOver(e.payload)),
      listen<ShelfFileInfo[]>("shelf-files-dropped", (e) => {
        setIsDragOver(false);
        setShelfFiles((prev) => {
          const existing = new Set(prev.map((f) => f.path));
          return [...e.payload.filter((f) => !existing.has(f.path)), ...prev].slice(0, 12);
        });
        setActiveTab("shelf");
        setIsHovered(true);
      }),
      listen<ActiveDownloadInfo | null>("downloads-updated", (e) => {
        setActiveDownload(e.payload);
      }),
      listen<ShelfFileInfo>("download-completed", (e) => {
        const downloadedItem: ShelfFileInfo = { ...e.payload, fromDownload: true };
        setShelfFiles((prev) => {
          const filtered = prev.filter((f) => f.path !== downloadedItem.path);
          return [downloadedItem, ...filtered].slice(0, 12);
        });
      }),
      listen<ShelfFileInfo>("wifi-file-received", (e) => {
        const wifiItem: ShelfFileInfo = { ...e.payload, fromWifi: true };
        setShelfFiles((prev) => {
          const filtered = prev.filter((f) => f.path !== wifiItem.path);
          return [wifiItem, ...filtered].slice(0, 12);
        });
        setWifiStatus((prev) => ({
          ...prev,
          receivedCount: prev.receivedCount + 1,
        }));
      }),
      listen("island-hotkey-toggle", () => {
        setContextMenu(null);
        setIsHovered((prev) => {
          if (prev) setActiveTab("music");
          return !prev;
        });
      }),
    ]).then((fns) => {
      if (active) unlisteners = fns;
      else fns.forEach((fn) => fn());
    });

    return () => {
      active = false;
      unlisteners.forEach((fn) => fn());
    };
  }, [isTauri]);

  const handleOpenShelfFile = useCallback(
    async (path: string) => {
      if (!isTauri) return;
      const ok = await invoke<boolean>("open_shelf_file", { path });
      if (!ok) showToast("shelf", "File no longer exists on disk", 2200);
    },
    [isTauri, showToast]
  );

  const handleRevealShelfFile = useCallback(
    async (path: string) => {
      if (!isTauri) return;
      const ok = await invoke<boolean>("reveal_shelf_file", { path });
      if (!ok) showToast("shelf", "File no longer exists on disk", 2200);
    },
    [isTauri, showToast]
  );

  const handleDragOutShelfFile = useCallback(
    async (path: string) => {
      if (!isTauri || isDraggingOutRef.current) return;
      isDraggingOutRef.current = true;
      try {
        await invoke("start_file_drag_out", { path });
      } catch (e: any) {
        const msg = typeof e === "string" ? e : "Could not drag file";
        showToast("shelf", msg.includes("exists") ? "File no longer exists on disk" : msg, 2200);
      } finally {
        isDraggingOutRef.current = false;
        if (!mouseInsideRef.current) {
          if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
          hoverTimeoutRef.current = window.setTimeout(() => {
            if (!mouseInsideRef.current && !isDraggingOutRef.current) {
              setIsHovered(false);
              setActiveTab("music");
            }
          }, 220);
        }
      }
    },
    [isTauri, showToast]
  );

  const handleRemoveShelfFile = useCallback((path: string) => {
    setShelfFiles((prev) => prev.filter((f) => f.path !== path));
  }, []);

  const handleClearShelf = useCallback(() => setShelfFiles([]), []);

  const handleStartWifiShelf = useCallback(async () => {
    if (!isTauri || wifiBusy) return;
    setWifiBusy(true);
    setWifiError("");
    try {
      await invoke("sync_wifi_shelf_files", { files: shelfFiles });
      const st = await invoke<WifiShareStatus>("start_wifi_shelf");
      setWifiStatus(st);
      showToast("shelf", "Wi-Fi Shelf active", 1800);
    } catch (e: any) {
      setWifiError(typeof e === "string" ? e : "Could not start Wi-Fi server");
    } finally {
      setWifiBusy(false);
    }
  }, [isTauri, wifiBusy, shelfFiles, showToast]);

  const handleStopWifiShelf = useCallback(async () => {
    if (!isTauri || wifiBusy) return;
    setWifiBusy(true);
    setWifiError("");
    try {
      const st = await invoke<WifiShareStatus>("stop_wifi_shelf");
      setWifiStatus(st);
      showToast("shelf", "Wi-Fi Shelf stopped", 1600);
    } catch {} finally {
      setWifiBusy(false);
    }
  }, [isTauri, wifiBusy, showToast]);

  const handleOpenWifiSaveDir = useCallback(async () => {
    if (!isTauri) return;
    await invoke("open_wifi_save_dir").catch(() => {});
  }, [isTauri]);

  // 11. Hardware Monitor, Battery, Auto-Hide Fullscreen & Windows Auto-Start
  const [sysStats, setSysStats] = useState<SystemStats>({
    cpuPercent: 0,
    ramPercent: 0,
    ramUsedGb: 0,
    ramTotalGb: 0,
  });
  const [battery, setBattery] = useState<BatteryInfo>({
    hasBattery: false,
    percent: 100,
    isCharging: true,
  });
  const [cpuHistory, setCpuHistory] = useState<number[]>(() => Array(14).fill(6));
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [autoHideFullscreen, setAutoHideFullscreen] = useState<boolean>(() => {
    const saved = localStorage.getItem("ms-island-autohide-fs");
    return saved === null ? true : saved === "true";
  });

  useEffect(() => {
    if (!isTauri) return;
    let mounted = true;
    const savedAutoHide = localStorage.getItem("ms-island-autohide-fs");
    const desiredAutoHide = savedAutoHide === null ? true : savedAutoHide === "true";
    Promise.all([
      invoke<boolean>("get_autostart"),
      invoke<boolean>("set_auto_hide_fullscreen", { enabled: desiredAutoHide }),
      invoke<BatteryInfo>("get_battery_info"),
    ])
      .then(([autoStart, autoHide, bat]) => {
        if (mounted) {
          setAutostartEnabled(autoStart);
          setAutoHideFullscreen(autoHide);
          setBattery(bat);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri || !isHovered || activeTab !== "system") return;
    let mounted = true;
    const pollStats = async () => {
      try {
        const [stats, bat] = await Promise.all([
          invoke<SystemStats>("get_system_stats"),
          invoke<BatteryInfo>("get_battery_info"),
        ]);
        if (mounted) {
          setSysStats(stats);
          setBattery(bat);
          setCpuHistory((prev) => [...prev.slice(1), Math.max(4, stats.cpuPercent)]);
        }
      } catch {}
    };
    pollStats();
    const id = setInterval(pollStats, 1500);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [isTauri, isHovered, activeTab]);

  const handleToggleAutostart = useCallback(async () => {
    if (!isTauri || autostartBusy) return;
    setAutostartBusy(true);
    try {
      const result = await invoke<boolean>("set_autostart", { enabled: !autostartEnabled });
      setAutostartEnabled(result);
      showToast("system", result ? "Start with Windows ON" : "Start with Windows OFF", 1800);
    } catch {
      showToast("system", "Could not update startup setting", 2200);
    } finally {
      setAutostartBusy(false);
    }
  }, [isTauri, autostartBusy, autostartEnabled, showToast]);

  const handleToggleAutoHideFullscreen = useCallback(async () => {
    if (!isTauri) return;
    const next = !autoHideFullscreen;
    localStorage.setItem("ms-island-autohide-fs", String(next));
    try {
      const result = await invoke<boolean>("set_auto_hide_fullscreen", {
        enabled: next,
      });
      setAutoHideFullscreen(result);
    } catch {}
  }, [isTauri, autoHideFullscreen]);

  // 12. Keyboard Shortcuts & Right-Click Context Menu
  useEffect(() => {
    if (!isHovered && !contextMenu) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (contextMenu && e.key === "Escape") {
        setContextMenu(null);
        return;
      }
      if (!isHovered) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === "Escape") {
        setIsTimerFinished(false);
        setIsHovered(false);
        setActiveTab("music");
        return;
      }
      if (e.key === " " && activeTab === "music") {
        e.preventDefault();
        onTogglePlayPause();
        return;
      }
      const num = Number(e.key);
      if (num >= 1 && num <= TABS.length) setActiveTab(TABS[num - 1].id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isHovered, contextMenu, activeTab, onTogglePlayPause]);

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (hoverEnterTimeoutRef.current) clearTimeout(hoverEnterTimeoutRef.current);
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverEnterTimeoutRef.current = null;
    hoverTimeoutRef.current = null;
    const x = Math.max(8, Math.min(window.innerWidth - 208, e.clientX));
    const y = Math.max(8, Math.min(window.innerHeight - 238, e.clientY + 6));
    setContextMenu({ x, y });
  };

  const handleDockToEdge = useCallback(
    async (edge: "top" | "left" | "right") => {
      setContextMenu(null);
      setIsHovered(false);
      setActiveTab("music");
      setDockEdge(edge);
      if (isTauri) {
        try {
          await invoke("dock_island_to_edge", { edge });
        } catch {}
      }
      showToast(
        "refresh",
        edge === "left" ? "Docked Left" : edge === "right" ? "Docked Right" : "Docked Top",
        1600
      );
    },
    [isTauri, showToast]
  );

  const handleToggleBarStyle = useCallback(() => {
    setBarStyle((prev) => {
      const next = prev === "notch" ? "island" : "notch";
      localStorage.setItem("ms-island-bar-style", next);
      if (isTauri) {
        invoke("set_bar_style", { style: next }).catch(() => {});
      }
      showToast(
        "refresh",
        next === "island" ? "Floating Pill Style" : "Edge Notch Style",
        1700
      );
      return next;
    });
  }, [isTauri, showToast]);

  const handleRefreshIsland = useCallback(async () => {
    setContextMenu(null);
    setDockEdge("top");
    setIsHovered(false);
    setActiveTab("music");
    if (isTauri) {
      try {
        await invoke("reset_island_position");
        loadWeather();
        loadAudioDevices();
        showToast("refresh", "Reset to Top Center", 1800);
      } catch {}
    }
  }, [isTauri, loadWeather, loadAudioDevices, showToast]);

  const handleQuitApp = useCallback(async () => {
    setContextMenu(null);
    if (isTauri) {
      await invoke("quit_app");
    }
  }, [isTauri]);

  // 13. Snappy Physical Pill Hover Handlers (45ms open, 75ms close)
  const handleMouseEnter = () => {
    mouseInsideRef.current = true;
    if (contextMenu) return;
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    if (!isHovered && !hoverEnterTimeoutRef.current) {
      hoverEnterTimeoutRef.current = window.setTimeout(() => {
        hoverEnterTimeoutRef.current = null;
        setIsHovered(true);
      }, 45);
    }
  };

  const handleMouseLeave = () => {
    mouseInsideRef.current = false;
    if (contextMenu || isDraggingOutRef.current || isTimerFinished) return;
    if (hoverEnterTimeoutRef.current) {
      clearTimeout(hoverEnterTimeoutRef.current);
      hoverEnterTimeoutRef.current = null;
    }
    hoverTimeoutRef.current = window.setTimeout(() => {
      if (isDraggingOutRef.current || mouseInsideRef.current || isTimerFinished) return;
      setIsHovered(false);
      setActiveTab("music");
    }, 75);
  };

  // 14. Adaptive Dynamic Width & Edge-to-Pill Geometry
  const idleClockAmPm = formatAmPmTime(currentTime, false);

  const idleWidthPx = (() => {
    if (isDragOver) return 310;
    if (showVolumeHud) return 285;
    if (toast) return Math.min(370, Math.max(255, Math.round(165 + toast.message.length * 6.5)));
    if (activeDownload) {
      const label = `${formatSpeed(activeDownload.speedBytesPerSec)} ${formatBytes(activeDownload.bytesDownloaded)} ${activeDownload.name}`;
      return Math.min(475, Math.max(320, Math.round(205 + label.length * 6.2)));
    }
    if (isTimerRunning || isTimerFinished) return 275;
    if (isStopwatchRunning) return 282;
    if (media.isPlaying) {
      const titleLen = (media.title || "Playing Audio").length;
      const artBonus = media.thumbnail ? 24 : 0;
      return Math.min(504, Math.max(296, Math.round(212 + artBonus + titleLen * 6.8)));
    }
    if (weather) {
      const weatherText = `${weather.temperature}°C ${weather.city} · ${weather.condition}`;
      return Math.min(365, Math.max(275, Math.round(188 + weatherText.length * 5.6)));
    }
    return 258;
  })();

  const isSideDock = dockEdge === "left" || dockEdge === "right";
  const isIslandStyle = barStyle === "island";
  const isDetachedPill = dockEdge === "floating" || isIslandStyle;

  const sideIdleHeightPx = (() => {
    if (showVolumeHud) return 166;
    if (media.isPlaying) return 164;
    if (toast) return 154;
    if (activeDownload || isTimerRunning || isTimerFinished || isStopwatchRunning || isDragOver) {
      return 150;
    }
    return 142;
  })();

  const outerAlignCls =
    dockEdge === "left"
      ? isIslandStyle
        ? "justify-start items-center pl-[10px]"
        : "justify-start items-center pl-0"
      : dockEdge === "right"
        ? isIslandStyle
          ? "justify-end items-center pr-[10px]"
          : "justify-end items-center pr-0"
        : dockEdge === "floating"
          ? "justify-center items-start pt-2"
          : isIslandStyle
            ? "justify-center items-start pt-[10px]"
            : "justify-center items-start pt-0";

  const shellShapeCls = (() => {
    if (isHovered) {
      if (dockEdge === "top" && !isIslandStyle) {
        return "rounded-t-none rounded-b-[22px] border-t-0 p-3.5";
      }
      if (dockEdge === "left" && !isIslandStyle) {
        return "rounded-l-none rounded-r-[22px] border-l-0 p-3.5 shadow-2xl shadow-black/45";
      }
      if (dockEdge === "right" && !isIslandStyle) {
        return "rounded-r-none rounded-l-[22px] border-r-0 p-3.5 shadow-2xl shadow-black/45";
      }
      return "rounded-[22px] p-3.5 shadow-2xl shadow-black/45";
    }
    if (dockEdge === "top" && !isIslandStyle) {
      return "rounded-t-none rounded-b-[16px] border-t-0 px-3.5 py-1.5 cursor-pointer";
    }
    if (dockEdge === "left") {
      return isIslandStyle
        ? "rounded-[23px] cursor-pointer shadow-lg shadow-black/40"
        : "rounded-l-none rounded-r-[18px] border-l-0 cursor-pointer shadow-lg shadow-black/35";
    }
    if (dockEdge === "right") {
      return isIslandStyle
        ? "rounded-[23px] cursor-pointer shadow-lg shadow-black/40"
        : "rounded-r-none rounded-l-[18px] border-r-0 cursor-pointer shadow-lg shadow-black/35";
    }
    return "rounded-[19px] px-4 py-1.5 cursor-pointer shadow-lg shadow-black/35";
  })();

  const shellWidthPx = isHovered ? 516 : isSideDock ? 46 : idleWidthPx;
  const shellHeightPx = isHovered
    ? 262
    : isSideDock
      ? sideIdleHeightPx
      : isDetachedPill
        ? 38
        : 36;

  // 15. Sync Exact Interactive Bounds to Rust (pad = 0 when idle so transparent gaps stay 100% click-through)
  useEffect(() => {
    if (!isTauri) return;
    const width = shellWidthPx;
    const height = shellHeightPx;
    const winW = window.innerWidth || 560;
    const winH = window.innerHeight || 286;
    const sideOffset = isIslandStyle ? 10 : 0;
    const x =
      dockEdge === "left"
        ? sideOffset
        : dockEdge === "right"
          ? Math.max(0, winW - width - sideOffset)
          : Math.max(0, (winW - width) / 2);
    const y = isSideDock
      ? Math.max(0, (winH - height) / 2)
      : dockEdge === "top"
        ? isIslandStyle
          ? 10
          : 0
        : 8;

    invoke("set_island_hit_rect", {
      x,
      y,
      width,
      height,
      pad: isHovered ? 2 : 0,
      fullWindow: Boolean(contextMenu || isDragOver || isMoving),
    }).catch(() => {});
  }, [
    isTauri,
    isHovered,
    shellWidthPx,
    shellHeightPx,
    dockEdge,
    isIslandStyle,
    isSideDock,
    contextMenu,
    isDragOver,
    isMoving,
  ]);

  const idleMediaProgress =
    !isHovered &&
    media.isPlaying &&
    media.durationSec > 0 &&
    !isDragOver &&
    !showVolumeHud &&
    !activeDownload
      ? Math.max(0, Math.min(1, media.positionSec / media.durationSec))
      : null;

  return (
    <div className={`relative w-full h-full flex ${outerAlignCls}`}>
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheelVolume}
        onContextMenu={handleContextMenu}
        style={{ width: `${shellWidthPx}px`, height: `${shellHeightPx}px` }}
        className={`relative island-shell-spring overflow-hidden border ${tokens.shellSurface} ${shellShapeCls} ${
          isMoving ? "scale-[1.016] shadow-2xl shadow-black/90" : "scale-100"
        } ${isDragOver ? "border-accent ring-1 ring-accent" : ""}`}
      >
        {idleMediaProgress !== null && !isSideDock && (
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-[1.5px] bg-transparent z-10">
            <div
              className="h-full w-full bg-accent origin-left transition-transform duration-300 ease-linear"
              style={{ transform: `scaleX(${idleMediaProgress.toFixed(4)})` }}
            />
          </div>
        )}
        {idleMediaProgress !== null && isSideDock && (
          <div
            className={`pointer-events-none absolute ${
              isIslandStyle ? "top-5 bottom-5" : "top-3 bottom-3"
            } w-[2px] bg-transparent z-10 ${dockEdge === "left" ? "right-0" : "left-0"}`}
          >
            <div
              className="w-full h-full bg-accent origin-bottom transition-transform duration-300 ease-linear rounded-full"
              style={{ transform: `scaleY(${idleMediaProgress.toFixed(4)})` }}
            />
          </div>
        )}
        {!isHovered ? (
          <IdleBar
            tokens={tokens}
            idleClockAmPm={idleClockAmPm}
            currentTime={currentTime}
            media={media}
            visualizerStyle={visualizerStyle}
            isLyricsOpen={isLyricsOpen}
            isDragOver={isDragOver}
            showVolumeHud={showVolumeHud}
            volume={volume}
            toast={toast}
            activeDownload={activeDownload}
            isTimerRunning={isTimerRunning}
            isTimerFinished={isTimerFinished}
            timerRemaining={timerRemaining}
            isStopwatchRunning={isStopwatchRunning}
            stopwatchTimeMs={stopwatchTimeMs}
            weather={weather}
            vertical={isSideDock}
            onToggleLyricsWindow={onToggleLyricsWindow}
            onStartDrag={onStartDrag}
          />
        ) : (
          <div className="w-[486px] h-[232px] mx-auto grid grid-rows-[auto_1fr] gap-2 select-none island-panel-fade">
            {/* Navigation Bar */}
            <div
              className={`grid grid-cols-[1fr_auto] items-center gap-2 pb-2 border-b ${
                isLight ? "border-zinc-200" : "border-zinc-800/90"
              }`}
            >
              <div
                className={`flex items-center gap-0.5 p-0.5 rounded-lg border w-fit ${
                  isLight ? "bg-zinc-200/75 border-zinc-300/80" : "bg-[#141418] border-zinc-800"
                }`}
              >
                {TABS.map(({ id, label, icon: Icon }, idx) => {
                  const isActive = activeTab === id;
                  const hasBadge =
                    (id === "shelf" && (shelfFiles.length > 0 || wifiStatus.running)) ||
                    (id === "timer" && (isTimerRunning || isTimerFinished));
                  return (
                    <button
                      key={id}
                      onClick={() => setActiveTab(id)}
                      title={`${label} (Key ${idx + 1})`}
                      className={`relative h-6 flex items-center justify-center gap-1.5 rounded-md text-[10px] transition-all ${tokens.focusRing} active:scale-[0.96] ${
                        isActive
                          ? isLight
                            ? "px-2.5 bg-white text-zinc-950 shadow-sm font-semibold"
                            : "px-2.5 bg-zinc-800 text-white font-semibold"
                          : isLight
                            ? "w-7 text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200"
                            : "w-7 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                      {isActive && <span className="whitespace-nowrap">{label}</span>}
                      {!isActive && hasBadge && (
                        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent" />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleToggleBarStyle}
                  className={`h-7 w-7 flex items-center justify-center rounded-lg border transition-all ${tokens.focusRing} ${
                    isLight
                      ? "bg-zinc-200/80 border-zinc-300 text-zinc-800 hover:bg-zinc-300 active:scale-[0.95]"
                      : "bg-[#141418] border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 active:scale-[0.95]"
                  }`}
                  title={
                    barStyle === "notch"
                      ? "Idle Style: Top Notch (Click for Floating Island)"
                      : "Idle Style: Floating Island (Click for Top Notch)"
                  }
                >
                  {barStyle === "notch" ? (
                    <RectangleHorizontal className="w-3.5 h-3.5" />
                  ) : (
                    <PanelTop className="w-3.5 h-3.5 text-accent" />
                  )}
                </button>

                <button
                  onClick={onToggleTheme}
                  className={`h-7 w-7 flex items-center justify-center rounded-lg border transition-all ${tokens.focusRing} ${
                    isLight
                      ? "bg-zinc-200/80 border-zinc-300 text-zinc-800 hover:bg-zinc-300 active:scale-[0.95]"
                      : "bg-[#141418] border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 active:scale-[0.95]"
                  }`}
                  title={isLight ? "Switch to Dark Mode" : "Switch to Light Mode"}
                >
                  {isLight ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
                </button>

                <div
                  className={`h-7 px-2 flex items-center gap-1 rounded-lg border cursor-grab active:cursor-grabbing transition-colors ${
                    isLight
                      ? "bg-zinc-200/80 border-zinc-300 text-zinc-700 hover:bg-zinc-300"
                      : "bg-[#141418] border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800"
                  }`}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    onStartDrag();
                  }}
                  title="Drag to move Dynamic Island"
                >
                  <GripHorizontal className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-medium">Drag</span>
                </div>
              </div>
            </div>

            {/* Active Tab View */}
            <div key={activeTab} className="min-h-0 h-full overflow-hidden island-content-enter">
              {activeTab === "music" && (
                <MusicTab
                  tokens={tokens}
                  media={media}
                  isLyricsOpen={isLyricsOpen}
                  visualizerStyle={visualizerStyle}
                  volume={volume}
                  onSetVisualizer={handleSetVisualizer}
                  onTogglePlayPause={onTogglePlayPause}
                  onPrev={onPrev}
                  onNext={onNext}
                  onSeek={onSeek}
                  onToggleLyricsWindow={onToggleLyricsWindow}
                  onSetVolume={handleSetVolume}
                  onToggleMute={handleToggleMute}
                />
              )}
              {activeTab === "clock" && <ClockTab tokens={tokens} currentTime={currentTime} />}
              {activeTab === "timer" && (
                <TimerTab
                  tokens={tokens}
                  timerDuration={timerDuration}
                  timerRemaining={timerRemaining}
                  isTimerRunning={isTimerRunning}
                  isTimerFinished={isTimerFinished}
                  onStartPause={handleStartPauseTimer}
                  onReset={handleResetTimer}
                  onSetPreset={handleSetPresetTimer}
                  onAdjust={handleAdjustTimer}
                />
              )}
              {activeTab === "stopwatch" && (
                <StopwatchTab
                  tokens={tokens}
                  stopwatchTimeMs={stopwatchTimeMs}
                  isStopwatchRunning={isStopwatchRunning}
                  stopwatchLaps={stopwatchLaps}
                  onToggle={handleToggleStopwatch}
                  onLap={handleLapStopwatch}
                  onReset={handleResetStopwatch}
                />
              )}
              {activeTab === "weather" && (
                <WeatherTab
                  tokens={tokens}
                  weather={weather}
                  savedCity={savedWeatherCity}
                  loading={weatherLoading}
                  error={weatherError}
                  onRefresh={() => loadWeather()}
                  onSearchCity={handleSearchWeatherCity}
                />
              )}
              {activeTab === "notes" && (
                <NotesTab
                  tokens={tokens}
                  notesMode={notesMode}
                  onSetNotesMode={setNotesMode}
                  notesText={notesText}
                  onNotesChange={handleNotesChange}
                  clipboardHistory={clipboardHistory}
                  winClipboardSynced={winClipboardSynced}
                  onCopyClipItem={handleCopyClipItem}
                  onDeleteClipItem={handleDeleteClipItem}
                  onClearClipboard={handleClearClipboard}
                />
              )}
              {activeTab === "shelf" && (
                <ShelfTab
                  tokens={tokens}
                  files={shelfFiles}
                  activeDownload={activeDownload}
                  isDragOver={isDragOver}
                  shelfMode={shelfMode}
                  onSetShelfMode={setShelfMode}
                  wifiStatus={wifiStatus}
                  wifiBusy={wifiBusy}
                  wifiError={wifiError}
                  onStartWifi={handleStartWifiShelf}
                  onStopWifi={handleStopWifiShelf}
                  onOpenWifiDir={handleOpenWifiSaveDir}
                  onOpenFile={handleOpenShelfFile}
                  onRevealFile={handleRevealShelfFile}
                  onDragOutFile={handleDragOutShelfFile}
                  onRemoveFile={handleRemoveShelfFile}
                  onClearShelf={handleClearShelf}
                />
              )}
              {activeTab === "system" && (
                <SystemTab
                  tokens={tokens}
                  sysStats={sysStats}
                  cpuHistory={cpuHistory}
                  battery={battery}
                  audioDevices={audioDevices}
                  volume={volume}
                  autoHideFullscreen={autoHideFullscreen}
                  autostartEnabled={autostartEnabled}
                  autostartBusy={autostartBusy}
                  onSwitchAudioDevice={handleSwitchAudioDevice}
                  onSetVolume={handleSetVolume}
                  onToggleMute={handleToggleMute}
                  onToggleAutoHideFullscreen={handleToggleAutoHideFullscreen}
                  onToggleAutostart={handleToggleAutostart}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          position={contextMenu}
          tokens={tokens}
          isLyricsOpen={isLyricsOpen}
          barStyle={barStyle}
          dockEdge={dockEdge}
          onCloseMenu={() => setContextMenu(null)}
          onRefresh={handleRefreshIsland}
          onDockToEdge={handleDockToEdge}
          onToggleBarStyle={handleToggleBarStyle}
          onToggleLyrics={onToggleLyricsWindow}
          onToggleTheme={onToggleTheme}
          onQuit={handleQuitApp}
        />
      )}
    </div>
  );
};
