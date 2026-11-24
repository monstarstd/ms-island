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
  Calendar as CalendarIcon,
  Timer as TimerIcon,
  Hourglass,
  ChevronLeft,
  ChevronRight,
  Flag,
  GripHorizontal,
  Sun,
  Moon
} from "lucide-react";
import { MediaTrack } from "../types/media";
import { ThemeMode } from "../types/theme";

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

type TabType = "music" | "clock" | "timer" | "stopwatch";

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

  const isLight = theme === "light";

  // -------------------------------------------------------------
  // 1. Dynamic Beat-Synced Equalizer (8 Frequency Bands)
  // -------------------------------------------------------------
  const [eqHeights, setEqHeights] = useState<number[]>([3, 5, 8, 12, 10, 7, 5, 3]);

  useEffect(() => {
    if (!media.isPlaying) {
      setEqHeights([2, 2, 2, 2, 2, 2, 2, 2]);
      return;
    }

    const interval = setInterval(() => {
      const t = Date.now() / 120;
      setEqHeights([
        Math.floor(3 + Math.abs(Math.sin(t * 1.1)) * 9 + Math.random() * 3),
        Math.floor(5 + Math.abs(Math.cos(t * 0.9)) * 11 + Math.random() * 4),
        Math.floor(8 + Math.abs(Math.sin(t * 1.5)) * 13 + Math.random() * 4),
        Math.floor(6 + Math.abs(Math.cos(t * 1.8)) * 14 + Math.random() * 5),
        Math.floor(9 + Math.abs(Math.sin(t * 1.3)) * 12 + Math.random() * 4),
        Math.floor(7 + Math.abs(Math.cos(t * 1.6)) * 10 + Math.random() * 4),
        Math.floor(4 + Math.abs(Math.sin(t * 2.0)) * 8 + Math.random() * 3),
        Math.floor(3 + Math.abs(Math.cos(t * 2.2)) * 7 + Math.random() * 3),
      ]);
    }, 75);

    return () => clearInterval(interval);
  }, [media.isPlaying]);

  // -------------------------------------------------------------
  // 2. Real-Time Clock & Date State
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
  // 3. Countdown Timer State
  // -------------------------------------------------------------
  const [timerDuration, setTimerDuration] = useState<number>(300); // default 5m
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
  // 4. Millisecond Stopwatch State
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
  // Hover Handlers strictly bound to inner pill element
  // -------------------------------------------------------------
  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    hoverTimeoutRef.current = window.setTimeout(() => {
      setIsHovered(false);
    }, 250);
  };

  // -------------------------------------------------------------
  // Formatting Helpers
  // -------------------------------------------------------------
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

  const progressPercent = media.durationSec > 0 
    ? Math.min(100, Math.max(0, (media.positionSec / media.durationSec) * 100))
    : 0;

  // Calendar calculations
  const displayCalendarDate = new Date(currentTime.getFullYear(), currentTime.getMonth() + calendarMonthOffset, 1);
  const currentMonthName = displayCalendarDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const daysInMonth = new Date(displayCalendarDate.getFullYear(), displayCalendarDate.getMonth() + 1, 0).getDate();
  const firstDayWeekday = new Date(displayCalendarDate.getFullYear(), displayCalendarDate.getMonth(), 1).getDay();
  const isCurrentViewingMonth = calendarMonthOffset === 0;

  const clockString = currentTime.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const shortClockString = currentTime.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <div className="w-full flex justify-center items-start pt-0">
      {/* 
        FLAT SEAMLESS DYNAMIC ISLAND CONTAINER
        Mouse hover listeners are EXCLUSIVELY on this element so hover never triggers outside the island.
      */}
      <div 
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`transition-all duration-200 ease-out overflow-hidden border ${
          isLight
            ? "bg-zinc-100/95 border-zinc-300 text-zinc-900 shadow-xl shadow-zinc-400/25"
            : "bg-zinc-950 border-zinc-800 text-white shadow-2xl shadow-black/90"
        } ${
          isHovered
            ? "w-[440px] h-[215px] rounded-2xl p-3.5"
            : "w-[400px] h-[36px] rounded-b-xl rounded-t-none border-t-0 px-3 py-1.5 cursor-pointer flex items-center justify-between"
        } ${
          !isHovered && (isLight ? "hover:bg-zinc-200/90" : "hover:bg-zinc-900/95")
        }`}
      >
        {!isHovered ? (
          /* ========================================================= */
          /* SMART IDLE NOTCH (CLOCK IS ALWAYS PROMINENTLY VISIBLE)   */
          /* ========================================================= */
          <div 
            className="w-full h-full flex items-center justify-between select-none"
            onMouseDown={onStartDrag}
          >
            {/* 1. ALWAYS VISIBLE: Real-Time Digital Clock */}
            <div className="flex items-center gap-1.5 flex-shrink-0 pr-1.5 border-r border-zinc-700/40">
              <Clock className={`w-3.5 h-3.5 ${isLight ? "text-zinc-600" : "text-zinc-400"}`} />
              <span className={`text-[11px] font-mono font-bold tracking-tight ${isLight ? "text-zinc-900" : "text-white"}`}>
                {shortClockString}
              </span>
            </div>

            {/* 2. DYNAMIC CENTER: Context-Aware Status */}
            <div className="flex-1 flex items-center gap-2 min-w-0 px-2">
              {/* Scenario A: Countdown Timer Active */}
              {isTimerRunning || isTimerFinished ? (
                <div className="flex items-center gap-1.5 min-w-0 truncate">
                  <Hourglass className={`w-3.5 h-3.5 flex-shrink-0 ${isTimerFinished ? "text-amber-500 animate-bounce" : isLight ? "text-zinc-700" : "text-zinc-300"}`} />
                  <span className={`text-[11px] font-mono font-medium truncate ${isTimerFinished ? "text-amber-500 font-bold" : isLight ? "text-zinc-800" : "text-white"}`}>
                    {isTimerFinished ? "Timer Done!" : `Timer: ${formatTime(timerRemaining)}`}
                  </span>
                </div>
              ) : isStopwatchRunning ? (
                /* Scenario B: Stopwatch Active */
                <div className="flex items-center gap-1.5 min-w-0 truncate">
                  <TimerIcon className={`w-3.5 h-3.5 flex-shrink-0 ${isLight ? "text-zinc-700" : "text-zinc-300"}`} />
                  <span className={`text-[11px] font-mono font-medium truncate ${isLight ? "text-zinc-800" : "text-white"}`}>
                    {formatStopwatch(stopwatchTimeMs)}
                  </span>
                </div>
              ) : media.isPlaying ? (
                /* Scenario C: Music Playing -> Dynamic Beat-Synced Equalizer + Title */
                <div className="flex items-center gap-2 min-w-0 truncate">
                  <div className="flex items-end gap-[2px] h-3.5 w-7 flex-shrink-0">
                    {eqHeights.slice(0, 6).map((h, i) => (
                      <div 
                        key={i} 
                        className={`w-[2px] rounded-full transition-all duration-75 ${isLight ? "bg-zinc-900" : "bg-white"}`}
                        style={{ height: `${Math.min(14, h)}px` }}
                      />
                    ))}
                  </div>

                  <span className={`text-[11px] font-medium truncate ${isLight ? "text-zinc-900" : "text-white"}`}>
                    {media.title || "Playing Audio"}
                  </span>
                </div>
              ) : (
                /* Scenario D: Idle -> Date Display */
                <div className="flex items-center gap-1.5 text-[10px] truncate">
                  <CalendarIcon className={`w-3 h-3 flex-shrink-0 ${isLight ? "text-zinc-500" : "text-zinc-500"}`} />
                  <span className={`truncate ${isLight ? "text-zinc-600" : "text-zinc-400"}`}>
                    {currentTime.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                  </span>
                </div>
              )}
            </div>

            {/* 3. RIGHT ACTIONS: Lyrics Button & Quick Theme Toggle */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleLyricsWindow();
                }}
                className={`px-2 py-0.5 rounded text-[10px] font-medium flex items-center gap-1 transition-colors border ${
                  isLyricsOpen 
                    ? (isLight ? "bg-zinc-900 text-white border-zinc-900" : "bg-white text-black border-white") 
                    : (isLight ? "bg-zinc-200 text-zinc-700 hover:text-black hover:bg-zinc-300 border-zinc-300" : "bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700 border-zinc-700")
                }`}
                title="Toggle Full Lyrics Window"
              >
                <FileText className="w-3 h-3" />
                <span>Lyrics</span>
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleTheme();
                }}
                className={`p-1 rounded transition-colors ${
                  isLight 
                    ? "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200" 
                    : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                }`}
                title={isLight ? "Switch to Dark Mode" : "Switch to Light Mode"}
              >
                {isLight ? <Moon className="w-3 h-3" /> : <Sun className="w-3 h-3" />}
              </button>
            </div>
          </div>
        ) : (
          /* ========================================================= */
          /* EXPANDED MULTI-WIDGET HUB                                 */
          /* ========================================================= */
          <div className="w-full h-full flex flex-col justify-between select-none">
            {/* Top Bar: Tabs, Theme Toggle & Window Drag */}
            <div className={`flex items-center justify-between border-b pb-2 ${isLight ? "border-zinc-200" : "border-zinc-800"}`}>
              {/* Widget Tabs */}
              <div className={`flex items-center gap-0.5 p-0.5 rounded-lg border ${isLight ? "bg-zinc-200/80 border-zinc-300" : "bg-zinc-900 border-zinc-800"}`}>
                <button
                  onClick={() => setActiveTab("music")}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                    activeTab === "music"
                      ? (isLight ? "bg-white text-zinc-900 shadow-sm font-semibold" : "bg-zinc-800 text-white shadow-sm font-semibold")
                      : (isLight ? "text-zinc-600 hover:text-zinc-900" : "text-zinc-400 hover:text-white")
                  }`}
                >
                  <Music className="w-3 h-3" />
                  <span>Music</span>
                </button>

                <button
                  onClick={() => setActiveTab("clock")}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                    activeTab === "clock"
                      ? (isLight ? "bg-white text-zinc-900 shadow-sm font-semibold" : "bg-zinc-800 text-white shadow-sm font-semibold")
                      : (isLight ? "text-zinc-600 hover:text-zinc-900" : "text-zinc-400 hover:text-white")
                  }`}
                >
                  <Clock className="w-3 h-3" />
                  <span>Clock</span>
                </button>

                <button
                  onClick={() => setActiveTab("timer")}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                    activeTab === "timer"
                      ? (isLight ? "bg-white text-zinc-900 shadow-sm font-semibold" : "bg-zinc-800 text-white shadow-sm font-semibold")
                      : (isLight ? "text-zinc-600 hover:text-zinc-900" : "text-zinc-400 hover:text-white")
                  }`}
                >
                  <Hourglass className="w-3 h-3" />
                  <span>Timer</span>
                </button>

                <button
                  onClick={() => setActiveTab("stopwatch")}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                    activeTab === "stopwatch"
                      ? (isLight ? "bg-white text-zinc-900 shadow-sm font-semibold" : "bg-zinc-800 text-white shadow-sm font-semibold")
                      : (isLight ? "text-zinc-600 hover:text-zinc-900" : "text-zinc-400 hover:text-white")
                  }`}
                >
                  <TimerIcon className="w-3 h-3" />
                  <span>Stopwatch</span>
                </button>
              </div>

              {/* Top Right Controls: Theme Toggle + Drag Handle */}
              <div className="flex items-center gap-1">
                {/* Theme Toggle Button */}
                <button
                  onClick={onToggleTheme}
                  className={`p-1.5 rounded-lg border transition-colors ${
                    isLight 
                      ? "bg-zinc-200/80 border-zinc-300 text-zinc-700 hover:text-zinc-900 hover:bg-zinc-300" 
                      : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800"
                  }`}
                  title={isLight ? "Switch to Dark Mode" : "Switch to Light Mode"}
                >
                  {isLight ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
                </button>

                {/* Drag Handle */}
                <div 
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg border cursor-grab active:cursor-grabbing transition-colors ${
                    isLight
                      ? "bg-zinc-200/80 border-zinc-300 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-300"
                      : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800"
                  }`}
                  onMouseDown={onStartDrag}
                  title="Click and drag to move Dynamic Island"
                >
                  <GripHorizontal className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-medium">Drag</span>
                </div>
              </div>
            </div>

            {/* TAB CONTENTS */}
            <div className="flex-1 flex flex-col justify-center py-1 overflow-hidden">
              {/* ===================================================== */}
              {/* TAB 1: MUSIC PLAYER                                   */}
              {/* ===================================================== */}
              {activeTab === "music" && (
                <div className="w-full flex flex-col justify-between h-full pt-1">
                  {/* Track Info + Lyrics Toggle */}
                  <div className="flex items-center justify-between gap-3">
                    <div className={`w-10 h-10 rounded-lg overflow-hidden border flex-shrink-0 flex items-center justify-center ${
                      isLight ? "bg-zinc-200 border-zinc-300" : "bg-zinc-900 border-zinc-800"
                    }`}>
                      {media.thumbnail ? (
                        <img src={media.thumbnail} alt="Cover" className="w-full h-full object-cover" />
                      ) : (
                        <Music className={`w-5 h-5 ${isLight ? "text-zinc-500" : "text-zinc-600"}`} />
                      )}
                    </div>

                    <div className="flex-1 min-w-0 pr-1">
                      <h4 className={`text-xs font-semibold truncate ${isLight ? "text-zinc-900" : "text-white"}`} title={media.title}>
                        {media.title || "No media playing"}
                      </h4>
                      <p className={`text-[10px] truncate mt-0.5 ${isLight ? "text-zinc-500" : "text-zinc-400"}`} title={media.artist}>
                        {media.artist || "Play music in YouTube or browser"}
                      </p>
                    </div>

                    {/* Equalizer & Lyrics Toggle */}
                    <div className="flex items-center gap-2">
                      <div className="flex items-end gap-[2px] h-4 w-8">
                        {eqHeights.map((h, i) => (
                          <div 
                            key={i} 
                            className={`w-[2px] rounded-full transition-all duration-75 ${isLight ? "bg-zinc-800" : "bg-zinc-400"}`}
                            style={{ height: `${h}px` }}
                          />
                        ))}
                      </div>

                      <button
                        onClick={onToggleLyricsWindow}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-medium transition-colors border ${
                          isLyricsOpen 
                            ? (isLight ? "bg-zinc-900 text-white border-zinc-900" : "bg-white text-black border-white") 
                            : (isLight ? "bg-zinc-200 text-zinc-700 hover:text-black hover:bg-zinc-300 border-zinc-300" : "bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700 border-zinc-700")
                        }`}
                        title="Toggle Full Lyrics Window"
                      >
                        <FileText className="w-3 h-3" />
                        <span>{isLyricsOpen ? "Close Lyrics" : "Lyrics"}</span>
                      </button>
                    </div>
                  </div>

                  {/* Seekbar */}
                  <div className="w-full flex flex-col gap-0.5 pt-1">
                    <div 
                      className={`relative w-full h-1 rounded-full cursor-pointer hover:h-1.5 transition-all ${
                        isLight ? "bg-zinc-300" : "bg-zinc-800"
                      }`}
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const clickX = e.clientX - rect.left;
                        const ratio = clickX / rect.width;
                        onSeek(ratio * media.durationSec);
                      }}
                    >
                      <div 
                        className={`h-full rounded-full ${isLight ? "bg-zinc-900" : "bg-white"}`}
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    <div className={`flex justify-between text-[9px] font-mono ${isLight ? "text-zinc-500" : "text-zinc-500"}`}>
                      <span>{formatTime(media.positionSec)}</span>
                      <span>{formatTime(media.durationSec)}</span>
                    </div>
                  </div>

                  {/* Playback Controls */}
                  <div className="flex items-center justify-center gap-3">
                    <button
                      onClick={onPrev}
                      className={`p-1 transition-colors ${isLight ? "text-zinc-600 hover:text-zinc-900" : "text-zinc-400 hover:text-white"}`}
                      title="Previous Track"
                    >
                      <SkipBack className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => onSeek(Math.max(0, media.positionSec - 10))}
                      className={`p-1 transition-colors ${isLight ? "text-zinc-500 hover:text-zinc-900" : "text-zinc-500 hover:text-white"}`}
                      title="Rewind 10s"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>

                    <button
                      onClick={onTogglePlayPause}
                      className={`p-2 rounded-full transition-colors shadow-md ${
                        isLight
                          ? "bg-zinc-900 text-white hover:bg-zinc-800"
                          : "bg-white text-black hover:bg-zinc-200"
                      }`}
                      title={media.isPlaying ? "Pause" : "Play"}
                    >
                      {media.isPlaying ? (
                        <Pause className={`w-3.5 h-3.5 ${isLight ? "fill-white text-white" : "fill-black text-black"}`} />
                      ) : (
                        <Play className={`w-3.5 h-3.5 translate-x-[0.5px] ${isLight ? "fill-white text-white" : "fill-black text-black"}`} />
                      )}
                    </button>

                    <button
                      onClick={() => onSeek(Math.min(media.durationSec, media.positionSec + 10))}
                      className={`p-1 transition-colors ${isLight ? "text-zinc-500 hover:text-zinc-900" : "text-zinc-500 hover:text-white"}`}
                      title="Forward 10s"
                    >
                      <RotateCw className="w-3 h-3" />
                    </button>

                    <button
                      onClick={onNext}
                      className={`p-1 transition-colors ${isLight ? "text-zinc-600 hover:text-zinc-900" : "text-zinc-400 hover:text-white"}`}
                      title="Next Track"
                    >
                      <SkipForward className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* ===================================================== */}
              {/* TAB 2: CLOCK & CALENDAR                               */}
              {/* ===================================================== */}
              {activeTab === "clock" && (
                <div className="w-full h-full flex items-center justify-between gap-4 px-1">
                  {/* Left: Big Digital Clock & Full Date */}
                  <div className="flex flex-col justify-center gap-1 min-w-[170px]">
                    <div className={`text-3xl font-mono font-bold tracking-tight leading-none ${isLight ? "text-zinc-900" : "text-white"}`}>
                      {clockString}
                    </div>
                    <div className={`text-xs font-medium ${isLight ? "text-zinc-700" : "text-zinc-300"}`}>
                      {currentTime.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })}
                    </div>
                    <div className={`text-[10px] mt-0.5 ${isLight ? "text-zinc-500" : "text-zinc-500"}`}>
                      {Intl.DateTimeFormat().resolvedOptions().timeZone}
                    </div>
                  </div>

                  {/* Right: Mini Calendar */}
                  <div className={`flex-1 border rounded-xl p-2 flex flex-col justify-between ${
                    isLight ? "bg-white border-zinc-300 shadow-sm" : "bg-zinc-900/80 border-zinc-800"
                  }`}>
                    <div className={`flex items-center justify-between text-[10px] font-semibold mb-1 ${isLight ? "text-zinc-800" : "text-zinc-300"}`}>
                      <button 
                        onClick={() => setCalendarMonthOffset(prev => prev - 1)}
                        className={`p-0.5 ${isLight ? "text-zinc-600 hover:text-zinc-900" : "text-zinc-400 hover:text-white"}`}
                      >
                        <ChevronLeft className="w-3 h-3" />
                      </button>
                      <span>{currentMonthName}</span>
                      <button 
                        onClick={() => setCalendarMonthOffset(prev => prev + 1)}
                        className={`p-0.5 ${isLight ? "text-zinc-600 hover:text-zinc-900" : "text-zinc-400 hover:text-white"}`}
                      >
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Day initials */}
                    <div className={`grid grid-cols-7 text-center text-[9px] mb-1 ${isLight ? "text-zinc-400" : "text-zinc-500"}`}>
                      <span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>
                    </div>

                    {/* Days grid */}
                    <div className="grid grid-cols-7 gap-y-0.5 text-center text-[9px]">
                      {Array.from({ length: firstDayWeekday }).map((_, i) => (
                        <span key={`empty-${i}`} className="text-transparent">.</span>
                      ))}
                      {Array.from({ length: daysInMonth }).map((_, i) => {
                        const dayNum = i + 1;
                        const isToday = isCurrentViewingMonth && dayNum === currentTime.getDate();
                        return (
                          <span 
                            key={`day-${dayNum}`}
                            className={`py-0.5 rounded-full ${
                              isToday 
                                ? (isLight ? "bg-zinc-900 text-white font-bold" : "bg-white text-black font-bold")
                                : (isLight ? "text-zinc-700 hover:bg-zinc-200" : "text-zinc-300 hover:bg-zinc-800")
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
              {/* TAB 3: COUNTDOWN TIMER                                */}
              {/* ===================================================== */}
              {activeTab === "timer" && (
                <div className="w-full h-full flex flex-col justify-between px-1">
                  {/* Timer Display & Adjustments */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-baseline gap-2">
                      <span className={`text-3xl font-mono font-bold leading-none ${
                        isTimerFinished 
                          ? "text-amber-500 animate-pulse" 
                          : (isLight ? "text-zinc-900" : "text-white")
                      }`}>
                        {formatTime(timerRemaining)}
                      </span>
                      <span className={`text-[10px] ${isLight ? "text-zinc-500" : "text-zinc-400"}`}>
                        {isTimerFinished ? "Finished!" : isTimerRunning ? "Counting Down" : "Ready"}
                      </span>
                    </div>

                    {/* Quick Adjust Buttons */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleAdjustTimer(-60)}
                        className={`px-1.5 py-0.5 border rounded text-[10px] font-mono transition-colors ${
                          isLight 
                            ? "bg-zinc-200 border-zinc-300 hover:bg-zinc-300 text-zinc-800" 
                            : "bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-zinc-300"
                        }`}
                      >
                        -1m
                      </button>
                      <button
                        onClick={() => handleAdjustTimer(60)}
                        className={`px-1.5 py-0.5 border rounded text-[10px] font-mono transition-colors ${
                          isLight 
                            ? "bg-zinc-200 border-zinc-300 hover:bg-zinc-300 text-zinc-800" 
                            : "bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-zinc-300"
                        }`}
                      >
                        +1m
                      </button>
                    </div>
                  </div>

                  {/* Presets */}
                  <div className="flex items-center justify-between gap-1 py-1">
                    {[
                      { label: "1 min", sec: 60 },
                      { label: "5 min", sec: 300 },
                      { label: "15 min", sec: 900 },
                      { label: "25m Focus", sec: 1500 }
                    ].map((preset) => {
                      const active = timerDuration === preset.sec;
                      return (
                        <button
                          key={preset.sec}
                          onClick={() => handleSetPresetTimer(preset.sec)}
                          className={`flex-1 py-1 rounded text-[10px] font-medium transition-colors border ${
                            active
                              ? (isLight ? "bg-zinc-900 border-zinc-900 text-white font-semibold" : "bg-zinc-800 border-zinc-600 text-white font-semibold")
                              : (isLight ? "bg-zinc-200/80 border-zinc-300 text-zinc-700 hover:bg-zinc-300" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white")
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Progress Bar & Actions */}
                  <div className="flex items-center gap-3">
                    <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${isLight ? "bg-zinc-300" : "bg-zinc-800"}`}>
                      <div 
                        className={`h-full transition-all duration-300 ${
                          isTimerFinished 
                            ? "bg-amber-500" 
                            : (isLight ? "bg-zinc-900" : "bg-white")
                        }`}
                        style={{ width: `${timerDuration > 0 ? ((timerDuration - timerRemaining) / timerDuration) * 100 : 0}%` }}
                      />
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={handleStartPauseTimer}
                        className={`px-3 py-1 rounded font-semibold text-xs transition-colors ${
                          isLight
                            ? "bg-zinc-900 text-white hover:bg-zinc-800"
                            : "bg-white text-black hover:bg-zinc-200"
                        }`}
                      >
                        {isTimerRunning ? "Pause" : timerRemaining === 0 ? "Restart" : "Start"}
                      </button>
                      <button
                        onClick={handleResetTimer}
                        className={`px-2 py-1 rounded text-xs transition-colors border ${
                          isLight
                            ? "bg-zinc-200 border-zinc-300 text-zinc-700 hover:bg-zinc-300 hover:text-zinc-900"
                            : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-white"
                        }`}
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ===================================================== */}
              {/* TAB 4: STOPWATCH                                      */}
              {/* ===================================================== */}
              {activeTab === "stopwatch" && (
                <div className="w-full h-full flex flex-col justify-between px-1">
                  {/* Stopwatch Main Display */}
                  <div className="flex items-center justify-between">
                    <div>
                      <span className={`text-3xl font-mono font-bold tracking-tight leading-none ${isLight ? "text-zinc-900" : "text-white"}`}>
                        {formatStopwatch(stopwatchTimeMs)}
                      </span>
                    </div>

                    {/* Controls */}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={handleToggleStopwatch}
                        className={`px-3 py-1 rounded font-semibold text-xs transition-colors ${
                          isLight
                            ? "bg-zinc-900 text-white hover:bg-zinc-800"
                            : "bg-white text-black hover:bg-zinc-200"
                        }`}
                      >
                        {isStopwatchRunning ? "Pause" : "Start"}
                      </button>
                      <button
                        onClick={handleLapStopwatch}
                        disabled={!isStopwatchRunning}
                        className={`px-2.5 py-1 rounded text-xs disabled:opacity-40 transition-colors border flex items-center gap-1 ${
                          isLight
                            ? "bg-zinc-200 border-zinc-300 text-zinc-700 hover:bg-zinc-300 hover:text-zinc-900"
                            : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-white"
                        }`}
                      >
                        <Flag className="w-3 h-3" />
                        <span>Lap</span>
                      </button>
                      <button
                        onClick={handleResetStopwatch}
                        className={`px-2.5 py-1 rounded text-xs transition-colors border ${
                          isLight
                            ? "bg-zinc-200 border-zinc-300 text-zinc-700 hover:bg-zinc-300 hover:text-zinc-900"
                            : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-white"
                        }`}
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  {/* Laps List */}
                  <div className={`w-full h-14 border rounded-lg p-1.5 overflow-y-auto text-[10px] font-mono ${
                    isLight ? "bg-white border-zinc-300" : "bg-zinc-900/70 border-zinc-800"
                  }`}>
                    {stopwatchLaps.length === 0 ? (
                      <div className={`w-full h-full flex items-center justify-center ${isLight ? "text-zinc-400" : "text-zinc-500"}`}>
                        Click "Lap" while running to record split times
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {stopwatchLaps.map((lapMs, idx) => (
                          <div key={idx} className={`flex justify-between items-center px-1 ${isLight ? "text-zinc-700" : "text-zinc-300"}`}>
                            <span>Lap {stopwatchLaps.length - idx}</span>
                            <span className={`font-semibold ${isLight ? "text-zinc-900" : "text-white"}`}>{formatStopwatch(lapMs)}</span>
                          </div>
                        ))}
                      </div>
                    )}
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
