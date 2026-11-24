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
  ArrowUpDown
} from "lucide-react";
import { MediaTrack } from "../types/media";
import { ThemeMode } from "../types/theme";
import { SystemStats, VisualizerStyle, VolumeInfo, WeatherInfo } from "../types/system";
import { AudioVisualizer } from "./AudioVisualizer";

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

type TabType = "music" | "clock" | "timer" | "stopwatch" | "weather" | "notes" | "system";

const TABS: { id: TabType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "music", label: "Music", icon: Music },
  { id: "clock", label: "Clock", icon: Clock },
  { id: "timer", label: "Timer", icon: Hourglass },
  { id: "stopwatch", label: "Stopwatch", icon: TimerIcon },
  { id: "weather", label: "Weather", icon: CloudSun },
  { id: "notes", label: "Notes", icon: StickyNote },
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
  onStartDrag
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("music");
  const hoverTimeoutRef = useRef<number | null>(null);
  const hoverEnterTimeoutRef = useRef<number | null>(null);
  const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
  const isLight = theme === "light";

  // -------------------------------------------------------------
  // 1. Visualizer Style Preference (Bars / Wave / Dots)
  // -------------------------------------------------------------
  const [visualizerStyle, setVisualizerStyle] = useState<VisualizerStyle>(() => {
    const saved = localStorage.getItem("ms-island-visualizer");
    return saved === "wave" || saved === "dots" || saved === "bars" ? saved : "bars";
  });

  const handleSetVisualizer = (style: VisualizerStyle) => {
    setVisualizerStyle(style);
    localStorage.setItem("ms-island-visualizer", style);
  };

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
  // 3. Master Volume & Scroll Wheel HUD State
  // -------------------------------------------------------------
  const [volume, setVolume] = useState<VolumeInfo>({ level: 50, muted: false });
  const [showVolumeHud, setShowVolumeHud] = useState<boolean>(false);
  const volumeHudTimeoutRef = useRef<number | null>(null);
  const lastWheelTimeRef = useRef<number>(0);

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
    const id = setInterval(fetchVol, 2000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [isTauri]);

  const triggerVolumeHud = () => {
    setShowVolumeHud(true);
    if (volumeHudTimeoutRef.current) clearTimeout(volumeHudTimeoutRef.current);
    volumeHudTimeoutRef.current = window.setTimeout(() => {
      setShowVolumeHud(false);
    }, 1800);
  };

  const handleSetVolume = async (newLevel: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(newLevel)));
    setVolume(prev => ({ level: clamped, muted: clamped === 0 ? prev.muted : false }));
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
    setVolume(prev => ({ ...prev, muted: !prev.muted }));
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
    // Allow natural scrolling inside textareas or designated scrollable panels
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
      setVolume(prev => ({
        level: Math.max(0, Math.min(100, prev.level + delta)),
        muted: false,
      }));
    }
  };

  // -------------------------------------------------------------
  // 4. Countdown Timer State
  // -------------------------------------------------------------
  const [timerDuration, setTimerDuration] = useState<number>(300);
  const [timerRemaining, setTimerRemaining] = useState<number>(300);
  const [isTimerRunning, setIsTimerRunning] = useState<boolean>(false);
  const [isTimerFinished, setIsTimerFinished] = useState<boolean>(false);

  useEffect(() => {
    let timerId: number | null = null;
    if (isTimerRunning && timerRemaining > 0) {
      timerId = window.setInterval(() => {
        setTimerRemaining(prev => {
          if (prev <= 1) {
            setIsTimerRunning(false);
            setIsTimerFinished(true);
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
    if (!isTimerRunning) {
      setTimerDuration(newRemaining);
    }
  };

  // -------------------------------------------------------------
  // 5. Millisecond Stopwatch State
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
      setStopwatchLaps(prev => [stopwatchTimeMs, ...prev]);
    }
  };

  // -------------------------------------------------------------
  // 6. Weather & Temperature State
  // -------------------------------------------------------------
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [weatherCityInput, setWeatherCityInput] = useState<string>("");
  const [savedWeatherCity, setSavedWeatherCity] = useState<string>(() => localStorage.getItem("ms-island-weather-city") || "");
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
      setWeatherError(typeof e === "string" ? e : "Unable to load weather");
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
  // 7. Quick Scratchpad / Notes State
  // -------------------------------------------------------------
  const [notesText, setNotesText] = useState<string>(() => localStorage.getItem("ms-island-notes") || "");
  const [notesCopied, setNotesCopied] = useState<boolean>(false);

  const handleNotesChange = (val: string) => {
    setNotesText(val);
    localStorage.setItem("ms-island-notes", val);
  };

  const handleCopyNotes = () => {
    if (!notesText) return;
    navigator.clipboard.writeText(notesText);
    setNotesCopied(true);
    setTimeout(() => setNotesCopied(false), 1800);
  };

  // -------------------------------------------------------------
  // 8. Hardware Monitor (CPU & RAM) & Windows Auto-Start State
  // -------------------------------------------------------------
  const [sysStats, setSysStats] = useState<SystemStats>({
    cpuPercent: 0,
    ramPercent: 0,
    ramUsedGb: 0,
    ramTotalGb: 0,
  });
  const [cpuHistory, setCpuHistory] = useState<number[]>(Array(14).fill(4));
  const [autostartEnabled, setAutostartEnabled] = useState<boolean>(false);
  const [autostartBusy, setAutostartBusy] = useState<boolean>(false);

  useEffect(() => {
    if (!isTauri) return;
    let mounted = true;

    const loadAutostart = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const enabled = await invoke<boolean>("get_autostart");
        if (mounted) setAutostartEnabled(enabled);
      } catch (e) {
        console.error("Failed to check autostart:", e);
      }
    };

    const pollStats = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const stats = await invoke<SystemStats>("get_system_stats");
        if (mounted) {
          setSysStats(stats);
          setCpuHistory(prev => [...prev.slice(1), Math.max(4, stats.cpuPercent)]);
        }
      } catch (e) {
        console.error("Failed to poll system stats:", e);
      }
    };

    loadAutostart();
    pollStats();
    const id = setInterval(pollStats, 1500);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [isTauri]);

  const handleToggleAutostart = async () => {
    if (!isTauri || autostartBusy) return;
    setAutostartBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const next = !autostartEnabled;
      const result = await invoke<boolean>("set_autostart", { enabled: next });
      setAutostartEnabled(result);
    } catch (e) {
      console.error("Failed to toggle autostart:", e);
    } finally {
      setAutostartBusy(false);
    }
  };

  // -------------------------------------------------------------
  // Hover Handlers strictly bound to inner pill/card container
  // -------------------------------------------------------------
  const handleMouseEnter = () => {
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
    if (hoverEnterTimeoutRef.current) {
      clearTimeout(hoverEnterTimeoutRef.current);
      hoverEnterTimeoutRef.current = null;
    }
    hoverTimeoutRef.current = window.setTimeout(() => {
      setIsHovered(false);
      setActiveTab("music");
    }, 250);
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

  const progressPercent = media.durationSec > 0
    ? Math.min(100, Math.max(0, (media.positionSec / media.durationSec) * 100))
    : 0;

  // Calendar calculations
  const displayCalendarDate = new Date(currentTime.getFullYear(), currentTime.getMonth() + calendarMonthOffset, 1);
  const currentMonthName = displayCalendarDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const daysInMonth = new Date(displayCalendarDate.getFullYear(), displayCalendarDate.getMonth() + 1, 0).getDate();
  const firstDayWeekday = new Date(displayCalendarDate.getFullYear(), displayCalendarDate.getMonth(), 1).getDay();
  const isCurrentViewingMonth = calendarMonthOffset === 0;

  const idleClockAmPm = formatAmPmTime(currentTime, false);
  const fullClockAmPm = formatAmPmTime(currentTime, true);
  const wordCount = notesText.trim() ? notesText.trim().split(/\s+/).length : 0;

  // Theme token helpers for crisp grid cards
  const cardCls = isLight
    ? "bg-white border border-zinc-200/90 rounded-xl"
    : "bg-zinc-900/80 border border-zinc-800 rounded-xl";
  const subtleBtnCls = isLight
    ? "bg-zinc-200/80 border-zinc-300 text-zinc-700 hover:bg-zinc-300 hover:text-zinc-950"
    : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-white";
  const primaryBtnCls = isLight
    ? "bg-zinc-900 text-white hover:bg-zinc-800"
    : "bg-white text-black hover:bg-zinc-200";

  return (
    <div className="w-full flex justify-center items-start pt-0">
      {/*
        FLAT SEAMLESS DYNAMIC ISLAND CONTAINER
        - Hover listeners strictly on this physical element (never the outer transparent window).
        - Scroll wheel adjusts system volume smoothly.
      */}
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheelVolume}
        className={`transition-all duration-200 ease-out overflow-hidden border ${
          isLight
            ? "bg-zinc-100/95 border-zinc-300 text-zinc-900 shadow-xl shadow-zinc-400/25"
            : "bg-zinc-950 border-zinc-800 text-white shadow-2xl shadow-black/90"
        } ${
          isHovered
            ? "w-[490px] h-[244px] rounded-2xl p-3.5"
            : "w-[420px] h-[36px] rounded-b-xl rounded-t-none border-t-0 px-3.5 py-1.5 cursor-pointer"
        } ${
          !isHovered && (isLight ? "hover:bg-zinc-200/90" : "hover:bg-zinc-900/95")
        }`}
      >
        {!isHovered ? (
          /* ========================================================= */
          /* IDLE BAR: PURE 3-COLUMN GRID (NO CLOCK ICON, NO MODE ICON)*/
          /* ========================================================= */
          <div
            className="w-full h-full grid grid-cols-[auto_1fr_auto] items-center gap-2.5 select-none"
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              if ((e.target as HTMLElement).closest("button")) return;
              onStartDrag();
            }}
          >
            {/* Col 1: Pure AM/PM Clock Text (e.g. 02:00 PM) — No Icon */}
            <span
              className={`text-[11px] font-semibold tabular-nums tracking-tight whitespace-nowrap ${
                isLight ? "text-zinc-900" : "text-white"
              }`}
            >
              {idleClockAmPm}
            </span>

            {/* Col 2: Context-Aware Center Slot */}
            <div
              className={`min-w-0 pl-2.5 border-l flex items-center gap-2 ${
                isLight ? "border-zinc-300" : "border-zinc-800"
              }`}
            >
              {showVolumeHud ? (
                /* Instant Volume Scroll HUD */
                <div className="w-full grid grid-cols-[auto_1fr_auto] items-center gap-2">
                  {renderVolumeIcon(`w-3.5 h-3.5 ${isLight ? "text-zinc-700" : "text-zinc-300"}`)}
                  <div className={`h-1.5 rounded-full overflow-hidden ${isLight ? "bg-zinc-300" : "bg-zinc-800"}`}>
                    <div
                      className={`h-full rounded-full transition-all duration-75 ${
                        volume.muted ? "bg-zinc-500" : isLight ? "bg-zinc-900" : "bg-white"
                      }`}
                      style={{ width: `${volume.muted ? 0 : volume.level}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono tabular-nums font-medium">
                    {volume.muted ? "Mute" : `${volume.level}%`}
                  </span>
                </div>
              ) : isTimerRunning || isTimerFinished ? (
                /* Active Timer Badge */
                <div className="flex items-center gap-1.5 min-w-0 truncate">
                  <Hourglass
                    className={`w-3.5 h-3.5 flex-shrink-0 ${
                      isTimerFinished ? "text-amber-500 animate-bounce" : isLight ? "text-zinc-700" : "text-zinc-300"
                    }`}
                  />
                  <span
                    className={`text-[11px] font-mono tabular-nums font-medium truncate ${
                      isTimerFinished ? "text-amber-500 font-bold" : isLight ? "text-zinc-900" : "text-white"
                    }`}
                  >
                    {isTimerFinished ? "Time's Up!" : formatTime(timerRemaining)}
                  </span>
                </div>
              ) : isStopwatchRunning ? (
                /* Active Stopwatch Badge */
                <div className="flex items-center gap-1.5 min-w-0 truncate">
                  <TimerIcon className={`w-3.5 h-3.5 flex-shrink-0 ${isLight ? "text-zinc-700" : "text-zinc-300"}`} />
                  <span className="text-[11px] font-mono tabular-nums font-medium truncate">
                    {formatStopwatch(stopwatchTimeMs)}
                  </span>
                </div>
              ) : media.isPlaying ? (
                /* Music Playing: Selected Audio Visualizer + Track Title */
                <div className="flex items-center gap-2 min-w-0 w-full">
                  <AudioVisualizer isPlaying={media.isPlaying} style={visualizerStyle} isLight={isLight} compact />
                  <span className={`text-[11px] font-medium truncate ${isLight ? "text-zinc-900" : "text-white"}`}>
                    {media.title || "Playing Audio"}
                  </span>
                </div>
              ) : weather ? (
                /* Idle with Weather Pill */
                <div className="flex items-center gap-1.5 min-w-0 truncate text-[11px]">
                  {renderWeatherIcon(weather.icon, `w-3.5 h-3.5 flex-shrink-0 ${isLight ? "text-zinc-700" : "text-zinc-300"}`)}
                  <span className="font-semibold tabular-nums">{weather.temperature}°C</span>
                  <span className={`truncate text-[10px] ${isLight ? "text-zinc-500" : "text-zinc-400"}`}>
                    {weather.city} • {weather.condition}
                  </span>
                </div>
              ) : (
                /* Idle Date Fallback */
                <span className={`text-[11px] truncate ${isLight ? "text-zinc-600" : "text-zinc-400"}`}>
                  {currentTime.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                </span>
              )}
            </div>

            {/* Col 3: Clean Lyrics Toggle Button ONLY (No Mode Icon) */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleLyricsWindow();
              }}
              className={`px-2 py-0.5 rounded text-[10px] font-medium flex items-center gap-1 transition-colors border ${
                isLyricsOpen
                  ? isLight
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "bg-white text-black border-white"
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
          /* EXPANDED MULTI-WIDGET HUB (STRICT GRID ARCHITECTURE)      */
          /* ========================================================= */
          <div className="w-full h-full grid grid-rows-[auto_1fr] gap-2.5 select-none">
            {/* ROW 1: NAVIGATION BAR */}
            <div
              className={`grid grid-cols-[1fr_auto] items-center gap-2 pb-2 border-b ${
                isLight ? "border-zinc-200" : "border-zinc-800"
              }`}
            >
              {/* Expanding Pill Tab Bar */}
              <div
                className={`flex items-center gap-0.5 p-0.5 rounded-lg border w-fit ${
                  isLight ? "bg-zinc-200/80 border-zinc-300" : "bg-zinc-900 border-zinc-800"
                }`}
              >
                {TABS.map(({ id, label, icon: Icon }) => {
                  const isActive = activeTab === id;
                  return (
                    <button
                      key={id}
                      onClick={() => setActiveTab(id)}
                      title={label}
                      className={`h-6 flex items-center justify-center gap-1.5 rounded-md text-[10px] transition-all ${
                        isActive
                          ? isLight
                            ? "px-2.5 bg-white text-zinc-900 shadow-sm font-semibold"
                            : "px-2.5 bg-zinc-800 text-white shadow-sm font-semibold"
                          : isLight
                            ? "w-7 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200"
                            : "w-7 text-zinc-400 hover:text-white hover:bg-zinc-800/60"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                      {isActive && <span className="whitespace-nowrap">{label}</span>}
                    </button>
                  );
                })}
              </div>

              {/* Right Utility Controls: Theme Mode Toggle & Drag Grip */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={onToggleTheme}
                  className={`h-7 w-7 flex items-center justify-center rounded-lg border transition-colors ${
                    isLight
                      ? "bg-zinc-200/80 border-zinc-300 text-zinc-700 hover:text-zinc-950 hover:bg-zinc-300"
                      : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800"
                  }`}
                  title={isLight ? "Switch to Dark Mode" : "Switch to Light Mode"}
                >
                  {isLight ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
                </button>

                <div
                  data-tauri-drag-region
                  className={`h-7 px-2 flex items-center gap-1 rounded-lg border cursor-grab active:cursor-grabbing transition-colors ${
                    isLight
                      ? "bg-zinc-200/80 border-zinc-300 text-zinc-600 hover:text-zinc-950 hover:bg-zinc-300"
                      : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800"
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

            {/* ROW 2: CONTENT GRID AREA */}
            <div className="min-h-0 h-full overflow-hidden">
              {/* ===================================================== */}
              {/* TAB 1: MUSIC PLAYER + VISUALIZER STYLES + VOLUME      */}
              {/* ===================================================== */}
              {activeTab === "music" && (
                <div className="w-full h-full grid grid-rows-[auto_auto_1fr] gap-2.5">
                  {/* Track Header Grid */}
                  <div className="grid grid-cols-[44px_1fr_auto] items-center gap-3">
                    <div
                      className={`w-11 h-11 rounded-xl overflow-hidden border flex items-center justify-center ${
                        isLight ? "bg-zinc-200 border-zinc-300" : "bg-zinc-900 border-zinc-800"
                      }`}
                    >
                      {media.thumbnail ? (
                        <img src={media.thumbnail} alt="Cover" className="w-full h-full object-cover" />
                      ) : (
                        <Music className={`w-5 h-5 ${isLight ? "text-zinc-500" : "text-zinc-600"}`} />
                      )}
                    </div>

                    <div className="min-w-0">
                      <h4 className="text-xs font-semibold truncate" title={media.title}>
                        {media.title || "No media playing"}
                      </h4>
                      <p className={`text-[10px] truncate mt-0.5 ${isLight ? "text-zinc-500" : "text-zinc-400"}`} title={media.artist}>
                        {media.artist || "Play audio in YouTube, Spotify, or browser"}
                      </p>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <AudioVisualizer isPlaying={media.isPlaying} style={visualizerStyle} isLight={isLight} />
                      <button
                        onClick={onToggleLyricsWindow}
                        className={`h-7 px-2.5 rounded-lg text-[10px] font-medium flex items-center gap-1 transition-colors border ${
                          isLyricsOpen
                            ? isLight
                              ? "bg-zinc-900 text-white border-zinc-900"
                              : "bg-white text-black border-white"
                            : subtleBtnCls
                        }`}
                        title="Toggle Full Lyrics Window"
                      >
                        <FileText className="w-3 h-3" />
                        <span>{isLyricsOpen ? "Close" : "Lyrics"}</span>
                      </button>
                    </div>
                  </div>

                  {/* Seekbar */}
                  <div className="flex flex-col gap-1">
                    <div
                      className={`relative w-full h-1.5 rounded-full cursor-pointer transition-all ${
                        isLight ? "bg-zinc-300" : "bg-zinc-800"
                      }`}
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                        onSeek(ratio * media.durationSec);
                      }}
                    >
                      <div
                        className={`h-full rounded-full ${isLight ? "bg-zinc-900" : "bg-white"}`}
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[9px] font-mono tabular-nums text-zinc-500">
                      <span>{formatTime(media.positionSec)}</span>
                      <span>{formatTime(media.durationSec)}</span>
                    </div>
                  </div>

                  {/* Bottom 12-Col Control Grid: Visualizer Style | Playback | Volume */}
                  <div className="grid grid-cols-12 items-center gap-2 self-end pb-0.5">
                    {/* Left (4 cols): Visualizer Style Switcher */}
                    <div
                      className={`col-span-4 grid grid-cols-3 p-0.5 rounded-lg border text-[9px] font-medium ${
                        isLight ? "bg-zinc-200/80 border-zinc-300" : "bg-zinc-900 border-zinc-800"
                      }`}
                    >
                      {(["bars", "wave", "dots"] as VisualizerStyle[]).map((style) => (
                        <button
                          key={style}
                          onClick={() => handleSetVisualizer(style)}
                          className={`py-1 rounded capitalize transition-colors ${
                            visualizerStyle === style
                              ? isLight
                                ? "bg-white text-zinc-900 font-semibold shadow-sm"
                                : "bg-zinc-800 text-white font-semibold"
                              : isLight
                                ? "text-zinc-600 hover:text-zinc-900"
                                : "text-zinc-400 hover:text-white"
                          }`}
                          title={`Visualizer style: ${style}`}
                        >
                          {style}
                        </button>
                      ))}
                    </div>

                    {/* Center (4 cols): Playback Transport */}
                    <div className="col-span-4 flex items-center justify-center gap-1.5">
                      <button
                        onClick={onPrev}
                        className={`p-1 transition-colors ${isLight ? "text-zinc-600 hover:text-zinc-950" : "text-zinc-400 hover:text-white"}`}
                        title="Previous Track"
                      >
                        <SkipBack className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onSeek(Math.max(0, media.positionSec - 10))}
                        className={`p-1 transition-colors ${isLight ? "text-zinc-500 hover:text-zinc-950" : "text-zinc-500 hover:text-white"}`}
                        title="Rewind 10s"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                      <button
                        onClick={onTogglePlayPause}
                        className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${primaryBtnCls}`}
                        title={media.isPlaying ? "Pause" : "Play"}
                      >
                        {media.isPlaying ? (
                          <Pause className={`w-3.5 h-3.5 ${isLight ? "fill-white" : "fill-black"}`} />
                        ) : (
                          <Play className={`w-3.5 h-3.5 translate-x-[0.5px] ${isLight ? "fill-white" : "fill-black"}`} />
                        )}
                      </button>
                      <button
                        onClick={() => onSeek(Math.min(media.durationSec, media.positionSec + 10))}
                        className={`p-1 transition-colors ${isLight ? "text-zinc-500 hover:text-zinc-950" : "text-zinc-500 hover:text-white"}`}
                        title="Forward 10s"
                      >
                        <RotateCw className="w-3 h-3" />
                      </button>
                      <button
                        onClick={onNext}
                        className={`p-1 transition-colors ${isLight ? "text-zinc-600 hover:text-zinc-950" : "text-zinc-400 hover:text-white"}`}
                        title="Next Track"
                      >
                        <SkipForward className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Right (4 cols): Master Volume Control */}
                    <div className="col-span-4 grid grid-cols-[auto_1fr_auto] items-center gap-1.5 pl-1">
                      <button
                        onClick={handleToggleMute}
                        className={`p-1 rounded transition-colors ${isLight ? "text-zinc-700 hover:bg-zinc-200" : "text-zinc-300 hover:bg-zinc-800"}`}
                        title={volume.muted ? "Unmute" : "Mute"}
                      >
                        {renderVolumeIcon("w-3.5 h-3.5")}
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={volume.muted ? 0 : volume.level}
                        onChange={(e) => handleSetVolume(Number(e.target.value))}
                        className={`w-full h-1 rounded-lg appearance-none cursor-pointer ${
                          isLight ? "bg-zinc-300 accent-zinc-900" : "bg-zinc-700 accent-white"
                        }`}
                        title="Master Volume (or scroll on island)"
                      />
                      <span className="text-[9px] font-mono tabular-nums text-zinc-500 w-7 text-right">
                        {volume.muted ? "0%" : `${volume.level}%`}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* ===================================================== */}
              {/* TAB 2: CLOCK & CALENDAR (12-COL GRID)                 */}
              {/* ===================================================== */}
              {activeTab === "clock" && (
                <div className="w-full h-full grid grid-cols-12 gap-3 items-stretch">
                  {/* Left (5 cols): AM/PM Digital Clock & Info */}
                  <div className={`col-span-5 p-3 flex flex-col justify-between ${cardCls}`}>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Local Time</div>
                      <div className="text-xl font-mono font-bold tabular-nums tracking-tight mt-1 leading-none">
                        {fullClockAmPm}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className={`text-[11px] font-medium ${isLight ? "text-zinc-800" : "text-zinc-200"}`}>
                        {currentTime.toLocaleDateString("en-US", { weekday: "long" })}
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        {currentTime.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                      </div>
                    </div>

                    <div className={`pt-2 border-t text-[9px] text-zinc-500 truncate ${isLight ? "border-zinc-200" : "border-zinc-800"}`}>
                      {Intl.DateTimeFormat().resolvedOptions().timeZone}
                    </div>
                  </div>

                  {/* Right (7 cols): Mini Monthly Calendar */}
                  <div className={`col-span-7 p-2.5 flex flex-col justify-between ${cardCls}`}>
                    <div className="grid grid-cols-[auto_1fr_auto] items-center text-[10px] font-semibold mb-1">
                      <button
                        onClick={() => setCalendarMonthOffset(prev => prev - 1)}
                        className={`p-0.5 rounded ${isLight ? "text-zinc-600 hover:bg-zinc-100" : "text-zinc-400 hover:bg-zinc-800"}`}
                        title="Previous Month"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-center">{currentMonthName}</span>
                      <button
                        onClick={() => setCalendarMonthOffset(prev => prev + 1)}
                        className={`p-0.5 rounded ${isLight ? "text-zinc-600 hover:bg-zinc-100" : "text-zinc-400 hover:bg-zinc-800"}`}
                        title="Next Month"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-7 text-center text-[9px] font-medium text-zinc-500 mb-0.5">
                      <span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>
                    </div>

                    <div className="grid grid-cols-7 gap-y-0.5 text-center text-[9px] tabular-nums">
                      {Array.from({ length: firstDayWeekday }).map((_, i) => (
                        <span key={`empty-${i}`} className="text-transparent">.</span>
                      ))}
                      {Array.from({ length: daysInMonth }).map((_, i) => {
                        const dayNum = i + 1;
                        const isToday = isCurrentViewingMonth && dayNum === currentTime.getDate();
                        return (
                          <span
                            key={`day-${dayNum}`}
                            className={`h-4 flex items-center justify-center rounded-full ${
                              isToday
                                ? isLight
                                  ? "bg-zinc-900 text-white font-bold"
                                  : "bg-white text-black font-bold"
                                : isLight
                                  ? "text-zinc-700 hover:bg-zinc-100"
                                  : "text-zinc-300 hover:bg-zinc-800"
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
              {/* TAB 3: COUNTDOWN TIMER (12-COL GRID)                  */}
              {/* ===================================================== */}
              {activeTab === "timer" && (
                <div className="w-full h-full grid grid-cols-12 gap-3 items-stretch">
                  {/* Left (5 cols): Display & Fine Adjustments */}
                  <div className={`col-span-5 p-3 flex flex-col justify-between ${cardCls}`}>
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Countdown</span>
                        <span className={`text-[9px] font-semibold ${isTimerFinished ? "text-amber-500" : "text-zinc-500"}`}>
                          {isTimerFinished ? "Done" : isTimerRunning ? "Active" : "Ready"}
                        </span>
                      </div>
                      <div
                        className={`text-3xl font-mono font-bold tabular-nums mt-1.5 leading-none ${
                          isTimerFinished ? "text-amber-500 animate-pulse" : ""
                        }`}
                      >
                        {formatTime(timerRemaining)}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-1">
                      <button
                        onClick={() => handleAdjustTimer(-60)}
                        className={`py-1 rounded-md border text-[10px] font-mono transition-colors ${subtleBtnCls}`}
                      >
                        -1m
                      </button>
                      <button
                        onClick={() => handleAdjustTimer(60)}
                        className={`py-1 rounded-md border text-[10px] font-mono transition-colors ${subtleBtnCls}`}
                      >
                        +1m
                      </button>
                      <button
                        onClick={() => handleAdjustTimer(10)}
                        className={`py-1 rounded-md border text-[10px] font-mono transition-colors ${subtleBtnCls}`}
                      >
                        +10s
                      </button>
                    </div>
                  </div>

                  {/* Right (7 cols): 2x2 Presets, Progress & Actions */}
                  <div className="col-span-7 flex flex-col justify-between gap-2">
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
                            className={`py-2 rounded-lg text-[11px] font-medium transition-colors border ${
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
                        className={`h-full transition-all duration-300 ${
                          isTimerFinished ? "bg-amber-500" : isLight ? "bg-zinc-900" : "bg-white"
                        }`}
                        style={{
                          width: `${timerDuration > 0 ? ((timerDuration - timerRemaining) / timerDuration) * 100 : 0}%`,
                        }}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        onClick={handleStartPauseTimer}
                        className={`py-1.5 rounded-lg font-semibold text-xs transition-colors ${primaryBtnCls}`}
                      >
                        {isTimerRunning ? "Pause" : timerRemaining === 0 ? "Restart" : "Start"}
                      </button>
                      <button
                        onClick={handleResetTimer}
                        className={`py-1.5 rounded-lg text-xs font-medium transition-colors border ${subtleBtnCls}`}
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ===================================================== */}
              {/* TAB 4: STOPWATCH (12-COL GRID)                        */}
              {/* ===================================================== */}
              {activeTab === "stopwatch" && (
                <div className="w-full h-full grid grid-cols-12 gap-3 items-stretch">
                  {/* Left (5 cols): Main Counter & Controls */}
                  <div className={`col-span-5 p-3 flex flex-col justify-between ${cardCls}`}>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Stopwatch</div>
                      <div className="text-2xl font-mono font-bold tabular-nums tracking-tight mt-1.5 leading-none">
                        {formatStopwatch(stopwatchTimeMs)}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <button
                        onClick={handleToggleStopwatch}
                        className={`w-full py-1.5 rounded-lg font-semibold text-xs transition-colors ${primaryBtnCls}`}
                      >
                        {isStopwatchRunning ? "Pause" : "Start"}
                      </button>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          onClick={handleLapStopwatch}
                          disabled={!isStopwatchRunning}
                          className={`py-1 rounded-lg text-[10px] font-medium disabled:opacity-40 transition-colors border flex items-center justify-center gap-1 ${subtleBtnCls}`}
                        >
                          <Flag className="w-3 h-3" />
                          <span>Lap</span>
                        </button>
                        <button
                          onClick={handleResetStopwatch}
                          className={`py-1 rounded-lg text-[10px] font-medium transition-colors border ${subtleBtnCls}`}
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Right (7 cols): Scrollable Laps Grid */}
                  <div className={`col-span-7 p-2.5 flex flex-col overflow-hidden ${cardCls}`}>
                    <div className="flex items-center justify-between text-[10px] text-zinc-500 font-medium pb-1.5 border-b border-zinc-800/40">
                      <span>Lap Splits</span>
                      <span className="font-mono tabular-nums">{stopwatchLaps.length} laps</span>
                    </div>

                    <div className="scrollable-area flex-1 overflow-y-auto pt-1.5 space-y-1 font-mono tabular-nums text-[11px]">
                      {stopwatchLaps.length === 0 ? (
                        <div className="w-full h-full flex items-center justify-center text-zinc-500 text-[10px] font-sans">
                          Press Lap while running to record splits
                        </div>
                      ) : (
                        stopwatchLaps.map((lapMs, idx) => (
                          <div
                            key={idx}
                            className={`grid grid-cols-2 items-center px-2 py-1 rounded ${
                              isLight ? "bg-zinc-100 text-zinc-700" : "bg-zinc-950/60 text-zinc-300"
                            }`}
                          >
                            <span className="text-[10px] text-zinc-500">Lap #{stopwatchLaps.length - idx}</span>
                            <span className="text-right font-semibold">{formatStopwatch(lapMs)}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ===================================================== */}
              {/* TAB 5: WEATHER & TEMPERATURE (12-COL GRID)            */}
              {/* ===================================================== */}
              {activeTab === "weather" && (
                <div className="w-full h-full grid grid-cols-12 gap-3 items-stretch">
                  {/* Left (5 cols): Main Condition Card */}
                  <div className={`col-span-5 p-3 flex flex-col justify-between ${cardCls}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        {renderWeatherIcon(
                          weather?.icon || "cloud-sun",
                          `w-6 h-6 ${isLight ? "text-zinc-900" : "text-white"}`
                        )}
                        <span className="text-2xl font-bold tabular-nums leading-none">
                          {weather ? `${weather.temperature}°C` : "--°C"}
                        </span>
                      </div>
                      <button
                        onClick={() => loadWeather()}
                        disabled={weatherLoading}
                        className={`p-1 rounded-md transition-colors ${isLight ? "text-zinc-500 hover:bg-zinc-100" : "text-zinc-400 hover:bg-zinc-800"}`}
                        title="Refresh Weather"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${weatherLoading ? "animate-spin" : ""}`} />
                      </button>
                    </div>

                    <div>
                      <div className="text-xs font-semibold truncate">
                        {weather ? weather.city : weatherLoading ? "Detecting..." : "Unavailable"}
                      </div>
                      <div className="text-[10px] text-zinc-500 truncate mt-0.5">
                        {weatherError || (weather ? weather.condition : "Auto-detecting location")}
                      </div>
                    </div>

                    <div className={`pt-1.5 border-t text-[9px] text-zinc-500 ${isLight ? "border-zinc-200" : "border-zinc-800"}`}>
                      Powered by Open-Meteo
                    </div>
                  </div>

                  {/* Right (7 cols): City Search + 2x2 Metrics Grid */}
                  <div className="col-span-7 flex flex-col justify-between gap-2">
                    <form onSubmit={handleSearchWeatherCity} className="grid grid-cols-[1fr_auto] gap-1.5">
                      <div className="relative">
                        <input
                          type="text"
                          value={weatherCityInput}
                          onChange={(e) => setWeatherCityInput(e.target.value)}
                          placeholder="Change city (e.g. Tokyo, Jakarta)..."
                          className={`w-full h-7 text-[10px] rounded-lg pl-7 pr-2 border focus:outline-none ${
                            isLight
                              ? "bg-white border-zinc-300 text-zinc-900 placeholder-zinc-400"
                              : "bg-zinc-900 border-zinc-800 text-white placeholder-zinc-500"
                          }`}
                        />
                        <Search className="w-3 h-3 text-zinc-500 absolute left-2.5 top-2" />
                      </div>
                      <button
                        type="submit"
                        className={`h-7 px-2.5 rounded-lg text-[10px] font-semibold transition-colors ${primaryBtnCls}`}
                      >
                        Set
                      </button>
                    </form>

                    {/* 2x2 Metrics Grid */}
                    <div className="grid grid-cols-2 grid-rows-2 gap-1.5 flex-1">
                      <div className={`p-2 flex flex-col justify-between ${cardCls}`}>
                        <div className="flex items-center gap-1 text-[9px] text-zinc-500">
                          <Thermometer className="w-3 h-3" />
                          <span>Feels Like</span>
                        </div>
                        <div className="text-xs font-semibold tabular-nums">
                          {weather ? `${weather.feelsLike}°C` : "--"}
                        </div>
                      </div>

                      <div className={`p-2 flex flex-col justify-between ${cardCls}`}>
                        <div className="flex items-center gap-1 text-[9px] text-zinc-500">
                          <Droplets className="w-3 h-3" />
                          <span>Humidity</span>
                        </div>
                        <div className="text-xs font-semibold tabular-nums">
                          {weather ? `${weather.humidity}%` : "--"}
                        </div>
                      </div>

                      <div className={`p-2 flex flex-col justify-between ${cardCls}`}>
                        <div className="flex items-center gap-1 text-[9px] text-zinc-500">
                          <Wind className="w-3 h-3" />
                          <span>Wind</span>
                        </div>
                        <div className="text-xs font-semibold tabular-nums">
                          {weather ? `${weather.windSpeed} km/h` : "--"}
                        </div>
                      </div>

                      <div className={`p-2 flex flex-col justify-between ${cardCls}`}>
                        <div className="flex items-center gap-1 text-[9px] text-zinc-500">
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
              {/* TAB 6: QUICK SCRATCHPAD / NOTES                       */}
              {/* ===================================================== */}
              {activeTab === "notes" && (
                <div className="w-full h-full grid grid-rows-[1fr_auto] gap-2">
                  <textarea
                    value={notesText}
                    onChange={(e) => handleNotesChange(e.target.value)}
                    placeholder="Type quick notes, reminders, or paste snippets here... (Auto-saved)"
                    className={`w-full h-full resize-none rounded-xl border p-2.5 text-xs leading-relaxed focus:outline-none select-text ${
                      isLight
                        ? "bg-white border-zinc-300 text-zinc-900 placeholder-zinc-400 focus:border-zinc-500"
                        : "bg-zinc-900/90 border-zinc-800 text-zinc-100 placeholder-zinc-500 focus:border-zinc-600"
                    }`}
                  />

                  <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                    <span className="text-[10px] text-zinc-500 font-mono tabular-nums">
                      {wordCount} words • {notesText.length} chars • Saved locally
                    </span>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={handleCopyNotes}
                        disabled={!notesText}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-medium border transition-colors flex items-center gap-1 disabled:opacity-40 ${subtleBtnCls}`}
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
                        className={`px-2 py-1 rounded-lg text-[10px] font-medium border transition-colors flex items-center gap-1 disabled:opacity-40 ${subtleBtnCls}`}
                        title="Clear Scratchpad"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Clear</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ===================================================== */}
              {/* TAB 7: SYSTEM MONITOR (CPU/RAM) + VOLUME + AUTOSTART  */}
              {/* ===================================================== */}
              {activeTab === "system" && (
                <div className="w-full h-full grid grid-cols-12 gap-3 items-stretch">
                  {/* Left (7 cols): CPU & RAM Real-Time Hardware Cards */}
                  <div className="col-span-7 grid grid-rows-2 gap-2">
                    {/* CPU Card */}
                    <div className={`p-2.5 flex flex-col justify-between ${cardCls}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Cpu className="w-3.5 h-3.5 text-zinc-500" />
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                            CPU Load
                          </span>
                        </div>
                        <span className="text-xs font-mono font-bold tabular-nums">
                          {sysStats.cpuPercent.toFixed(1)}%
                        </span>
                      </div>

                      {/* 14-Bar Live CPU History Sparkline */}
                      <div className="grid grid-cols-14 gap-1 items-end h-5 pt-1" style={{ gridTemplateColumns: "repeat(14, minmax(0, 1fr))" }}>
                        {cpuHistory.map((val, idx) => (
                          <div
                            key={idx}
                            className={`rounded-sm transition-all duration-300 ${
                              isLight ? "bg-zinc-800" : "bg-zinc-300"
                            }`}
                            style={{
                              height: `${Math.max(15, Math.min(100, val))}%`,
                              opacity: 0.35 + (idx / cpuHistory.length) * 0.65,
                            }}
                          />
                        ))}
                      </div>
                    </div>

                    {/* RAM Card */}
                    <div className={`p-2.5 flex flex-col justify-between ${cardCls}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                          Memory (RAM)
                        </span>
                        <span className="text-xs font-mono font-bold tabular-nums">
                          {sysStats.ramPercent.toFixed(1)}%
                        </span>
                      </div>

                      <div className="space-y-1">
                        <div className={`w-full h-1.5 rounded-full overflow-hidden ${isLight ? "bg-zinc-200" : "bg-zinc-800"}`}>
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${isLight ? "bg-zinc-900" : "bg-white"}`}
                            style={{ width: `${Math.min(100, sysStats.ramPercent)}%` }}
                          />
                        </div>
                        <div className="text-[9px] font-mono tabular-nums text-zinc-500 flex justify-between">
                          <span>{sysStats.ramUsedGb.toFixed(1)} GB used</span>
                          <span>{sysStats.ramTotalGb.toFixed(1)} GB total</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right (5 cols): Master Volume & Windows Auto-Start */}
                  <div className="col-span-5 grid grid-rows-2 gap-2">
                    {/* Volume Card */}
                    <div className={`p-2.5 flex flex-col justify-between ${cardCls}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                          Volume
                        </span>
                        <span className="text-[11px] font-mono font-bold tabular-nums">
                          {volume.muted ? "Muted" : `${volume.level}%`}
                        </span>
                      </div>

                      <div className="grid grid-cols-[auto_1fr] items-center gap-2">
                        <button
                          onClick={handleToggleMute}
                          className={`p-1 rounded transition-colors ${isLight ? "text-zinc-700 hover:bg-zinc-100" : "text-zinc-300 hover:bg-zinc-800"}`}
                          title={volume.muted ? "Unmute" : "Mute"}
                        >
                          {renderVolumeIcon("w-3.5 h-3.5")}
                        </button>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={volume.muted ? 0 : volume.level}
                          onChange={(e) => handleSetVolume(Number(e.target.value))}
                          className={`w-full h-1.5 rounded-lg appearance-none cursor-pointer ${
                            isLight ? "bg-zinc-300 accent-zinc-900" : "bg-zinc-700 accent-white"
                          }`}
                        />
                      </div>
                    </div>

                    {/* Auto-Start on Windows Boot Card */}
                    <div className={`p-2.5 flex flex-col justify-between ${cardCls}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Power className="w-3.5 h-3.5 text-zinc-500" />
                          <span className="text-[10px] font-semibold">Auto-Start</span>
                        </div>

                        <button
                          onClick={handleToggleAutostart}
                          disabled={autostartBusy}
                          className={`w-8 h-4 rounded-full p-0.5 transition-colors flex items-center ${
                            autostartEnabled
                              ? isLight
                                ? "bg-zinc-900 justify-end"
                                : "bg-white justify-end"
                              : isLight
                                ? "bg-zinc-300 justify-start"
                                : "bg-zinc-700 justify-start"
                          }`}
                          title="Launch MS Island automatically when Windows starts"
                        >
                          <div
                            className={`w-3 h-3 rounded-full transition-transform ${
                              autostartEnabled
                                ? isLight
                                  ? "bg-white"
                                  : "bg-black"
                                : isLight
                                  ? "bg-white"
                                  : "bg-zinc-300"
                            }`}
                          />
                        </button>
                      </div>

                      <div className="text-[9px] text-zinc-500 leading-tight">
                        {autostartEnabled ? "Enabled on Windows boot" : "Launch on Windows startup"}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
