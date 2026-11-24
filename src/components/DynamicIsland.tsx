import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Clock,
  CloudSun,
  Cpu,
  GripHorizontal,
  Hourglass,
  Inbox,
  Moon,
  Music,
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
} from "../types/system";
import {
  formatAmPmTime,
  formatBytes,
  formatSpeed,
  getIslandThemeTokens,
  playSoftChime,
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
  const [isMoving, setIsMoving] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const hoverTimeoutRef = useRef<number | null>(null);
  const hoverEnterTimeoutRef = useRef<number | null>(null);
  const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
  const isLight = theme === "light";
  const tokens = useMemo(() => getIslandThemeTokens(isLight), [isLight]);

  // 1. Dock Edge & Drag Motion Sync
  useEffect(() => {
    if (!isTauri) return;
    let unlistenEdge: (() => void) | undefined;
    let unlistenMove: (() => void) | undefined;

    import("@tauri-apps/api/event").then(async ({ listen }) => {
      unlistenEdge = await listen<string>("island-dock-changed", (e) => {
        if (
          e.payload === "top" ||
          e.payload === "left" ||
          e.payload === "right" ||
          e.payload === "floating"
        ) {
          setDockEdge(e.payload);
        }
      });
      unlistenMove = await listen<boolean>("island-moving", (e) => {
        setIsMoving(e.payload);
      });
    });

    return () => {
      if (unlistenEdge) unlistenEdge();
      if (unlistenMove) unlistenMove();
    };
  }, [isTauri]);

  // 2. Real WASAPI Audio Spectrum & Visualizer Preference
  const [spectrum, setSpectrum] = useState<number[]>([0, 0, 0, 0, 0, 0, 0, 0]);
  const [visualizerStyle, setVisualizerStyle] = useState<VisualizerStyle>(() => {
    const saved = localStorage.getItem("ms-island-visualizer");
    return saved === "wave" || saved === "dots" || saved === "bars" ? saved : "bars";
  });

  const handleSetVisualizer = useCallback((style: VisualizerStyle) => {
    setVisualizerStyle(style);
    localStorage.setItem("ms-island-visualizer", style);
  }, []);

  useEffect(() => {
    if (!isTauri || !media.isPlaying) {
      setSpectrum([0, 0, 0, 0, 0, 0, 0, 0]);
      return;
    }
    let mounted = true;
    const id = setInterval(async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const bands = await invoke<number[]>("get_audio_spectrum");
        if (mounted && Array.isArray(bands) && bands.length === 8) {
          setSpectrum(bands);
        }
      } catch {}
    }, 80);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [isTauri, media.isPlaying]);

  // 3. Real-Time Clock
  const [currentTime, setCurrentTime] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

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
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<IslandToast>("island-toast", (e) => {
        showToast(e.payload.kind, e.payload.message, 2200);
      }).then((fn) => {
        unlisten = fn;
      });
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [isTauri, showToast]);

  // 5. Volume, Scroll Wheel HUD & Audio Output Switcher
  const [volume, setVolume] = useState<VolumeInfo>({ level: 50, muted: false });
  const [showVolumeHud, setShowVolumeHud] = useState(false);
  const volumeHudTimeoutRef = useRef<number | null>(null);
  const lastWheelTimeRef = useRef(0);
  const [audioDevices, setAudioDevices] = useState<AudioDeviceInfo[]>([]);

  const loadAudioDevices = useCallback(async () => {
    if (!isTauri) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const list = await invoke<AudioDeviceInfo[]>("get_audio_devices");
      setAudioDevices(list);
    } catch {}
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri) return;
    let mounted = true;
    const fetchVol = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const v = await invoke<VolumeInfo>("get_volume");
        if (mounted) setVolume(v);
      } catch {}
    };
    fetchVol();
    loadAudioDevices();
    const id = setInterval(fetchVol, 4000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [isTauri, loadAudioDevices]);

  useEffect(() => {
    if (activeTab === "system" && isHovered) loadAudioDevices();
  }, [activeTab, isHovered, loadAudioDevices]);

  const handleSwitchAudioDevice = useCallback(
    async (device: AudioDeviceInfo) => {
      if (!isTauri) return;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("switch_audio_device", { deviceId: device.id });
        await loadAudioDevices();
        showToast("audio", `Output: ${device.name}`, 2000);
      } catch {}
    },
    [isTauri, loadAudioDevices, showToast]
  );

  const handleSetVolume = useCallback(
    async (newLevel: number) => {
      const clamped = Math.max(0, Math.min(100, Math.round(newLevel)));
      setVolume((prev) => ({ level: clamped, muted: clamped === 0 ? prev.muted : false }));
      if (isTauri) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
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
        const { invoke } = await import("@tauri-apps/api/core");
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
        const { invoke } = await import("@tauri-apps/api/core");
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

  // 6. Countdown Timer
  const [timerDuration, setTimerDuration] = useState(300);
  const [timerRemaining, setTimerRemaining] = useState(300);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [isTimerFinished, setIsTimerFinished] = useState(false);

  useEffect(() => {
    if (!isTimerRunning || timerRemaining <= 0) return;
    const id = window.setInterval(() => {
      setTimerRemaining((prev) => {
        if (prev <= 1) {
          setIsTimerRunning(false);
          setIsTimerFinished(true);
          playSoftChime();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [isTimerRunning, timerRemaining]);

  const handleStartPauseTimer = useCallback(() => {
    setTimerRemaining((rem) => {
      if (rem === 0) {
        setIsTimerFinished(false);
        return timerDuration;
      }
      return rem;
    });
    setIsTimerRunning((r) => !r);
  }, [timerDuration]);

  const handleResetTimer = useCallback(() => {
    setIsTimerRunning(false);
    setIsTimerFinished(false);
    setTimerRemaining(timerDuration);
  }, [timerDuration]);

  const handleSetPresetTimer = useCallback((seconds: number, autoStart = false) => {
    setIsTimerRunning(autoStart);
    setIsTimerFinished(false);
    setTimerDuration(seconds);
    setTimerRemaining(seconds);
  }, []);

  const handleAdjustTimer = useCallback(
    (diff: number) => {
      setTimerRemaining((prev) => {
        const next = Math.max(10, prev + diff);
        if (!isTimerRunning) setTimerDuration(next);
        return next;
      });
      setIsTimerFinished(false);
    },
    [isTimerRunning]
  );

  // 7. Millisecond Stopwatch
  const [stopwatchTimeMs, setStopwatchTimeMs] = useState(0);
  const [isStopwatchRunning, setIsStopwatchRunning] = useState(false);
  const [stopwatchLaps, setStopwatchLaps] = useState<number[]>([]);
  const stopwatchStartRef = useRef(0);
  const stopwatchAccRef = useRef(0);

  useEffect(() => {
    if (!isStopwatchRunning) return;
    let animFrame: number;
    stopwatchStartRef.current = performance.now();
    const update = () => {
      setStopwatchTimeMs(stopwatchAccRef.current + (performance.now() - stopwatchStartRef.current));
      animFrame = requestAnimationFrame(update);
    };
    animFrame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animFrame);
  }, [isStopwatchRunning]);

  const handleToggleStopwatch = useCallback(() => {
    setIsStopwatchRunning((running) => {
      if (running) {
        stopwatchAccRef.current += performance.now() - stopwatchStartRef.current;
        return false;
      }
      stopwatchStartRef.current = performance.now();
      return true;
    });
  }, []);

  const handleResetStopwatch = useCallback(() => {
    setIsStopwatchRunning(false);
    stopwatchAccRef.current = 0;
    setStopwatchTimeMs(0);
    setStopwatchLaps([]);
  }, []);

  const handleLapStopwatch = useCallback(() => {
    if (isStopwatchRunning) setStopwatchLaps((prev) => [stopwatchTimeMs, ...prev]);
  }, [isStopwatchRunning, stopwatchTimeMs]);

  // 8. Weather
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [savedWeatherCity, setSavedWeatherCity] = useState(
    () => localStorage.getItem("ms-island-weather-city") || ""
  );
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState("");

  const loadWeather = useCallback(
    async (cityOverride?: string) => {
      if (!isTauri) return;
      setWeatherLoading(true);
      setWeatherError("");
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const targetCity = cityOverride !== undefined ? cityOverride : savedWeatherCity;
        const data = await invoke<WeatherInfo>("get_weather", {
          city: targetCity.trim() ? targetCity.trim() : null,
        });
        setWeather(data);
      } catch (e: any) {
        setWeatherError(typeof e === "string" ? e : "Could not reach weather service");
      } finally {
        setWeatherLoading(false);
      }
    },
    [isTauri, savedWeatherCity]
  );

  useEffect(() => {
    if (!isTauri) return;
    loadWeather();
    const id = setInterval(() => loadWeather(), 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [isTauri, loadWeather]);

  const handleSearchWeatherCity = useCallback(
    (nextCity: string) => {
      setSavedWeatherCity(nextCity);
      localStorage.setItem("ms-island-weather-city", nextCity);
      loadWeather(nextCity);
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
      const { invoke } = await import("@tauri-apps/api/core");
      const payload = await invoke<ClipboardSyncPayload>("get_clipboard_history");
      setClipboardHistory(payload.items || []);
      setWinClipboardSynced(Boolean(payload.windowsHistoryEnabled));
    } catch {}
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    loadClipboardHistory();
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<ClipboardSyncPayload>("clipboard-updated", (e) => {
        setClipboardHistory(e.payload.items || []);
        setWinClipboardSynced(Boolean(e.payload.windowsHistoryEnabled));
      }).then((fn) => {
        unlisten = fn;
      });
    });
    return () => {
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
          const { invoke } = await import("@tauri-apps/api/core");
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
        const { invoke } = await import("@tauri-apps/api/core");
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
      const { invoke } = await import("@tauri-apps/api/core");
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
  const isDraggingOutRef = useRef(false);

  useEffect(() => {
    localStorage.setItem("ms-island-shelf", JSON.stringify(shelfFiles));
  }, [shelfFiles]);

  useEffect(() => {
    if (!isTauri) return;
    let unlistenDrag: (() => void) | undefined;
    let unlistenDrop: (() => void) | undefined;
    let unlistenDlProgress: (() => void) | undefined;
    let unlistenDlDone: (() => void) | undefined;
    let unlistenHotkey: (() => void) | undefined;

    import("@tauri-apps/api/event").then(async ({ listen }) => {
      unlistenDrag = await listen<boolean>("shelf-drag-state", (e) => setIsDragOver(e.payload));
      unlistenDrop = await listen<ShelfFileInfo[]>("shelf-files-dropped", (e) => {
        setIsDragOver(false);
        setShelfFiles((prev) => {
          const existing = new Set(prev.map((f) => f.path));
          return [...e.payload.filter((f) => !existing.has(f.path)), ...prev].slice(0, 12);
        });
        setActiveTab("shelf");
        setIsHovered(true);
      });
      unlistenDlProgress = await listen<ActiveDownloadInfo | null>("downloads-updated", (e) => {
        setActiveDownload(e.payload);
      });
      unlistenDlDone = await listen<ShelfFileInfo>("download-completed", (e) => {
        const downloadedItem: ShelfFileInfo = { ...e.payload, fromDownload: true };
        setShelfFiles((prev) => {
          const filtered = prev.filter((f) => f.path !== downloadedItem.path);
          return [downloadedItem, ...filtered].slice(0, 12);
        });
      });
      unlistenHotkey = await listen("island-hotkey-toggle", () => {
        setContextMenu(null);
        setIsHovered((prev) => {
          if (prev) setActiveTab("music");
          return !prev;
        });
      });
    });

    return () => {
      if (unlistenDrag) unlistenDrag();
      if (unlistenDrop) unlistenDrop();
      if (unlistenDlProgress) unlistenDlProgress();
      if (unlistenDlDone) unlistenDlDone();
      if (unlistenHotkey) unlistenHotkey();
    };
  }, [isTauri]);

  const handleOpenShelfFile = useCallback(
    async (path: string) => {
      if (!isTauri) return;
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_shelf_file", { path });
    },
    [isTauri]
  );

  const handleRevealShelfFile = useCallback(
    async (path: string) => {
      if (!isTauri) return;
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("reveal_shelf_file", { path });
    },
    [isTauri]
  );

  const handleDragOutShelfFile = useCallback(
    async (path: string) => {
      if (!isTauri || isDraggingOutRef.current) return;
      isDraggingOutRef.current = true;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("start_file_drag_out", { path });
      } catch (e) {
        console.error("OLE drag-out failed:", e);
      } finally {
        isDraggingOutRef.current = false;
      }
    },
    [isTauri]
  );

  const handleRemoveShelfFile = useCallback((path: string) => {
    setShelfFiles((prev) => prev.filter((f) => f.path !== path));
  }, []);

  const handleClearShelf = useCallback(() => setShelfFiles([]), []);

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
  const [autoHideFullscreen, setAutoHideFullscreen] = useState(true);

  useEffect(() => {
    if (!isTauri) return;
    let mounted = true;
    import("@tauri-apps/api/core").then(async ({ invoke }) => {
      try {
        const [autoStart, autoHide, bat] = await Promise.all([
          invoke<boolean>("get_autostart"),
          invoke<boolean>("get_auto_hide_fullscreen"),
          invoke<BatteryInfo>("get_battery_info"),
        ]);
        if (mounted) {
          setAutostartEnabled(autoStart);
          setAutoHideFullscreen(autoHide);
          setBattery(bat);
        }
      } catch {}
    });
    return () => {
      mounted = false;
    };
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri || !isHovered || activeTab !== "system") return;
    let mounted = true;
    const pollStats = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
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
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<boolean>("set_autostart", { enabled: !autostartEnabled });
      setAutostartEnabled(result);
    } catch {
    } finally {
      setAutostartBusy(false);
    }
  }, [isTauri, autostartBusy, autostartEnabled]);

  const handleToggleAutoHideFullscreen = useCallback(async () => {
    if (!isTauri) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<boolean>("set_auto_hide_fullscreen", {
        enabled: !autoHideFullscreen,
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
    const x = Math.max(8, Math.min(window.innerWidth - 194, e.clientX));
    const y = Math.max(8, Math.min(window.innerHeight - 156, e.clientY + 6));
    setContextMenu({ x, y });
  };

  const handleRefreshIsland = useCallback(async () => {
    setContextMenu(null);
    setDockEdge("top");
    setIsHovered(false);
    setActiveTab("music");
    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
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
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("quit_app");
    }
  }, [isTauri]);

  // 13. Strict Physical Pill Hover Handlers
  const handleMouseEnter = () => {
    if (contextMenu) return;
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    if (!isHovered && !hoverEnterTimeoutRef.current) {
      hoverEnterTimeoutRef.current = window.setTimeout(() => {
        hoverEnterTimeoutRef.current = null;
        setIsHovered(true);
      }, 110);
    }
  };

  const handleMouseLeave = () => {
    if (contextMenu || isDraggingOutRef.current) return;
    if (hoverEnterTimeoutRef.current) {
      clearTimeout(hoverEnterTimeoutRef.current);
      hoverEnterTimeoutRef.current = null;
    }
    hoverTimeoutRef.current = window.setTimeout(() => {
      if (isDraggingOutRef.current) return;
      setIsHovered(false);
      setActiveTab("music");
    }, 260);
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
      return Math.min(488, Math.max(288, Math.round(212 + titleLen * 6.8)));
    }
    if (weather) {
      const weatherText = `${weather.temperature}°C ${weather.city} · ${weather.condition}`;
      return Math.min(365, Math.max(275, Math.round(188 + weatherText.length * 5.6)));
    }
    return 258;
  })();

  const outerAlignCls =
    dockEdge === "left"
      ? "justify-start pt-2"
      : dockEdge === "right"
        ? "justify-end pt-2"
        : dockEdge === "floating"
          ? "justify-center pt-2"
          : "justify-center pt-0";

  const shellShapeCls = (() => {
    if (isHovered) {
      if (dockEdge === "top") return "h-[256px] rounded-t-none rounded-b-[22px] border-t-0 p-3.5";
      if (dockEdge === "left") return "h-[256px] rounded-l-none rounded-r-[22px] border-l-0 p-3.5";
      if (dockEdge === "right") return "h-[256px] rounded-r-none rounded-l-[22px] border-r-0 p-3.5";
      return "h-[256px] rounded-[22px] p-3.5";
    }
    if (dockEdge === "top") return "h-[36px] rounded-t-none rounded-b-[16px] border-t-0 px-3.5 py-1.5 cursor-pointer";
    if (dockEdge === "left") return "h-[36px] rounded-l-none rounded-r-[18px] border-l-0 px-3.5 py-1.5 cursor-pointer";
    if (dockEdge === "right") return "h-[36px] rounded-r-none rounded-l-[18px] border-r-0 px-3.5 py-1.5 cursor-pointer";
    return "h-[38px] rounded-full px-4 py-1.5 cursor-pointer";
  })();

  return (
    <div className={`relative w-full h-full flex items-start transition-all duration-300 ${outerAlignCls}`}>
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheelVolume}
        onContextMenu={handleContextMenu}
        style={{ width: `${isHovered ? 516 : idleWidthPx}px` }}
        className={`island-shell-spring overflow-hidden border ${tokens.shellSurface} ${shellShapeCls} ${
          isMoving ? "scale-[1.016] shadow-2xl shadow-black/90" : "scale-100"
        } ${isDragOver ? "border-[#f97316] ring-1 ring-[#f97316]" : ""}`}
      >
        {!isHovered ? (
          <IdleBar
            tokens={tokens}
            idleClockAmPm={idleClockAmPm}
            currentTime={currentTime}
            media={media}
            visualizerStyle={visualizerStyle}
            spectrum={spectrum}
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
            onToggleLyricsWindow={onToggleLyricsWindow}
            onStartDrag={onStartDrag}
          />
        ) : (
          <div className="w-full h-full grid grid-rows-[auto_1fr] gap-2.5 select-none island-content-enter">
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
                    (id === "shelf" && shelfFiles.length > 0) ||
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
                        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[#f97316]" />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-1.5">
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
                  spectrum={spectrum}
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
          onCloseMenu={() => setContextMenu(null)}
          onRefresh={handleRefreshIsland}
          onToggleLyrics={onToggleLyricsWindow}
          onToggleTheme={onToggleTheme}
          onQuit={handleQuitApp}
        />
      )}
    </div>
  );
};
