import React, { useState, useEffect, useRef } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  RotateCw,
  Music,
  FileText,
  Clock,
  Timer as TimerIcon,
  Hourglass,
  ChevronLeft,
  ChevronRight,
  Flag,
  GripHorizontal,
  Sun,
  Moon,
  Volume2,
  Volume1,
  VolumeX,
  CloudSun,
  Cloud,
  CloudRain,
  CloudLightning,
  CloudFog,
  Snowflake,
  RefreshCw,
  Search,
  StickyNote,
  Copy,
  Check,
  Trash2,
  Cpu,
  Power,
  Droplets,
  Wind,
  Thermometer,
  ArrowUpDown,
  Inbox,
  FolderOpen,
  ExternalLink,
  Battery,
  BatteryCharging,
  Monitor,
  Clipboard,
  Speaker,
  X
} from "lucide-react";
import { MediaTrack } from "../types/media";
import { ThemeMode } from "../types/theme";
import {
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
import { AudioVisualizer } from "./AudioVisualizer";
import { ScrubBar } from "./ScrubBar";

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

/** Plays a soft two-tone harmonic chime via Web Audio API when timer completes */
function playSoftChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    [523.25, 659.25, 783.99].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + idx * 0.14);
      gain.gain.setValueAtTime(0.0001, now + idx * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.12, now + idx * 0.14 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.14 + 0.55);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.14);
      osc.stop(now + idx * 0.14 + 0.6);
    });
  } catch {
    // Audio playback blocked or unavailable
  }
}

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

  // Listen for live dock edge morphing & drag motion state from Rust
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

  // -------------------------------------------------------------
  // 1. Real WASAPI Audio Spectrum & Visualizer Preference
  // -------------------------------------------------------------
  const [spectrum, setSpectrum] = useState<number[]>([0, 0, 0, 0, 0, 0, 0, 0]);
  const [visualizerStyle, setVisualizerStyle] = useState<VisualizerStyle>(() => {
    const saved = localStorage.getItem("ms-island-visualizer");
    return saved === "wave" || saved === "dots" || saved === "bars" ? saved : "bars";
  });

  const handleSetVisualizer = (style: VisualizerStyle) => {
    setVisualizerStyle(style);
    localStorage.setItem("ms-island-visualizer", style);
  };

  useEffect(() => {
    if (!isTauri) return;
    if (!media.isPlaying) {
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
      } catch {
        // Ignore transient poll errors
      }
    }, 80);

    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [isTauri, media.isPlaying]);

  // -------------------------------------------------------------
  // 2. Real-Time Clock & Calendar State
  // -------------------------------------------------------------
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [calendarMonthOffset, setCalendarMonthOffset] = useState<number>(0);

  useEffect(() => {
    const clockInterval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(clockInterval);
  }, []);

  // -------------------------------------------------------------
  // 3. Transient Dynamic Toast Pills (CapsLock, Charger, Device)
  // -------------------------------------------------------------
  const [toast, setToast] = useState<IslandToast | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const showToast = (kind: string, message: string, durationMs = 2000) => {
    setToast({ kind, message });
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
    }, durationMs);
  };

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
  }, [isTauri]);

  // -------------------------------------------------------------
  // 4. Master Volume, Scroll Wheel HUD & Audio Output Switcher
  // -------------------------------------------------------------
  const [volume, setVolume] = useState<VolumeInfo>({ level: 50, muted: false });
  const [showVolumeHud, setShowVolumeHud] = useState<boolean>(false);
  const volumeHudTimeoutRef = useRef<number | null>(null);
  const lastWheelTimeRef = useRef<number>(0);
  const [audioDevices, setAudioDevices] = useState<AudioDeviceInfo[]>([]);

  const loadAudioDevices = async () => {
    if (!isTauri) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const list = await invoke<AudioDeviceInfo[]>("get_audio_devices");
      setAudioDevices(list);
    } catch (e) {
      console.error("Failed to list audio devices:", e);
    }
  };

  useEffect(() => {
    if (!isTauri) return;
    let mounted = true;
    const fetchVol = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const v = await invoke<VolumeInfo>("get_volume");
        if (mounted) setVolume(v);
      } catch (e) {
        console.error("Failed to fetch volume:", e);
      }
    };
    fetchVol();
    loadAudioDevices();
    const id = setInterval(fetchVol, 4000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [isTauri]);

  useEffect(() => {
    if (activeTab === "system" && isHovered) {
      loadAudioDevices();
    }
  }, [activeTab, isHovered]);

  const handleSwitchAudioDevice = async (device: AudioDeviceInfo) => {
    if (!isTauri) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("switch_audio_device", { deviceId: device.id });
      await loadAudioDevices();
      showToast("audio", `Output: ${device.name}`, 2000);
    } catch (e) {
      console.error("Failed to switch audio device:", e);
    }
  };

  const triggerVolumeHud = () => {
    setShowVolumeHud(true);
    if (volumeHudTimeoutRef.current) clearTimeout(volumeHudTimeoutRef.current);
    volumeHudTimeoutRef.current = window.setTimeout(() => {
      setShowVolumeHud(false);
    }, 1700);
  };

  const handleSetVolume = async (newLevel: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(newLevel)));
    setVolume((prev) => ({ level: clamped, muted: clamped === 0 ? prev.muted : false }));
    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const updated = await invoke<VolumeInfo>("set_volume", { level: clamped });
        setVolume(updated);
      } catch (e) {
        console.error("Failed to set volume:", e);
      }
    }
  };

  const handleToggleMute = async () => {
    setVolume((prev) => ({ ...prev, muted: !prev.muted }));
    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const updated = await invoke<VolumeInfo>("toggle_mute");
        setVolume(updated);
      } catch (e) {
        console.error("Failed to toggle mute:", e);
      }
    }
  };

  const handleWheelVolume = async (e: React.WheelEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "TEXTAREA" || target.closest(".scrollable-area"))) {
      return;
    }

    const now = performance.now();
    if (now - lastWheelTimeRef.current < 45) return;
    lastWheelTimeRef.current = now;

    const delta = e.deltaY < 0 ? 5 : -5;
    triggerVolumeHud();

    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const updated = await invoke<VolumeInfo>("adjust_volume", { delta });
        setVolume(updated);
      } catch (err) {
        console.error("Failed to adjust volume:", err);
      }
    } else {
      setVolume((prev) => ({
        level: Math.max(0, Math.min(100, prev.level + delta)),
        muted: false,
      }));
    }
  };

  // -------------------------------------------------------------
  // 5. Countdown Timer + Soft Synthesized Chime
  // -------------------------------------------------------------
  const [timerDuration, setTimerDuration] = useState<number>(300);
  const [timerRemaining, setTimerRemaining] = useState<number>(300);
  const [isTimerRunning, setIsTimerRunning] = useState<boolean>(false);
  const [isTimerFinished, setIsTimerFinished] = useState<boolean>(false);

  useEffect(() => {
    let timerId: number | null = null;
    if (isTimerRunning && timerRemaining > 0) {
      timerId = window.setInterval(() => {
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
    }
    return () => {
      if (timerId) clearInterval(timerId);
    };
  }, [isTimerRunning, timerRemaining]);

  const handleStartPauseTimer = () => {
    if (timerRemaining === 0) {
      setTimerRemaining(timerDuration);
      setIsTimerFinished(false);
    }
    setIsTimerRunning(!isTimerRunning);
  };

  const handleResetTimer = () => {
    setIsTimerRunning(false);
    setIsTimerFinished(false);
    setTimerRemaining(timerDuration);
  };

  const handleSetPresetTimer = (seconds: number) => {
    setIsTimerRunning(false);
    setIsTimerFinished(false);
    setTimerDuration(seconds);
    setTimerRemaining(seconds);
  };

  const handleAdjustTimer = (diff: number) => {
    const newRemaining = Math.max(10, timerRemaining + diff);
    setTimerRemaining(newRemaining);
    setIsTimerFinished(false);
    if (!isTimerRunning) {
      setTimerDuration(newRemaining);
    }
  };

  // -------------------------------------------------------------
  // 6. Millisecond Stopwatch State
  // -------------------------------------------------------------
  const [stopwatchTimeMs, setStopwatchTimeMs] = useState<number>(0);
  const [isStopwatchRunning, setIsStopwatchRunning] = useState<boolean>(false);
  const [stopwatchLaps, setStopwatchLaps] = useState<number[]>([]);
  const stopwatchStartTimeRef = useRef<number>(0);
  const stopwatchAccumulatedRef = useRef<number>(0);

  useEffect(() => {
    let animFrame: number;
    if (isStopwatchRunning) {
      stopwatchStartTimeRef.current = performance.now();
      const update = () => {
        const now = performance.now();
        const elapsed = stopwatchAccumulatedRef.current + (now - stopwatchStartTimeRef.current);
        setStopwatchTimeMs(elapsed);
        animFrame = requestAnimationFrame(update);
      };
      animFrame = requestAnimationFrame(update);
    }
    return () => cancelAnimationFrame(animFrame);
  }, [isStopwatchRunning]);

  const handleToggleStopwatch = () => {
    if (isStopwatchRunning) {
      stopwatchAccumulatedRef.current += performance.now() - stopwatchStartTimeRef.current;
      setIsStopwatchRunning(false);
    } else {
      stopwatchStartTimeRef.current = performance.now();
      setIsStopwatchRunning(true);
    }
  };

  const handleResetStopwatch = () => {
    setIsStopwatchRunning(false);
    stopwatchAccumulatedRef.current = 0;
    setStopwatchTimeMs(0);
    setStopwatchLaps([]);
  };

  const handleLapStopwatch = () => {
    if (isStopwatchRunning) {
      setStopwatchLaps((prev) => [stopwatchTimeMs, ...prev]);
    }
  };

  // -------------------------------------------------------------
  // 7. Weather & Temperature State
  // -------------------------------------------------------------
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [weatherCityInput, setWeatherCityInput] = useState<string>("");
  const [savedWeatherCity, setSavedWeatherCity] = useState<string>(
    () => localStorage.getItem("ms-island-weather-city") || ""
  );
  const [weatherLoading, setWeatherLoading] = useState<boolean>(false);
  const [weatherError, setWeatherError] = useState<string>("");

  const loadWeather = async (cityOverride?: string) => {
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
  };

  useEffect(() => {
    if (!isTauri) return;
    loadWeather();
    const id = setInterval(() => loadWeather(), 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [isTauri, savedWeatherCity]);

  const handleSearchWeatherCity = (e: React.FormEvent) => {
    e.preventDefault();
    const nextCity = weatherCityInput.trim();
    setSavedWeatherCity(nextCity);
    localStorage.setItem("ms-island-weather-city", nextCity);
    loadWeather(nextCity);
    setWeatherCityInput("");
  };

  // -------------------------------------------------------------
  // 8. Notes Scratchpad & Windows Win+V Clipboard Two-Way Sync
  // -------------------------------------------------------------
  const [notesMode, setNotesMode] = useState<"scratchpad" | "clipboard">("scratchpad");
  const [notesText, setNotesText] = useState<string>(() => localStorage.getItem("ms-island-notes") || "");
  const [notesCopied, setNotesCopied] = useState<boolean>(false);
  const [clipboardHistory, setClipboardHistory] = useState<ClipboardEntry[]>([]);
  const [winClipboardSynced, setWinClipboardSynced] = useState<boolean>(false);
  const [copiedClipId, setCopiedClipId] = useState<string | null>(null);

  const loadClipboardHistory = async () => {
    if (!isTauri) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const payload = await invoke<ClipboardSyncPayload>("get_clipboard_history");
      setClipboardHistory(payload.items || []);
      setWinClipboardSynced(Boolean(payload.windowsHistoryEnabled));
    } catch {}
  };

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
  }, [isTauri]);

  useEffect(() => {
    if (isHovered && activeTab === "notes" && notesMode === "clipboard") {
      loadClipboardHistory();
    }
  }, [isHovered, activeTab, notesMode]);

  const handleNotesChange = (val: string) => {
    setNotesText(val);
    localStorage.setItem("ms-island-notes", val);
  };

  const handleCopyNotes = () => {
    if (!notesText) return;
    navigator.clipboard.writeText(notesText);
    setNotesCopied(true);
    setTimeout(() => setNotesCopied(false), 1600);
  };

  const handleCopyClipItem = async (item: ClipboardEntry) => {
    setCopiedClipId(item.id);
    setTimeout(() => setCopiedClipId(null), 1400);
    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("copy_clipboard_item", { id: item.id, text: item.text });
      } catch {
        navigator.clipboard.writeText(item.text);
      }
    } else {
      navigator.clipboard.writeText(item.text);
    }
  };

  const handleDeleteClipItem = async (id: string) => {
    setClipboardHistory((prev) => prev.filter((item) => item.id !== id));
    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const updated = await invoke<ClipboardSyncPayload>("delete_clipboard_item", { id });
        setClipboardHistory(updated.items || []);
        setWinClipboardSynced(Boolean(updated.windowsHistoryEnabled));
      } catch {}
    }
  };

  const handleClearClipboard = async () => {
    setClipboardHistory([]);
    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const updated = await invoke<ClipboardSyncPayload>("clear_clipboard_history");
        setClipboardHistory(updated.items || []);
        setWinClipboardSynced(Boolean(updated.windowsHistoryEnabled));
      } catch {}
    }
  };

  // -------------------------------------------------------------
  // 9. File Drop Shelf (Native Tauri Drag & Drop)
  // -------------------------------------------------------------
  const [shelfFiles, setShelfFiles] = useState<ShelfFileInfo[]>(() => {
    try {
      const saved = localStorage.getItem("ms-island-shelf");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem("ms-island-shelf", JSON.stringify(shelfFiles));
  }, [shelfFiles]);

  useEffect(() => {
    if (!isTauri) return;
    let unlistenDrag: (() => void) | undefined;
    let unlistenDrop: (() => void) | undefined;

    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<boolean>("shelf-drag-state", (e) => {
        setIsDragOver(e.payload);
      }).then((fn) => {
        unlistenDrag = fn;
      });

      listen<ShelfFileInfo[]>("shelf-files-dropped", (e) => {
        setIsDragOver(false);
        setShelfFiles((prev) => {
          const existing = new Set(prev.map((f) => f.path));
          const uniqueNew = e.payload.filter((f) => !existing.has(f.path));
          return [...uniqueNew, ...prev].slice(0, 12);
        });
        setActiveTab("shelf");
        setIsHovered(true);
      }).then((fn) => {
        unlistenDrop = fn;
      });
    });

    return () => {
      if (unlistenDrag) unlistenDrag();
      if (unlistenDrop) unlistenDrop();
    };
  }, [isTauri]);

  const handleOpenShelfFile = async (path: string) => {
    if (!isTauri) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_shelf_file", { path });
  };

  const handleRevealShelfFile = async (path: string) => {
    if (!isTauri) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("reveal_shelf_file", { path });
  };

  const handleCopyShelfPath = (path: string) => {
    navigator.clipboard.writeText(path);
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 1500);
  };

  // -------------------------------------------------------------
  // 10. Hardware Monitor, Battery, Auto-Start & Fullscreen Auto-Hide
  // -------------------------------------------------------------
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
  const [cpuHistory, setCpuHistory] = useState<number[]>(Array(14).fill(6));
  const [autostartEnabled, setAutostartEnabled] = useState<boolean>(false);
  const [autostartBusy, setAutostartBusy] = useState<boolean>(false);
  const [autoHideFullscreen, setAutoHideFullscreen] = useState<boolean>(true);

  useEffect(() => {
    if (!isTauri) return;
    let mounted = true;

    const loadInitial = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
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
      } catch (e) {
        console.error("Failed to load system prefs:", e);
      }
    };

    loadInitial();
    return () => {
      mounted = false;
    };
  }, [isTauri]);

  // Poll CPU/RAM stats ONLY while the System tab is actively visible (0% overhead when idle!)
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

  const handleToggleAutostart = async () => {
    if (!isTauri || autostartBusy) return;
    setAutostartBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<boolean>("set_autostart", { enabled: !autostartEnabled });
      setAutostartEnabled(result);
    } catch (e) {
      console.error("Failed to toggle autostart:", e);
    } finally {
      setAutostartBusy(false);
    }
  };

  const handleToggleAutoHideFullscreen = async () => {
    if (!isTauri) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<boolean>("set_auto_hide_fullscreen", {
        enabled: !autoHideFullscreen,
      });
      setAutoHideFullscreen(result);
    } catch (e) {
      console.error("Failed to toggle auto-hide fullscreen:", e);
    }
  };

  // -------------------------------------------------------------
  // Keyboard Accessibility (1-8 tabs, Space play/pause, Esc collapse)
  // -------------------------------------------------------------
  useEffect(() => {
    if (!isHovered) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        if (e.key === "Escape") {
          (e.target as HTMLElement).blur();
        }
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
      if (num >= 1 && num <= TABS.length) {
        setActiveTab(TABS[num - 1].id);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isHovered, activeTab, onTogglePlayPause]);

  // -------------------------------------------------------------
  // Right-Click Context Menu Handlers (Refresh & Close)
  // -------------------------------------------------------------
  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (hoverEnterTimeoutRef.current) {
      clearTimeout(hoverEnterTimeoutRef.current);
      hoverEnterTimeoutRef.current = null;
    }
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    // Clamp menu inside 560x286 transparent window bounds so it never clips
    const menuW = 186;
    const menuH = 148;
    const x = Math.max(8, Math.min(window.innerWidth - menuW - 8, e.clientX));
    const y = Math.max(8, Math.min(window.innerHeight - menuH - 8, e.clientY + 6));
    setContextMenu({ x, y });
  };

  const handleRefreshIsland = async () => {
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
      } catch (e) {
        console.error("Failed to refresh island:", e);
      }
    }
  };

  const handleQuitApp = async () => {
    setContextMenu(null);
    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("quit_app");
      } catch (e) {
        console.error("Failed to quit app:", e);
      }
    }
  };

  // Close context menu on Escape
  useEffect(() => {
    if (!contextMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [contextMenu]);

  // -------------------------------------------------------------
  // Hover Handlers strictly bound to inner physical notch
  // -------------------------------------------------------------
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
    if (contextMenu) return;
    if (hoverEnterTimeoutRef.current) {
      clearTimeout(hoverEnterTimeoutRef.current);
      hoverEnterTimeoutRef.current = null;
    }
    hoverTimeoutRef.current = window.setTimeout(() => {
      setIsHovered(false);
      setActiveTab("music");
    }, 260);
  };

  // -------------------------------------------------------------
  // Formatting Helpers
  // -------------------------------------------------------------
  const formatAmPmTime = (date: Date, includeSeconds = false) => {
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    if (hours === 0) hours = 12;
    const hh = hours < 10 ? `0${hours}` : `${hours}`;
    const mm = minutes < 10 ? `0${minutes}` : `${minutes}`;
    if (includeSeconds) {
      const ss = seconds < 10 ? `0${seconds}` : `${seconds}`;
      return `${hh}:${mm}:${ss} ${ampm}`;
    }
    return `${hh}:${mm} ${ampm}`;
  };

  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  const formatStopwatch = (totalMs: number) => {
    const mins = Math.floor(totalMs / 60000);
    const secs = Math.floor((totalMs % 60000) / 1000);
    const centis = Math.floor((totalMs % 1000) / 10);
    return `${mins < 10 ? "0" : ""}${mins}:${secs < 10 ? "0" : ""}${secs}.${centis < 10 ? "0" : ""}${centis}`;
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "Folder";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const renderWeatherIcon = (icon: string, className = "w-4 h-4") => {
    switch (icon) {
      case "sun":
        return <Sun className={className} />;
      case "moon":
        return <Moon className={className} />;
      case "cloud-sun":
        return <CloudSun className={className} />;
      case "rain":
        return <CloudRain className={className} />;
      case "storm":
        return <CloudLightning className={className} />;
      case "fog":
        return <CloudFog className={className} />;
      case "snow":
        return <Snowflake className={className} />;
      default:
        return <Cloud className={className} />;
    }
  };

  const renderVolumeIcon = (className = "w-3.5 h-3.5") => {
    if (volume.muted || volume.level === 0) return <VolumeX className={className} />;
    if (volume.level < 50) return <Volume1 className={className} />;
    return <Volume2 className={className} />;
  };

  // Calendar calculations
  const displayCalendarDate = new Date(
    currentTime.getFullYear(),
    currentTime.getMonth() + calendarMonthOffset,
    1
  );
  const currentMonthName = displayCalendarDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const daysInMonth = new Date(
    displayCalendarDate.getFullYear(),
    displayCalendarDate.getMonth() + 1,
    0
  ).getDate();
  const firstDayWeekday = new Date(
    displayCalendarDate.getFullYear(),
    displayCalendarDate.getMonth(),
    1
  ).getDay();
  const isCurrentViewingMonth = calendarMonthOffset === 0;

  const idleClockAmPm = formatAmPmTime(currentTime, false);
  const fullClockAmPm = formatAmPmTime(currentTime, true);
  const wordCount = notesText.trim() ? notesText.trim().split(/\s+/).length : 0;

  // Crafted matte hardware palette tokens (WCAG AA compliant in both themes)
  const shellSurface = isLight
    ? "bg-[#f5f5f3] border-zinc-300 text-zinc-900 shadow-lg shadow-black/10"
    : "bg-[#0c0c0e] border-zinc-800 text-zinc-100 shadow-2xl shadow-black/80";

  const surfaceSubtle = isLight
    ? "bg-white border border-zinc-200/90 rounded-xl"
    : "bg-[#141418] border border-zinc-800/90 rounded-xl";

  const mutedText = isLight ? "text-zinc-600" : "text-zinc-400";

  const subtleBtnCls = isLight
    ? "bg-zinc-200/80 border-zinc-300 text-zinc-800 hover:bg-zinc-300 active:scale-[0.97]"
    : "bg-zinc-800/80 border-zinc-700/80 text-zinc-200 hover:bg-zinc-700 active:scale-[0.97]";

  const primaryBtnCls = isLight
    ? "bg-zinc-900 text-white hover:bg-zinc-800 active:scale-[0.97]"
    : "bg-zinc-100 text-zinc-950 hover:bg-white active:scale-[0.97]";

  const focusRing = "focus:outline-none focus-visible:ring-1 focus-visible:ring-[#f97316]";

  // Outer alignment ensures flush bezel contact on Top, Left, or Right edges
  const outerAlignCls =
    dockEdge === "left"
      ? "justify-start pt-2"
      : dockEdge === "right"
        ? "justify-end pt-2"
        : dockEdge === "floating"
          ? "justify-center pt-2"
          : "justify-center pt-0";

  // Adaptive dynamic idle width (breathes smoothly with exact active content!)
  const idleWidthPx = (() => {
    if (isDragOver) return 310;
    if (showVolumeHud) return 285;
    if (toast) {
      return Math.min(350, Math.max(255, Math.round(165 + toast.message.length * 6.5)));
    }
    if (isTimerRunning || isTimerFinished) return 275;
    if (isStopwatchRunning) return 282;
    if (media.isPlaying) {
      const titleLen = (media.title || "Playing Audio").length;
      // Short title (~5-12 chars) -> ~290-325px; medium -> ~360-420px; long -> up to 488px
      return Math.min(488, Math.max(288, Math.round(212 + titleLen * 6.8)));
    }
    if (weather) {
      const weatherText = `${weather.temperature}°C ${weather.city} · ${weather.condition}`;
      return Math.min(365, Math.max(275, Math.round(188 + weatherText.length * 5.6)));
    }
    // Pure compact idle (AM/PM time + short date + Lyrics button)
    return 258;
  })();

  // Fluid shape morphing: flush notch when docked to an edge -> full pill when detached
  const shellShapeCls = (() => {
    if (isHovered) {
      if (dockEdge === "top") return "h-[256px] rounded-t-none rounded-b-[22px] border-t-0 p-3.5";
      if (dockEdge === "left") return "h-[256px] rounded-l-none rounded-r-[22px] border-l-0 p-3.5";
      if (dockEdge === "right") return "h-[256px] rounded-r-none rounded-l-[22px] border-r-0 p-3.5";
      return "h-[256px] rounded-[22px] p-3.5";
    }
    // Idle Bar shapes (width controlled dynamically via inline style for fluid spring morphing)
    if (dockEdge === "top") {
      return "h-[36px] rounded-t-none rounded-b-[16px] border-t-0 px-3.5 py-1.5 cursor-pointer";
    }
    if (dockEdge === "left") {
      return "h-[36px] rounded-l-none rounded-r-[18px] border-l-0 px-3.5 py-1.5 cursor-pointer";
    }
    if (dockEdge === "right") {
      return "h-[36px] rounded-r-none rounded-l-[18px] border-r-0 px-3.5 py-1.5 cursor-pointer";
    }
    // Detached away from edges -> smooth floating pill!
    return "h-[38px] rounded-full px-4 py-1.5 cursor-pointer";
  })();

  const motionLiftCls = isMoving
    ? "scale-[1.016] shadow-2xl shadow-black/90"
    : "scale-100";

  return (
    <div className={`relative w-full h-full flex items-start transition-all duration-300 ${outerAlignCls}`}>
      {/*
        FLAT SEAMLESS DYNAMIC ISLAND SHELL
        - Adaptive dynamic width reacting to idle / weather / short title / long title
        - Flush edge-docked on Top / Left / Right; fluidly morphs into a floating pill when pulled away
        - Organic spring curve transition (island-shell-spring)
        - Right-click opens custom context menu (Refresh / Close)
      */}
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheelVolume}
        onContextMenu={handleContextMenu}
        style={{ width: `${isHovered ? 516 : idleWidthPx}px` }}
        className={`island-shell-spring overflow-hidden border ${shellSurface} ${shellShapeCls} ${motionLiftCls} ${
          isDragOver ? "border-[#f97316] ring-1 ring-[#f97316]" : ""
        }`}
      >
        {!isHovered ? (
          /* ========================================================= */
          /* IDLE BAR: 3-COL GRID (PURE AM/PM TIME, NO CLOCK/MODE ICON)*/
          /* ========================================================= */
          <div
            className="w-full h-full grid grid-cols-[auto_1fr_auto] items-center gap-2.5 select-none island-content-enter"
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              if ((e.target as HTMLElement).closest("button")) return;
              onStartDrag();
            }}
          >
            {/* Col 1: Pure 12-hour AM/PM clock (e.g. 02:00 PM) */}
            <span className="text-[11px] font-semibold tabular-nums tracking-tight whitespace-nowrap">
              {idleClockAmPm}
            </span>

            {/* Col 2: Context-Aware Live Slot */}
            <div
              className={`min-w-0 pl-2.5 border-l flex items-center gap-2 ${
                isLight ? "border-zinc-300" : "border-zinc-800"
              }`}
            >
              {isDragOver ? (
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#f97316]">
                  <Inbox className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">Drop files to save on Shelf</span>
                </div>
              ) : showVolumeHud ? (
                <div className="w-full grid grid-cols-[auto_1fr_auto] items-center gap-2">
                  {renderVolumeIcon(`w-3.5 h-3.5 ${mutedText}`)}
                  <div className={`h-1.5 rounded-full overflow-hidden ${isLight ? "bg-zinc-300" : "bg-zinc-800"}`}>
                    <div
                      className={`h-full rounded-full transition-all duration-75 ${
                        volume.muted ? "bg-zinc-500" : "bg-[#f97316]"
                      }`}
                      style={{ width: `${volume.muted ? 0 : volume.level}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono tabular-nums font-medium">
                    {volume.muted ? "Mute" : `${volume.level}%`}
                  </span>
                </div>
              ) : toast ? (
                <div className="flex items-center gap-1.5 text-[11px] font-medium truncate">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#f97316] flex-shrink-0" />
                  <span className="truncate">{toast.message}</span>
                </div>
              ) : isTimerRunning || isTimerFinished ? (
                <div className="flex items-center gap-1.5 min-w-0 truncate">
                  <Hourglass
                    className={`w-3.5 h-3.5 flex-shrink-0 ${
                      isTimerFinished ? "text-[#f97316]" : mutedText
                    }`}
                  />
                  <span
                    className={`text-[11px] font-mono tabular-nums font-medium truncate ${
                      isTimerFinished ? "text-[#f97316] font-semibold" : ""
                    }`}
                  >
                    {isTimerFinished ? "Timer Finished" : formatTime(timerRemaining)}
                  </span>
                </div>
              ) : isStopwatchRunning ? (
                <div className="flex items-center gap-1.5 min-w-0 truncate">
                  <TimerIcon className={`w-3.5 h-3.5 flex-shrink-0 ${mutedText}`} />
                  <span className="text-[11px] font-mono tabular-nums font-medium truncate">
                    {formatStopwatch(stopwatchTimeMs)}
                  </span>
                </div>
              ) : media.isPlaying ? (
                <div className="flex items-center gap-2 min-w-0 w-full">
                  <AudioVisualizer
                    isPlaying={media.isPlaying}
                    style={visualizerStyle}
                    isLight={isLight}
                    spectrum={spectrum}
                    compact
                  />
                  <span className="text-[11px] font-medium truncate">
                    {media.title || "Playing Audio"}
                  </span>
                </div>
              ) : weather ? (
                <div className="flex items-center gap-1.5 min-w-0 truncate text-[11px]">
                  {renderWeatherIcon(weather.icon, `w-3.5 h-3.5 flex-shrink-0 ${mutedText}`)}
                  <span className="font-semibold tabular-nums">{weather.temperature}°C</span>
                  <span className={`truncate text-[11px] ${mutedText}`}>
                    {weather.city} · {weather.condition}
                  </span>
                </div>
              ) : (
                <span className={`text-[11px] truncate ${mutedText}`}>
                  {currentTime.toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              )}
            </div>

            {/* Col 3: Clean Lyrics Button ONLY */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleLyricsWindow();
              }}
              className={`px-2 py-0.5 rounded-md text-[10px] font-medium flex items-center gap-1 transition-all border ${focusRing} ${
                isLyricsOpen
                  ? isLight
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "bg-zinc-100 text-zinc-950 border-zinc-100"
                  : subtleBtnCls
              }`}
              title="Toggle Full Lyrics Window"
            >
              <FileText className="w-3 h-3" />
              <span>Lyrics</span>
            </button>
          </div>
        ) : (
          /* ========================================================= */
          /* EXPANDED COMMAND CENTER (GRID + CROSSFADE CHOREOGRAPHY)   */
          /* ========================================================= */
          <div className="w-full h-full grid grid-rows-[auto_1fr] gap-2.5 select-none island-content-enter">
            {/* ROW 1: NAVIGATION BAR */}
            <div
              className={`grid grid-cols-[1fr_auto] items-center gap-2 pb-2 border-b ${
                isLight ? "border-zinc-200" : "border-zinc-800/90"
              }`}
            >
              {/* 8-Tab Expanding Pill Bar */}
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
                      className={`relative h-6 flex items-center justify-center gap-1.5 rounded-md text-[10px] transition-all ${focusRing} active:scale-[0.96] ${
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

              {/* Right Utility Controls: Theme Toggle & Drag Grip */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={onToggleTheme}
                  className={`h-7 w-7 flex items-center justify-center rounded-lg border transition-all ${focusRing} ${
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

            {/* ROW 2: CONTENT AREA */}
            <div key={activeTab} className="min-h-0 h-full overflow-hidden island-content-enter">
              {/* ===================================================== */}
              {/* TAB 1: MUSIC PLAYER (REAL ART + REAL WASAPI + SCRUB)  */}
              {/* ===================================================== */}
              {activeTab === "music" && (
                <div className="w-full h-full grid grid-rows-[1fr_auto_auto] gap-2">
                  {/* Top: Track Artwork & Details */}
                  <div className="grid grid-cols-[52px_1fr_auto] items-center gap-3.5">
                    <div
                      className={`w-[52px] h-[52px] rounded-xl overflow-hidden border flex items-center justify-center ${
                        isLight ? "bg-zinc-200 border-zinc-300" : "bg-[#16161b] border-zinc-800"
                      }`}
                    >
                      {media.thumbnail ? (
                        <img src={media.thumbnail} alt="Album cover" className="w-full h-full object-cover" />
                      ) : (
                        <Music className={`w-5 h-5 ${mutedText}`} />
                      )}
                    </div>

                    <div className="min-w-0">
                      <h4 className="text-[13px] font-semibold truncate leading-snug" title={media.title}>
                        {media.title || "No media playing"}
                      </h4>
                      <p className={`text-[11px] truncate mt-0.5 ${mutedText}`} title={media.artist}>
                        {media.title
                          ? media.artist || media.sourceApp || "Media Player"
                          : "Start playback in YouTube, Spotify, or browser"}
                      </p>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <AudioVisualizer
                        isPlaying={media.isPlaying}
                        style={visualizerStyle}
                        isLight={isLight}
                        spectrum={spectrum}
                      />
                      <button
                        onClick={onToggleLyricsWindow}
                        className={`h-7 px-2.5 rounded-lg text-[10px] font-medium flex items-center gap-1.5 transition-all border ${focusRing} ${
                          isLyricsOpen
                            ? isLight
                              ? "bg-zinc-900 text-white border-zinc-900"
                              : "bg-zinc-100 text-zinc-950 border-zinc-100"
                            : subtleBtnCls
                        }`}
                        title="Toggle Full Lyrics Window"
                      >
                        <FileText className="w-3 h-3" />
                        <span>{isLyricsOpen ? "Close" : "Lyrics"}</span>
                      </button>
                    </div>
                  </div>

                  {/* Middle: Custom Tactile Seekbar */}
                  <div className="flex flex-col gap-0.5">
                    <ScrubBar
                      value={media.positionSec}
                      max={media.durationSec}
                      onChange={onSeek}
                      isLight={isLight}
                      accent={media.isPlaying}
                      disabled={!media.title || media.durationSec <= 0}
                      formatTooltip={formatTime}
                      ariaLabel="Playback position"
                    />
                    <div className={`flex justify-between text-[10px] font-mono tabular-nums ${mutedText}`}>
                      <span>{formatTime(media.positionSec)}</span>
                      <span>{formatTime(media.durationSec)}</span>
                    </div>
                  </div>

                  {/* Bottom 12-Col Grid: Visualizer Switcher | Transport | Volume ScrubBar */}
                  <div className="grid grid-cols-12 items-center gap-2 pt-0.5">
                    <div
                      className={`col-span-4 grid grid-cols-3 p-0.5 rounded-lg border text-[10px] font-medium ${
                        isLight ? "bg-zinc-200/80 border-zinc-300" : "bg-[#141418] border-zinc-800"
                      }`}
                    >
                      {(["bars", "wave", "dots"] as VisualizerStyle[]).map((style) => (
                        <button
                          key={style}
                          onClick={() => handleSetVisualizer(style)}
                          className={`py-1 rounded-md capitalize transition-all ${focusRing} ${
                            visualizerStyle === style
                              ? isLight
                                ? "bg-white text-zinc-950 font-semibold shadow-sm"
                                : "bg-zinc-800 text-white font-semibold"
                              : isLight
                                ? "text-zinc-600 hover:text-zinc-950"
                                : "text-zinc-400 hover:text-white"
                          }`}
                        >
                          {style}
                        </button>
                      ))}
                    </div>

                    <div className="col-span-4 flex items-center justify-center gap-1.5">
                      <button
                        onClick={onPrev}
                        className={`p-1.5 rounded-md transition-all active:scale-[0.92] ${focusRing} ${
                          isLight ? "text-zinc-700 hover:bg-zinc-200" : "text-zinc-300 hover:bg-zinc-800"
                        }`}
                        title="Previous Track"
                      >
                        <SkipBack className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onSeek(Math.max(0, media.positionSec - 10))}
                        className={`p-1.5 rounded-md transition-all active:scale-[0.92] ${focusRing} ${mutedText} hover:text-current`}
                        title="Rewind 10s"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                      <button
                        onClick={onTogglePlayPause}
                        className={`w-8 h-8 flex items-center justify-center rounded-full transition-all ${focusRing} ${primaryBtnCls}`}
                        title={media.isPlaying ? "Pause (Space)" : "Play (Space)"}
                      >
                        {media.isPlaying ? (
                          <Pause className={`w-3.5 h-3.5 ${isLight ? "fill-white" : "fill-zinc-950"}`} />
                        ) : (
                          <Play className={`w-3.5 h-3.5 translate-x-[0.5px] ${isLight ? "fill-white" : "fill-zinc-950"}`} />
                        )}
                      </button>
                      <button
                        onClick={() => onSeek(Math.min(media.durationSec, media.positionSec + 10))}
                        className={`p-1.5 rounded-md transition-all active:scale-[0.92] ${focusRing} ${mutedText} hover:text-current`}
                        title="Forward 10s"
                      >
                        <RotateCw className="w-3 h-3" />
                      </button>
                      <button
                        onClick={onNext}
                        className={`p-1.5 rounded-md transition-all active:scale-[0.92] ${focusRing} ${
                          isLight ? "text-zinc-700 hover:bg-zinc-200" : "text-zinc-300 hover:bg-zinc-800"
                        }`}
                        title="Next Track"
                      >
                        <SkipForward className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="col-span-4 grid grid-cols-[auto_1fr_auto] items-center gap-1.5 pl-1">
                      <button
                        onClick={handleToggleMute}
                        className={`p-1 rounded-md transition-colors ${focusRing} ${
                          isLight ? "text-zinc-700 hover:bg-zinc-200" : "text-zinc-300 hover:bg-zinc-800"
                        }`}
                        title={volume.muted ? "Unmute" : "Mute"}
                      >
                        {renderVolumeIcon("w-3.5 h-3.5")}
                      </button>
                      <ScrubBar
                        value={volume.muted ? 0 : volume.level}
                        max={100}
                        onChange={handleSetVolume}
                        isLight={isLight}
                        ariaLabel="Master volume"
                      />
                      <span className={`text-[10px] font-mono tabular-nums w-7 text-right ${mutedText}`}>
                        {volume.muted ? "0%" : `${volume.level}%`}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* ===================================================== */}
              {/* TAB 2: CLOCK & CALENDAR (OPEN HERO + CLEAN CALENDAR)  */}
              {/* ===================================================== */}
              {activeTab === "clock" && (
                <div className="w-full h-full grid grid-cols-12 gap-4 items-stretch">
                  {/* Left (5 cols): Open typographic clock — no redundant box */}
                  <div className="col-span-5 py-1.5 px-1 flex flex-col justify-between">
                    <div>
                      <div className={`text-[10px] font-medium ${mutedText}`}>Local Time</div>
                      <div className="text-[22px] font-mono font-bold tabular-nums tracking-tight mt-1 leading-none">
                        {fullClockAmPm}
                      </div>
                    </div>

                    <div className="space-y-0.5">
                      <div className="text-xs font-semibold">
                        {currentTime.toLocaleDateString("en-US", { weekday: "long" })}
                      </div>
                      <div className={`text-[11px] ${mutedText}`}>
                        {currentTime.toLocaleDateString("en-US", {
                          month: "long",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </div>
                    </div>

                    <div className={`pt-2 border-t text-[10px] truncate ${isLight ? "border-zinc-200 text-zinc-600" : "border-zinc-800 text-zinc-400"}`}>
                      {Intl.DateTimeFormat().resolvedOptions().timeZone}
                    </div>
                  </div>

                  {/* Right (7 cols): Interactive Monthly Calendar */}
                  <div className={`col-span-7 p-2.5 flex flex-col justify-between ${surfaceSubtle}`}>
                    <div className="grid grid-cols-[auto_1fr_auto] items-center text-[11px] font-semibold mb-1">
                      <button
                        onClick={() => setCalendarMonthOffset((prev) => prev - 1)}
                        className={`p-1 rounded-md ${focusRing} ${isLight ? "text-zinc-700 hover:bg-zinc-100" : "text-zinc-300 hover:bg-zinc-800"}`}
                        title="Previous Month"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-center">{currentMonthName}</span>
                      <button
                        onClick={() => setCalendarMonthOffset((prev) => prev + 1)}
                        className={`p-1 rounded-md ${focusRing} ${isLight ? "text-zinc-700 hover:bg-zinc-100" : "text-zinc-300 hover:bg-zinc-800"}`}
                        title="Next Month"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className={`grid grid-cols-7 text-center text-[10px] font-medium mb-0.5 ${mutedText}`}>
                      <span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>
                    </div>

                    <div className="grid grid-cols-7 gap-y-0.5 text-center text-[10px] tabular-nums">
                      {Array.from({ length: firstDayWeekday }).map((_, i) => (
                        <span key={`empty-${i}`} className="text-transparent">.</span>
                      ))}
                      {Array.from({ length: daysInMonth }).map((_, i) => {
                        const dayNum = i + 1;
                        const isToday = isCurrentViewingMonth && dayNum === currentTime.getDate();
                        return (
                          <span
                            key={`day-${dayNum}`}
                            className={`h-[19px] flex items-center justify-center rounded-full ${
                              isToday
                                ? "bg-[#f97316] text-white font-bold"
                                : isLight
                                  ? "text-zinc-800 hover:bg-zinc-100"
                                  : "text-zinc-200 hover:bg-zinc-800"
                            }`}
                          >
                            {dayNum}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* ===================================================== */}
              {/* TAB 3: COUNTDOWN TIMER (SOFT CHIME, NO ENDLESS PULSE) */}
              {/* ===================================================== */}
              {activeTab === "timer" && (
                <div className="w-full h-full grid grid-cols-12 gap-4 items-stretch">
                  <div className="col-span-5 py-1 px-1 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-medium ${mutedText}`}>Countdown</span>
                        <span
                          className={`text-[10px] font-semibold ${
                            isTimerFinished || isTimerRunning ? "text-[#f97316]" : mutedText
                          }`}
                        >
                          {isTimerFinished ? "Complete" : isTimerRunning ? "Running" : "Ready"}
                        </span>
                      </div>
                      <div
                        className={`text-4xl font-mono font-bold tabular-nums mt-2 leading-none ${
                          isTimerFinished ? "text-[#f97316]" : ""
                        }`}
                      >
                        {formatTime(timerRemaining)}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        onClick={() => handleAdjustTimer(-60)}
                        className={`py-1.5 rounded-lg border text-[10px] font-mono transition-all ${focusRing} ${subtleBtnCls}`}
                      >
                        -1m
                      </button>
                      <button
                        onClick={() => handleAdjustTimer(60)}
                        className={`py-1.5 rounded-lg border text-[10px] font-mono transition-all ${focusRing} ${subtleBtnCls}`}
                      >
                        +1m
                      </button>
                      <button
                        onClick={() => handleAdjustTimer(10)}
                        className={`py-1.5 rounded-lg border text-[10px] font-mono transition-all ${focusRing} ${subtleBtnCls}`}
                      >
                        +10s
                      </button>
                    </div>
                  </div>

                  <div className="col-span-7 flex flex-col justify-between gap-2.5 py-0.5">
                    {isTimerFinished ? (
                      <div className={`flex-1 p-3 flex flex-col justify-between border border-[#f97316]/60 rounded-xl ${isLight ? "bg-orange-50" : "bg-[#1a1410]"}`}>
                        <div>
                          <div className="text-xs font-semibold text-[#f97316]">Timer Completed</div>
                          <p className={`text-[11px] mt-0.5 ${mutedText}`}>
                            Your countdown reached 0:00.
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={handleResetTimer}
                            className={`py-1.5 rounded-lg text-xs font-semibold transition-all ${focusRing} ${primaryBtnCls}`}
                          >
                            Dismiss
                          </button>
                          <button
                            onClick={() => {
                              handleSetPresetTimer(300);
                              setIsTimerRunning(true);
                            }}
                            className={`py-1.5 rounded-lg text-xs font-medium border transition-all ${focusRing} ${subtleBtnCls}`}
                          >
                            +5 min
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-1.5">
                          {[
                            { label: "1 min", sec: 60 },
                            { label: "5 min", sec: 300 },
                            { label: "15 min", sec: 900 },
                            { label: "25m Focus", sec: 1500 },
                          ].map((preset) => {
                            const active = timerDuration === preset.sec;
                            return (
                              <button
                                key={preset.sec}
                                onClick={() => handleSetPresetTimer(preset.sec)}
                                className={`py-2 rounded-lg text-[11px] font-medium transition-all border ${focusRing} ${
                                  active
                                    ? isLight
                                      ? "bg-zinc-900 border-zinc-900 text-white font-semibold"
                                      : "bg-zinc-800 border-zinc-600 text-white font-semibold"
                                    : subtleBtnCls
                                }`}
                              >
                                {preset.label}
                              </button>
                            );
                          })}
                        </div>

                        <div className={`w-full h-1.5 rounded-full overflow-hidden ${isLight ? "bg-zinc-300" : "bg-zinc-800"}`}>
                          <div
                            className="h-full bg-[#f97316] transition-all duration-300"
                            style={{
                              width: `${
                                timerDuration > 0
                                  ? ((timerDuration - timerRemaining) / timerDuration) * 100
                                  : 0
                              }%`,
                            }}
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={handleStartPauseTimer}
                            className={`py-1.5 rounded-lg font-semibold text-xs transition-all ${focusRing} ${primaryBtnCls}`}
                          >
                            {isTimerRunning ? "Pause" : "Start"}
                          </button>
                          <button
                            onClick={handleResetTimer}
                            className={`py-1.5 rounded-lg text-xs font-medium transition-all border ${focusRing} ${subtleBtnCls}`}
                          >
                            Reset
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* ===================================================== */}
              {/* TAB 4: STOPWATCH                                      */}
              {/* ===================================================== */}
              {activeTab === "stopwatch" && (
                <div className="w-full h-full grid grid-cols-12 gap-4 items-stretch">
                  <div className="col-span-5 py-1 px-1 flex flex-col justify-between">
                    <div>
                      <div className={`text-[10px] font-medium ${mutedText}`}>Stopwatch</div>
                      <div className="text-[28px] font-mono font-bold tabular-nums tracking-tight mt-2 leading-none">
                        {formatStopwatch(stopwatchTimeMs)}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <button
                        onClick={handleToggleStopwatch}
                        className={`w-full py-1.5 rounded-lg font-semibold text-xs transition-all ${focusRing} ${primaryBtnCls}`}
                      >
                        {isStopwatchRunning ? "Pause" : "Start"}
                      </button>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          onClick={handleLapStopwatch}
                          disabled={!isStopwatchRunning}
                          className={`py-1.5 rounded-lg text-[10px] font-medium disabled:opacity-40 transition-all border flex items-center justify-center gap-1 ${focusRing} ${subtleBtnCls}`}
                        >
                          <Flag className="w-3 h-3" />
                          <span>Lap</span>
                        </button>
                        <button
                          onClick={handleResetStopwatch}
                          className={`py-1.5 rounded-lg text-[10px] font-medium transition-all border ${focusRing} ${subtleBtnCls}`}
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className={`col-span-7 p-2.5 flex flex-col overflow-hidden ${surfaceSubtle}`}>
                    <div
                      className={`flex items-center justify-between text-[10px] font-medium pb-1.5 border-b ${
                        isLight ? "border-zinc-200 text-zinc-600" : "border-zinc-800 text-zinc-400"
                      }`}
                    >
                      <span>Lap Splits</span>
                      <span className="font-mono tabular-nums">{stopwatchLaps.length} laps</span>
                    </div>

                    <div className="scrollable-area flex-1 overflow-y-auto pt-1.5 space-y-1 font-mono tabular-nums text-[11px]">
                      {stopwatchLaps.length === 0 ? (
                        <div className={`w-full h-full flex items-center justify-center text-[11px] font-sans ${mutedText}`}>
                          Press Lap while running to record splits
                        </div>
                      ) : (
                        stopwatchLaps.map((lapMs, idx) => (
                          <div
                            key={idx}
                            className={`grid grid-cols-2 items-center px-2 py-1 rounded-md ${
                              isLight ? "bg-zinc-100 text-zinc-800" : "bg-[#0c0c0e] text-zinc-200"
                            }`}
                          >
                            <span className={`text-[10px] ${mutedText}`}>Lap #{stopwatchLaps.length - idx}</span>
                            <span className="text-right font-semibold">{formatStopwatch(lapMs)}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ===================================================== */}
              {/* TAB 5: WEATHER (OPEN HERO + HONEST ERROR/RETRY STATE) */}
              {/* ===================================================== */}
              {activeTab === "weather" && (
                <div className="w-full h-full grid grid-cols-12 gap-4 items-stretch">
                  {/* Left (5 cols): Open typographic hero without boxy border */}
                  <div className="col-span-5 py-1 px-1 flex flex-col justify-between">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        {renderWeatherIcon(weather?.icon || "cloud-sun", "w-7 h-7")}
                        <span className="text-3xl font-bold tabular-nums leading-none">
                          {weather ? `${weather.temperature}°` : "--°"}
                        </span>
                      </div>
                      <button
                        onClick={() => loadWeather()}
                        disabled={weatherLoading}
                        className={`p-1.5 rounded-lg transition-colors ${focusRing} ${
                          isLight ? "text-zinc-600 hover:bg-zinc-200" : "text-zinc-400 hover:bg-zinc-800"
                        }`}
                        title="Refresh Weather"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${weatherLoading ? "animate-spin" : ""}`} />
                      </button>
                    </div>

                    <div>
                      <div className="text-sm font-semibold truncate">
                        {weather ? weather.city : weatherLoading ? "Loading weather..." : "Weather Offline"}
                      </div>
                      <div className={`text-[11px] truncate mt-0.5 ${mutedText}`}>
                        {weatherError || (weather ? weather.condition : "Detecting current city")}
                      </div>
                      {weatherError && (
                        <button
                          onClick={() => loadWeather()}
                          className={`mt-2 px-2.5 py-1 rounded-md text-[10px] font-semibold ${primaryBtnCls}`}
                        >
                          Retry
                        </button>
                      )}
                    </div>

                    <div className={`text-[10px] ${mutedText}`}>Open-Meteo Live</div>
                  </div>

                  {/* Right (7 cols): City Search + Clean Hairline Metrics */}
                  <div className="col-span-7 flex flex-col justify-between gap-2.5">
                    <form onSubmit={handleSearchWeatherCity} className="grid grid-cols-[1fr_auto] gap-1.5">
                      <div className="relative">
                        <input
                          type="text"
                          value={weatherCityInput}
                          onChange={(e) => setWeatherCityInput(e.target.value)}
                          placeholder="Set city (e.g. Jakarta, Tokyo)..."
                          className={`w-full h-7 text-[11px] rounded-lg pl-7 pr-2 border focus:outline-none focus-visible:ring-1 focus-visible:ring-[#f97316] ${
                            isLight
                              ? "bg-white border-zinc-300 text-zinc-900 placeholder-zinc-500"
                              : "bg-[#141418] border-zinc-800 text-zinc-100 placeholder-zinc-500"
                          }`}
                        />
                        <Search className="w-3 h-3 text-zinc-500 absolute left-2.5 top-2" />
                      </div>
                      <button
                        type="submit"
                        className={`h-7 px-3 rounded-lg text-[10px] font-semibold transition-all ${focusRing} ${primaryBtnCls}`}
                      >
                        Set
                      </button>
                    </form>

                    <div className={`grid grid-cols-2 grid-rows-2 gap-px rounded-xl overflow-hidden flex-1 border ${isLight ? "bg-zinc-200 border-zinc-200" : "bg-zinc-800 border-zinc-800"}`}>
                      <div className={`p-2.5 flex flex-col justify-between ${isLight ? "bg-white" : "bg-[#141418]"}`}>
                        <div className={`flex items-center gap-1.5 text-[10px] ${mutedText}`}>
                          <Thermometer className="w-3 h-3" />
                          <span>Feels Like</span>
                        </div>
                        <div className="text-xs font-semibold tabular-nums">
                          {weather ? `${weather.feelsLike}°C` : "--"}
                        </div>
                      </div>

                      <div className={`p-2.5 flex flex-col justify-between ${isLight ? "bg-white" : "bg-[#141418]"}`}>
                        <div className={`flex items-center gap-1.5 text-[10px] ${mutedText}`}>
                          <Droplets className="w-3 h-3" />
                          <span>Humidity</span>
                        </div>
                        <div className="text-xs font-semibold tabular-nums">
                          {weather ? `${weather.humidity}%` : "--"}
                        </div>
                      </div>

                      <div className={`p-2.5 flex flex-col justify-between ${isLight ? "bg-white" : "bg-[#141418]"}`}>
                        <div className={`flex items-center gap-1.5 text-[10px] ${mutedText}`}>
                          <Wind className="w-3 h-3" />
                          <span>Wind</span>
                        </div>
                        <div className="text-xs font-semibold tabular-nums">
                          {weather ? `${weather.windSpeed} km/h` : "--"}
                        </div>
                      </div>

                      <div className={`p-2.5 flex flex-col justify-between ${isLight ? "bg-white" : "bg-[#141418]"}`}>
                        <div className={`flex items-center gap-1.5 text-[10px] ${mutedText}`}>
                          <ArrowUpDown className="w-3 h-3" />
                          <span>High / Low</span>
                        </div>
                        <div className="text-xs font-semibold tabular-nums">
                          {weather ? `${weather.tempMax}° / ${weather.tempMin}°` : "--"}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ===================================================== */}
              {/* TAB 6: NOTES SCRATCHPAD & LOCAL CLIPBOARD HISTORY     */}
              {/* ===================================================== */}
              {activeTab === "notes" && (
                <div className="w-full h-full grid grid-rows-[auto_1fr_auto] gap-2">
                  {/* Sub-mode switcher */}
                  <div className="flex items-center justify-between">
                    <div
                      className={`grid grid-cols-2 p-0.5 rounded-lg border text-[10px] font-medium ${
                        isLight ? "bg-zinc-200/80 border-zinc-300" : "bg-[#141418] border-zinc-800"
                      }`}
                    >
                      <button
                        onClick={() => setNotesMode("scratchpad")}
                        className={`px-2.5 py-0.5 rounded-md flex items-center gap-1 transition-all ${
                          notesMode === "scratchpad"
                            ? isLight
                              ? "bg-white text-zinc-950 font-semibold shadow-sm"
                              : "bg-zinc-800 text-white font-semibold"
                            : mutedText
                        }`}
                      >
                        <StickyNote className="w-3 h-3" />
                        <span>Scratchpad</span>
                      </button>
                      <button
                        onClick={() => setNotesMode("clipboard")}
                        className={`px-2.5 py-0.5 rounded-md flex items-center gap-1 transition-all ${
                          notesMode === "clipboard"
                            ? isLight
                              ? "bg-white text-zinc-950 font-semibold shadow-sm"
                              : "bg-zinc-800 text-white font-semibold"
                            : mutedText
                        }`}
                      >
                        <Clipboard className="w-3 h-3" />
                        <span>Clipboard ({clipboardHistory.length})</span>
                      </button>
                    </div>

                    {notesMode === "clipboard" && clipboardHistory.length > 0 && (
                      <button
                        onClick={handleClearClipboard}
                        className={`px-2 py-0.5 rounded-md text-[10px] border transition-colors ${subtleBtnCls}`}
                      >
                        Clear History
                      </button>
                    )}
                  </div>

                  {notesMode === "scratchpad" ? (
                    <>
                      <textarea
                        value={notesText}
                        onChange={(e) => handleNotesChange(e.target.value)}
                        placeholder="Quick notes, reminders, or snippets... (Auto-saved locally)"
                        className={`w-full h-full resize-none rounded-xl border p-2.5 text-xs leading-relaxed focus:outline-none focus-visible:ring-1 focus-visible:ring-[#f97316] select-text ${
                          isLight
                            ? "bg-white border-zinc-300 text-zinc-900 placeholder-zinc-500"
                            : "bg-[#141418] border-zinc-800 text-zinc-100 placeholder-zinc-500"
                        }`}
                      />

                      <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                        <span className={`text-[10px] font-mono tabular-nums ${mutedText}`}>
                          {wordCount} words · {notesText.length} chars
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={handleCopyNotes}
                            disabled={!notesText}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium border transition-all flex items-center gap-1 disabled:opacity-40 ${focusRing} ${subtleBtnCls}`}
                          >
                            {notesCopied ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-500" />
                                <span className="text-emerald-500">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Copy All</span>
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => handleNotesChange("")}
                            disabled={!notesText}
                            className={`px-2 py-1 rounded-lg text-[10px] font-medium border transition-all flex items-center gap-1 disabled:opacity-40 ${focusRing} ${subtleBtnCls}`}
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Clear</span>
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className={`scrollable-area overflow-y-auto p-1.5 space-y-1 ${surfaceSubtle}`}>
                        {clipboardHistory.length === 0 ? (
                          <div className={`w-full h-full flex flex-col items-center justify-center text-center px-4 ${mutedText}`}>
                            <p className="text-[11px] font-medium">Clipboard history is empty</p>
                            <p className="text-[10px] mt-0.5">Copy any text with Ctrl+C to capture it locally here.</p>
                          </div>
                        ) : (
                          clipboardHistory.map((item) => (
                            <div
                              key={item.id}
                              className={`grid grid-cols-[1fr_auto] items-center gap-2 px-2.5 py-1.5 rounded-lg transition-colors ${
                                isLight ? "bg-zinc-100/80 hover:bg-zinc-200/70" : "bg-[#0c0c0e] hover:bg-zinc-800/80"
                              }`}
                            >
                              <span className="text-[11px] truncate" title={item.text}>
                                {item.text.replace(/\s+/g, " ")}
                              </span>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleCopyClipItem(item)}
                                  className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${subtleBtnCls}`}
                                  title="Copy back to clipboard"
                                >
                                  {copiedClipId === item.id ? "Copied" : "Copy"}
                                </button>
                                <button
                                  onClick={() => {
                                    handleNotesChange(notesText ? `${notesText}\n${item.text}` : item.text);
                                    setNotesMode("scratchpad");
                                  }}
                                  className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${subtleBtnCls}`}
                                  title="Append to Scratchpad"
                                >
                                  + Note
                                </button>
                                <button
                                  onClick={() => handleDeleteClipItem(item.id)}
                                  className={`p-0.5 rounded border transition-colors ${subtleBtnCls}`}
                                  title="Delete from clipboard history"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                      <div className={`flex items-center gap-1.5 text-[10px] ${mutedText}`}>
                        {winClipboardSynced ? (
                          <>
                            <span className="w-1.5 h-1.5 rounded-full bg-[#f97316] flex-shrink-0" />
                            <span>Synced with Windows Clipboard (Win + V)</span>
                          </>
                        ) : (
                          <span>Local session history · Enable Win + V in Windows Settings to sync</span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ===================================================== */}
              {/* TAB 7: FILE DROP SHELF (NATIVE DRAG & DROP TRAY)      */}
              {/* ===================================================== */}
              {activeTab === "shelf" && (
                <div className="w-full h-full grid grid-rows-[1fr_auto] gap-2">
                  <div
                    className={`scrollable-area overflow-y-auto p-2 transition-colors ${surfaceSubtle} ${
                      isDragOver ? "border-[#f97316]" : ""
                    }`}
                  >
                    {shelfFiles.length === 0 ? (
                      <div className={`w-full h-full flex flex-col items-center justify-center text-center px-6 ${mutedText}`}>
                        <Inbox className="w-6 h-6 mb-1.5 opacity-70" />
                        <p className="text-xs font-medium">Drag &amp; drop files onto Dynamic Island</p>
                        <p className="text-[10px] mt-0.5">
                          Hold files, screenshots, or folders here for quick access while switching windows.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {shelfFiles.map((file) => (
                          <div
                            key={file.path}
                            className={`grid grid-cols-[auto_1fr_auto] items-center gap-2.5 px-2.5 py-1.5 rounded-lg ${
                              isLight ? "bg-zinc-100" : "bg-[#0c0c0e]"
                            }`}
                          >
                            <div
                              className={`w-7 h-7 rounded-md flex items-center justify-center text-[9px] font-mono font-bold uppercase ${
                                isLight ? "bg-zinc-200 text-zinc-800" : "bg-zinc-800 text-zinc-200"
                              }`}
                            >
                              {file.isDir ? "DIR" : file.ext.slice(0, 4) || "FILE"}
                            </div>

                            <div className="min-w-0">
                              <div className="text-[11px] font-medium truncate" title={file.path}>
                                {file.name}
                              </div>
                              <div className={`text-[10px] font-mono tabular-nums ${mutedText}`}>
                                {formatBytes(file.sizeBytes)}
                              </div>
                            </div>

                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleOpenShelfFile(file.path)}
                                className={`p-1 rounded border transition-colors ${subtleBtnCls}`}
                                title="Open File"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => handleRevealShelfFile(file.path)}
                                className={`p-1 rounded border transition-colors ${subtleBtnCls}`}
                                title="Show in Explorer"
                              >
                                <FolderOpen className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => handleCopyShelfPath(file.path)}
                                className={`p-1 rounded border transition-colors ${subtleBtnCls}`}
                                title="Copy File Path"
                              >
                                {copiedPath === file.path ? (
                                  <Check className="w-3 h-3 text-emerald-500" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                              <button
                                onClick={() =>
                                  setShelfFiles((prev) => prev.filter((f) => f.path !== file.path))
                                }
                                className={`p-1 rounded border transition-colors ${subtleBtnCls}`}
                                title="Remove from Shelf"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-[10px]">
                    <span className={mutedText}>
                      {shelfFiles.length} {shelfFiles.length === 1 ? "item" : "items"} on shelf
                    </span>
                    {shelfFiles.length > 0 && (
                      <button
                        onClick={() => setShelfFiles([])}
                        className={`px-2 py-0.5 rounded-md border transition-colors ${subtleBtnCls}`}
                      >
                        Clear Shelf
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* ===================================================== */}
              {/* TAB 8: SYSTEM (CPU/RAM, AUDIO OUTPUT SWITCH, SETTINGS)*/}
              {/* ===================================================== */}
              {activeTab === "system" && (
                <div className="w-full h-full grid grid-cols-12 gap-3 items-stretch">
                  {/* Left (6 cols): Hardware Monitor + Audio Output Switcher */}
                  <div className="col-span-6 grid grid-rows-[auto_1fr] gap-2 min-h-0">
                    {/* Compact CPU + RAM + Battery Strip */}
                    <div className={`p-2.5 grid grid-cols-2 gap-3 ${surfaceSubtle}`}>
                      <div className="flex flex-col justify-between gap-1">
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] font-medium ${mutedText}`}>CPU</span>
                          <span className="text-xs font-mono font-bold tabular-nums">
                            {sysStats.cpuPercent.toFixed(0)}%
                          </span>
                        </div>
                        <div
                          className="grid gap-[2px] items-end h-4"
                          style={{ gridTemplateColumns: "repeat(14, minmax(0, 1fr))" }}
                        >
                          {cpuHistory.map((val, idx) => (
                            <div
                              key={idx}
                              className={`rounded-sm transition-all duration-300 ${
                                idx === cpuHistory.length - 1
                                  ? "bg-[#f97316]"
                                  : isLight
                                    ? "bg-zinc-700"
                                    : "bg-zinc-400"
                              }`}
                              style={{
                                height: `${Math.max(18, Math.min(100, val))}%`,
                                opacity: 0.35 + (idx / cpuHistory.length) * 0.65,
                              }}
                            />
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-col justify-between gap-1">
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] font-medium ${mutedText}`}>RAM</span>
                          <span className="text-xs font-mono font-bold tabular-nums">
                            {sysStats.ramPercent.toFixed(0)}%
                          </span>
                        </div>
                        <div className={`w-full h-1.5 rounded-full overflow-hidden ${isLight ? "bg-zinc-200" : "bg-zinc-800"}`}>
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${isLight ? "bg-zinc-900" : "bg-zinc-100"}`}
                            style={{ width: `${Math.min(100, sysStats.ramPercent)}%` }}
                          />
                        </div>
                        <div className={`text-[9px] font-mono tabular-nums ${mutedText}`}>
                          {sysStats.ramUsedGb.toFixed(1)}/{sysStats.ramTotalGb.toFixed(0)} GB
                        </div>
                      </div>
                    </div>

                    {/* Audio Output Device Switcher */}
                    <div className={`p-2 flex flex-col overflow-hidden min-h-0 ${surfaceSubtle}`}>
                      <div className="flex items-center justify-between pb-1 mb-1 border-b border-zinc-800/30">
                        <div className={`flex items-center gap-1.5 text-[10px] font-medium ${mutedText}`}>
                          <Speaker className="w-3 h-3" />
                          <span>Audio Output</span>
                        </div>
                        {battery.hasBattery && (
                          <div className={`flex items-center gap-1 text-[10px] font-mono tabular-nums ${mutedText}`}>
                            {battery.isCharging ? (
                              <BatteryCharging className="w-3 h-3 text-[#f97316]" />
                            ) : (
                              <Battery className="w-3 h-3" />
                            )}
                            <span>{battery.percent}%</span>
                          </div>
                        )}
                      </div>

                      <div className="scrollable-area flex-1 overflow-y-auto space-y-1">
                        {audioDevices.length === 0 ? (
                          <div className={`text-[10px] py-2 text-center ${mutedText}`}>
                            No active output devices
                          </div>
                        ) : (
                          audioDevices.map((dev) => (
                            <button
                              key={dev.id}
                              onClick={() => handleSwitchAudioDevice(dev)}
                              className={`w-full text-left px-2 py-1 rounded-md text-[10px] flex items-center justify-between gap-2 transition-colors ${focusRing} ${
                                dev.isDefault
                                  ? isLight
                                    ? "bg-zinc-900 text-white font-semibold"
                                    : "bg-zinc-800 text-white font-semibold"
                                  : isLight
                                    ? "hover:bg-zinc-100 text-zinc-700"
                                    : "hover:bg-zinc-800/60 text-zinc-300"
                              }`}
                              title={dev.name}
                            >
                              <span className="truncate">{dev.name}</span>
                              {dev.isDefault && (
                                <span className="w-1.5 h-1.5 rounded-full bg-[#f97316] flex-shrink-0" />
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right (6 cols): Volume ScrubBar + Fullscreen Hide + Auto-Start */}
                  <div className="col-span-6 grid grid-rows-3 gap-2">
                    {/* Volume Card */}
                    <div className={`px-3 py-2 flex flex-col justify-center gap-1 ${surfaceSubtle}`}>
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-medium ${mutedText}`}>Master Volume</span>
                        <span className="text-[11px] font-mono font-bold tabular-nums">
                          {volume.muted ? "Muted" : `${volume.level}%`}
                        </span>
                      </div>
                      <div className="grid grid-cols-[auto_1fr] items-center gap-2">
                        <button
                          onClick={handleToggleMute}
                          className={`p-1 rounded ${focusRing} ${isLight ? "text-zinc-700 hover:bg-zinc-100" : "text-zinc-300 hover:bg-zinc-800"}`}
                        >
                          {renderVolumeIcon("w-3.5 h-3.5")}
                        </button>
                        <ScrubBar
                          value={volume.muted ? 0 : volume.level}
                          max={100}
                          onChange={handleSetVolume}
                          isLight={isLight}
                          accent
                          ariaLabel="System master volume"
                        />
                      </div>
                    </div>

                    {/* Auto-Hide on Fullscreen */}
                    <div className={`px-3 py-2 flex items-center justify-between gap-2 ${surfaceSubtle}`}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-[11px] font-medium">
                          <Monitor className={`w-3.5 h-3.5 flex-shrink-0 ${mutedText}`} />
                          <span className="truncate">Auto-Hide Fullscreen</span>
                        </div>
                        <div className={`text-[10px] truncate ${mutedText}`}>
                          Hide during videos &amp; games
                        </div>
                      </div>
                      <button
                        onClick={handleToggleAutoHideFullscreen}
                        aria-label="Toggle auto-hide on fullscreen"
                        className={`w-9 h-5 rounded-full p-0.5 transition-colors flex items-center flex-shrink-0 ${focusRing} ${
                          autoHideFullscreen
                            ? "bg-[#f97316] justify-end"
                            : isLight
                              ? "bg-zinc-300 justify-start"
                              : "bg-zinc-700 justify-start"
                        }`}
                      >
                        <div className="w-4 h-4 rounded-full bg-white shadow-sm" />
                      </button>
                    </div>

                    {/* Auto-Start on Windows Boot */}
                    <div className={`px-3 py-2 flex items-center justify-between gap-2 ${surfaceSubtle}`}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-[11px] font-medium">
                          <Power className={`w-3.5 h-3.5 flex-shrink-0 ${mutedText}`} />
                          <span className="truncate">Start with Windows</span>
                        </div>
                        <div className={`text-[10px] truncate ${mutedText}`}>
                          {autostartEnabled ? "Enabled on boot" : "Launch manually"}
                        </div>
                      </div>
                      <button
                        onClick={handleToggleAutostart}
                        disabled={autostartBusy}
                        aria-label="Toggle start with Windows"
                        className={`w-9 h-5 rounded-full p-0.5 transition-colors flex items-center flex-shrink-0 ${focusRing} ${
                          autostartEnabled
                            ? "bg-[#f97316] justify-end"
                            : isLight
                              ? "bg-zinc-300 justify-start"
                              : "bg-zinc-700 justify-start"
                        }`}
                      >
                        <div className="w-4 h-4 rounded-full bg-white shadow-sm" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Custom Flat Right-Click Context Menu */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-[90]"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu(null);
            }}
          />
          <div
            className={`context-menu-pop fixed z-[100] w-[184px] p-1 rounded-xl border shadow-2xl select-none ${
              isLight
                ? "bg-[#f8f8f7] border-zinc-300 text-zinc-900 shadow-black/15"
                : "bg-[#121216] border-zinc-800 text-zinc-100 shadow-black/90"
            }`}
            style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          >
            <button
              onClick={handleRefreshIsland}
              className={`w-full px-2.5 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-2 transition-colors ${focusRing} ${
                isLight ? "hover:bg-zinc-200/80" : "hover:bg-zinc-800"
              }`}
            >
              <RefreshCw className="w-3.5 h-3.5 text-[#f97316]" />
              <span>Refresh &amp; Center</span>
            </button>

            <button
              onClick={() => {
                setContextMenu(null);
                onToggleLyricsWindow();
              }}
              className={`w-full px-2.5 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-2 transition-colors ${focusRing} ${
                isLight ? "hover:bg-zinc-200/80" : "hover:bg-zinc-800"
              }`}
            >
              <FileText className={`w-3.5 h-3.5 ${mutedText}`} />
              <span>{isLyricsOpen ? "Hide Lyrics" : "Show Lyrics"}</span>
            </button>

            <button
              onClick={() => {
                setContextMenu(null);
                onToggleTheme();
              }}
              className={`w-full px-2.5 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-2 transition-colors ${focusRing} ${
                isLight ? "hover:bg-zinc-200/80" : "hover:bg-zinc-800"
              }`}
            >
              {isLight ? (
                <Moon className={`w-3.5 h-3.5 ${mutedText}`} />
              ) : (
                <Sun className={`w-3.5 h-3.5 ${mutedText}`} />
              )}
              <span>{isLight ? "Dark Mode" : "Light Mode"}</span>
            </button>

            <div className={`my-1 h-px ${isLight ? "bg-zinc-200" : "bg-zinc-800"}`} />

            <button
              onClick={handleQuitApp}
              className={`w-full px-2.5 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-2 transition-colors ${focusRing} ${
                isLight
                  ? "text-red-600 hover:bg-red-50"
                  : "text-red-400 hover:bg-red-950/50"
              }`}
            >
              <Power className="w-3.5 h-3.5" />
              <span>Close MS Island</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
};
