import React from "react";
import {
  ArrowDownToLine,
  FileText,
  Flame,
  Hourglass,
  Inbox,
  LayoutGrid,
  Music,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Timer as TimerIcon,
} from "lucide-react";
import { MediaTrack } from "../../types/media";
import {
  ActiveDownloadInfo,
  BarStyle,
  ColorSample,
  IslandToast,
  PomodoroPhase,
  VisualizerStyle,
  VolumeInfo,
  WeatherInfo,
} from "../../types/system";
import { AudioVisualizer } from "../AudioVisualizer";
import {
  formatBytes,
  formatSpeed,
  formatStopwatch,
  formatTime,
  IslandThemeTokens,
  VolumeIcon,
  WeatherIcon,
} from "./helpers";

interface IdleBarProps {
  tokens: IslandThemeTokens;
  barStyle: BarStyle;
  idleClockAmPm: string;
  currentTime: Date;
  media: MediaTrack;
  mediaProgress: number | null;
  timerProgress: number | null;
  visualizerStyle: VisualizerStyle;
  isLyricsOpen: boolean;
  isDragOver: boolean;
  showVolumeHud: boolean;
  volume: VolumeInfo;
  toast: IslandToast | null;
  activeDownload: ActiveDownloadInfo | null;
  isTimerRunning: boolean;
  isTimerFinished: boolean;
  timerRemaining: number;
  timerMode: "countdown" | "pomodoro";
  pomodoroPhase: PomodoroPhase;
  isPickingColor: boolean;
  pickedSample: ColorSample | null;
  isStopwatchRunning: boolean;
  stopwatchTimeMs: number;
  weather: WeatherInfo | null;
  vertical?: boolean;
  forceMusicSlot?: boolean;
  onToggleLyricsWindow: () => void;
  onTogglePlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onExpandTile: () => void;
  onStartDrag: () => void;
}

export const IdleBar: React.FC<IdleBarProps> = React.memo(
  ({
    tokens,
    barStyle,
    idleClockAmPm,
    currentTime,
    media,
    mediaProgress,
    timerProgress,
    visualizerStyle,
    isLyricsOpen,
    isDragOver,
    showVolumeHud,
    volume,
    toast,
    activeDownload,
    isTimerRunning,
    isTimerFinished,
    timerRemaining,
    timerMode,
    pomodoroPhase,
    isPickingColor,
    pickedSample,
    isStopwatchRunning,
    stopwatchTimeMs,
    weather,
    vertical = false,
    forceMusicSlot = false,
    onToggleLyricsWindow,
    onTogglePlayPause,
    onPrev,
    onNext,
    onExpandTile,
    onStartDrag,
  }) => {
    const { isLight, mutedText, subtleBtnCls, focusRing } = tokens;

    const hour24 = currentTime.getHours();
    const hour12 = String(hour24 % 12 || 12).padStart(2, "0");
    const minute = String(currentTime.getMinutes()).padStart(2, "0");
    const ampm = hour24 >= 12 ? "PM" : "AM";

    // -------------------------------------------------------------------------
    // STYLE 1: Floating Orb (48x48px circle with SVG circular progress ring)
    // -------------------------------------------------------------------------
    if (barStyle === "orb" && !isPickingColor && !isDragOver) {
      const ringProgress =
        isTimerRunning && timerProgress !== null
          ? timerProgress
          : media.isPlaying && mediaProgress !== null
            ? mediaProgress
            : null;
      const radius = 20.5;
      const circumference = 2 * Math.PI * radius;
      const dashOffset =
        ringProgress !== null ? circumference * (1 - Math.max(0, Math.min(1, ringProgress))) : 0;

      return (
        <div
          className="relative w-full h-full flex items-center justify-center select-none island-panel-fade"
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            onStartDrag();
          }}
          title={media.isPlaying && media.title ? media.title : "Hover to expand · Right-click for options"}
        >
          {ringProgress !== null && (
            <svg
              className="pointer-events-none absolute inset-0 w-full h-full -rotate-90"
              viewBox="0 0 48 48"
            >
              <circle
                cx="24"
                cy="24"
                r={radius}
                fill="none"
                stroke={isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.09)"}
                strokeWidth="2"
              />
              <circle
                cx="24"
                cy="24"
                r={radius}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                className="transition-[stroke-dashoffset] duration-300 ease-linear"
              />
            </svg>
          )}

          {showVolumeHud ? (
            <div className="flex flex-col items-center leading-none gap-0.5">
              <VolumeIcon volume={volume} className="w-3.5 h-3.5 text-accent" />
              <span className="text-[9px] font-mono font-bold tabular-nums">
                {volume.muted ? "M" : `${volume.level}%`}
              </span>
            </div>
          ) : activeDownload ? (
            <ArrowDownToLine className="w-4 h-4 text-accent" />
          ) : isTimerRunning || isTimerFinished ? (
            <span
              className={`text-[10px] font-mono font-bold tabular-nums leading-none ${
                isTimerFinished ? "text-accent" : ""
              }`}
            >
              {isTimerFinished ? "DONE" : formatTime(timerRemaining)}
            </span>
          ) : isStopwatchRunning ? (
            <span className="text-[9.5px] font-mono font-bold tabular-nums leading-none">
              {formatTime(Math.floor(stopwatchTimeMs / 1000))}
            </span>
          ) : media.isPlaying ? (
            media.thumbnail ? (
              <img
                src={media.thumbnail}
                alt=""
                className="w-[34px] h-[34px] rounded-full object-cover border border-white/15"
              />
            ) : (
              <Music className="w-4 h-4 text-accent" />
            )
          ) : weather ? (
            <div className="flex flex-col items-center leading-none gap-0.5">
              <WeatherIcon icon={weather.icon} className={`w-3.5 h-3.5 ${mutedText}`} />
              <span className="text-[9.5px] font-bold tabular-nums">{weather.temperature}°</span>
            </div>
          ) : (
            <div className="flex flex-col items-center leading-none">
              <span className="text-[10.5px] font-bold tabular-nums">{hour12}</span>
              <span className="text-[10px] font-semibold tabular-nums text-accent">{minute}</span>
            </div>
          )}
        </div>
      );
    }

    // -------------------------------------------------------------------------
    // STYLE 2: Ultra-Slim Edge Handle (10x110px side OR 110x10px top/bottom)
    // -------------------------------------------------------------------------
    if (barStyle === "handle" && !isPickingColor && !isDragOver && !showVolumeHud) {
      const hasActivity =
        media.isPlaying || isTimerRunning || isTimerFinished || isStopwatchRunning || Boolean(activeDownload);
      const frac =
        isTimerRunning && timerProgress !== null
          ? timerProgress
          : media.isPlaying && mediaProgress !== null
            ? mediaProgress
            : 1;

      return (
        <div
          className="w-full h-full flex items-center justify-center select-none cursor-pointer island-panel-fade"
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            onStartDrag();
          }}
          title={media.isPlaying && media.title ? `Hover to expand · ${media.title}` : "Hover to expand MS Island"}
        >
          {vertical ? (
            <div
              className={`w-[3px] h-[56px] rounded-full overflow-hidden flex items-end ${
                isLight ? "bg-zinc-300" : "bg-zinc-700"
              }`}
            >
              <div
                className={`w-full rounded-full transition-all duration-300 ${
                  hasActivity ? "bg-accent" : isLight ? "bg-zinc-500" : "bg-zinc-400"
                }`}
                style={{ height: `${Math.max(22, Math.round(frac * 100))}%` }}
              />
            </div>
          ) : (
            <div
              className={`h-[3px] w-[56px] rounded-full overflow-hidden flex items-center ${
                isLight ? "bg-zinc-300" : "bg-zinc-700"
              }`}
            >
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  hasActivity ? "bg-accent" : isLight ? "bg-zinc-500" : "bg-zinc-400"
                }`}
                style={{ width: `${Math.max(22, Math.round(frac * 100))}%` }}
              />
            </div>
          )}
        </div>
      );
    }

    // -------------------------------------------------------------------------
    // STYLE 3: Compact Desk Tile (156x156px squircle with direct controls)
    // -------------------------------------------------------------------------
    if (barStyle === "tile") {
      const tileProgress =
        isTimerRunning && timerProgress !== null
          ? timerProgress
          : media.isPlaying && mediaProgress !== null
            ? mediaProgress
            : 0;

      return (
        <div
          className="w-full h-full p-2.5 flex flex-col justify-between select-none island-panel-fade"
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            if ((e.target as HTMLElement).closest("button")) return;
            onStartDrag();
          }}
        >
          {/* Row 1: Clock + Weather/Timer + Expand-All-Tabs Button */}
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10.5px] font-semibold tabular-nums tracking-tight">
              {idleClockAmPm}
            </span>
            <div className="flex items-center gap-1">
              {weather && !isTimerRunning && !isPickingColor && (
                <span className="text-[10px] font-semibold tabular-nums text-accent">
                  {weather.temperature}°
                </span>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onExpandTile();
                }}
                className={`p-1 rounded-md border transition-colors ${focusRing} ${subtleBtnCls}`}
                title="Expand full 8-tab panel"
              >
                <LayoutGrid className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Row 2: Main Context Area */}
          {isPickingColor ? (
            <div className="flex items-center gap-2.5 py-1">
              <span
                className="w-9 h-9 rounded-xl border border-white/20 flex-shrink-0"
                style={{ backgroundColor: pickedSample?.hex || "#f97316" }}
              />
              <div className="min-w-0">
                <div className="text-[11px] font-mono font-bold truncate">
                  {pickedSample?.hex || "Picking..."}
                </div>
                <div className={`text-[9.5px] ${mutedText}`}>Click · Esc</div>
              </div>
            </div>
          ) : isDragOver ? (
            <div className="flex flex-col items-center justify-center text-center py-1 text-accent">
              <Inbox className="w-5 h-5 mb-0.5" />
              <span className="text-[10px] font-semibold">Drop to Shelf</span>
            </div>
          ) : isTimerRunning || isTimerFinished ? (
            <div className="flex flex-col items-start justify-center py-0.5">
              <span className={`text-[9.5px] font-medium flex items-center gap-1 ${mutedText}`}>
                {timerMode === "pomodoro" ? (
                  <Flame className="w-3 h-3 text-accent" />
                ) : (
                  <Hourglass className="w-3 h-3 text-accent" />
                )}
                <span>
                  {isTimerFinished
                    ? "Completed"
                    : timerMode === "pomodoro"
                      ? pomodoroPhase === "focus"
                        ? "Focus"
                        : "Break"
                      : "Timer"}
                </span>
              </span>
              <span
                className={`text-[22px] font-mono font-bold tabular-nums leading-tight ${
                  isTimerFinished ? "text-accent" : ""
                }`}
              >
                {formatTime(timerRemaining)}
              </span>
            </div>
          ) : toast ? (
            <div className="flex items-center gap-1.5 py-2">
              <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
              <span className="text-[11px] font-medium line-clamp-2 leading-snug">
                {toast.message}
              </span>
            </div>
          ) : media.title ? (
            <div className="grid grid-cols-[38px_1fr] items-center gap-2 min-w-0">
              {media.thumbnail ? (
                <img
                  src={media.thumbnail}
                  alt=""
                  className={`w-[38px] h-[38px] rounded-[9px] object-cover border ${
                    isLight ? "border-zinc-300" : "border-zinc-700/70"
                  }`}
                />
              ) : (
                <div
                  className={`w-[38px] h-[38px] rounded-[9px] flex items-center justify-center border ${
                    isLight ? "bg-zinc-200 border-zinc-300" : "bg-zinc-900 border-zinc-800"
                  }`}
                >
                  <Music className="w-4 h-4 text-accent" />
                </div>
              )}
              <div className="min-w-0">
                <div className="text-[11px] font-semibold truncate leading-tight" title={media.title}>
                  {media.title}
                </div>
                <div className={`text-[9.5px] truncate mt-0.5 ${mutedText}`}>
                  {media.artist || media.sourceApp || "Media"}
                </div>
                {media.isPlaying && (
                  <div className="mt-1">
                    <AudioVisualizer
                      isPlaying={media.isPlaying}
                      style={visualizerStyle}
                      isLight={isLight}
                      compact
                    />
                  </div>
                )}
              </div>
            </div>
          ) : weather ? (
            <div className="flex items-center gap-2.5 py-1">
              <WeatherIcon icon={weather.icon} className="w-7 h-7 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-[18px] font-bold tabular-nums leading-none">
                  {weather.temperature}°C
                </div>
                <div className={`text-[10px] truncate mt-1 ${mutedText}`}>{weather.city}</div>
              </div>
            </div>
          ) : (
            <div className="py-1">
              <div className="text-[12px] font-semibold leading-tight">
                {currentTime.toLocaleDateString("en-US", { weekday: "long" })}
              </div>
              <div className={`text-[10px] mt-0.5 ${mutedText}`}>
                {currentTime.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </div>
            </div>
          )}

          {/* Row 3: Slim Progress Line */}
          <div
            className={`w-full h-[2.5px] rounded-full overflow-hidden ${
              isLight ? "bg-zinc-200" : "bg-zinc-800"
            }`}
          >
            <div
              className="h-full bg-accent transition-all duration-300 rounded-full"
              style={{ width: `${Math.max(0, Math.min(100, tileProgress * 100))}%` }}
            />
          </div>

          {/* Row 4: Direct-Click Controls (Prev · Play/Pause · Next · Lyrics) */}
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPrev();
                }}
                className={`p-1 rounded-md transition-colors ${focusRing} ${
                  isLight ? "text-zinc-700 hover:bg-zinc-200" : "text-zinc-300 hover:bg-zinc-800"
                }`}
                title="Previous Track"
              >
                <SkipBack className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePlayPause();
                }}
                className={`w-6 h-6 rounded-full flex items-center justify-center transition-all active:scale-[0.94] ${focusRing} ${
                  isLight
                    ? "bg-zinc-900 hover:bg-zinc-800 text-white"
                    : "bg-zinc-100 hover:bg-white text-zinc-950"
                }`}
                title={media.isPlaying ? "Pause" : "Play"}
              >
                {media.isPlaying ? (
                  <Pause className="w-3 h-3 fill-current" />
                ) : (
                  <Play className="w-3 h-3 fill-current ml-0.5" />
                )}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onNext();
                }}
                className={`p-1 rounded-md transition-colors ${focusRing} ${
                  isLight ? "text-zinc-700 hover:bg-zinc-200" : "text-zinc-300 hover:bg-zinc-800"
                }`}
                title="Next Track"
              >
                <SkipForward className="w-3 h-3" />
              </button>
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleLyricsWindow();
              }}
              className={`px-1.5 py-0.5 rounded-md text-[9.5px] font-medium flex items-center gap-1 border transition-colors ${focusRing} ${
                isLyricsOpen
                  ? isLight
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "bg-zinc-100 text-zinc-950 border-zinc-100"
                  : subtleBtnCls
              }`}
              title="Toggle Lyrics Window"
            >
              <FileText className="w-2.5 h-2.5" />
              <span>Lyr</span>
            </button>
          </div>
        </div>
      );
    }

    // -------------------------------------------------------------------------
    // STYLE 4: Vertical Side Capsule (Notch & Pill on Left / Right edges)
    // -------------------------------------------------------------------------
    if (vertical) {
      const dividerCls = isLight ? "bg-zinc-300" : "bg-zinc-800";

      return (
        <div
          className="w-full h-full flex flex-col items-center justify-between py-2.5 px-1 select-none island-panel-fade"
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            if ((e.target as HTMLElement).closest("button")) return;
            onStartDrag();
          }}
          title={media.isPlaying && media.title ? media.title : "Hover to expand · Drag to move"}
        >
          {/* Top: Upright Stacked Clock */}
          <div className="flex flex-col items-center leading-none">
            <span className="text-[12px] font-bold tabular-nums tracking-tight">{hour12}</span>
            <span className="text-[12px] font-semibold tabular-nums tracking-tight text-accent mt-0.5">
              {minute}
            </span>
            <span className={`text-[7.5px] font-semibold uppercase tracking-wider mt-0.5 ${mutedText}`}>
              {ampm}
            </span>
          </div>

          <div className={`w-5 h-px ${dividerCls}`} />

          {/* Middle: Upright Context-Aware Live Slot */}
          <div className="w-full flex flex-col items-center justify-center gap-1 min-h-[42px]">
            {isPickingColor ? (
              <>
                <span
                  className="w-5 h-5 rounded-md border border-white/25 shadow-sm"
                  style={{ backgroundColor: pickedSample?.hex || "#f97316" }}
                />
                <span className="text-[7.5px] font-mono font-bold tracking-tight leading-none">
                  {pickedSample?.hex ? pickedSample.hex.slice(1) : "PICK"}
                </span>
              </>
            ) : isDragOver ? (
              <>
                <Inbox className="w-4 h-4 text-accent" />
                <span className="text-[8px] font-semibold text-accent uppercase tracking-wider">
                  Drop
                </span>
              </>
            ) : showVolumeHud ? (
              <>
                <VolumeIcon volume={volume} className={`w-3.5 h-3.5 ${mutedText}`} />
                <div
                  className={`w-1.5 h-7 rounded-full overflow-hidden flex items-end ${
                    isLight ? "bg-zinc-300" : "bg-zinc-800"
                  }`}
                >
                  <div
                    className={`w-full rounded-full transition-all duration-75 ${
                      volume.muted ? "bg-zinc-500" : "bg-accent"
                    }`}
                    style={{ height: `${volume.muted ? 0 : volume.level}%` }}
                  />
                </div>
                <span className="text-[8.5px] font-mono font-semibold tabular-nums">
                  {volume.muted ? "Mute" : `${volume.level}%`}
                </span>
              </>
            ) : toast ? (
              <>
                <span className="w-2 h-2 rounded-full bg-accent" />
                <span className="text-[8px] font-medium text-center leading-tight line-clamp-2 px-0.5">
                  {toast.message}
                </span>
              </>
            ) : activeDownload ? (
              <>
                <ArrowDownToLine className="w-3.5 h-3.5 text-accent" />
                <span className="text-[8px] font-mono font-semibold tabular-nums text-accent text-center leading-tight">
                  {formatSpeed(activeDownload.speedBytesPerSec).replace("/s", "")}
                </span>
              </>
            ) : isTimerRunning || isTimerFinished ? (
              <>
                <Hourglass
                  className={`w-3.5 h-3.5 ${isTimerFinished ? "text-accent" : mutedText}`}
                />
                <span
                  className={`text-[9px] font-mono font-semibold tabular-nums leading-none ${
                    isTimerFinished ? "text-accent" : ""
                  }`}
                >
                  {isTimerFinished ? "DONE" : formatTime(timerRemaining)}
                </span>
              </>
            ) : isStopwatchRunning ? (
              <>
                <TimerIcon className={`w-3.5 h-3.5 ${mutedText}`} />
                <span className="text-[8.5px] font-mono font-semibold tabular-nums leading-none">
                  {formatTime(Math.floor(stopwatchTimeMs / 1000))}
                </span>
              </>
            ) : media.isPlaying ? (
              <>
                {media.thumbnail ? (
                  <img
                    src={media.thumbnail}
                    alt=""
                    className={`w-[26px] h-[26px] rounded-[7px] object-cover border ${
                      isLight ? "border-zinc-300" : "border-zinc-700/70"
                    }`}
                  />
                ) : (
                  <Music className="w-4 h-4 text-accent" />
                )}
                <AudioVisualizer
                  isPlaying={media.isPlaying}
                  style={visualizerStyle}
                  isLight={isLight}
                  compact
                />
              </>
            ) : weather ? (
              <>
                <WeatherIcon icon={weather.icon} className={`w-4 h-4 ${mutedText}`} />
                <span className="text-[10px] font-semibold tabular-nums leading-none">
                  {weather.temperature}°
                </span>
              </>
            ) : (
              <div className={`flex flex-col items-center leading-tight ${mutedText}`}>
                <span className="text-[8px] uppercase font-semibold">
                  {currentTime.toLocaleDateString("en-US", { weekday: "short" })}
                </span>
                <span className="text-[11px] font-bold tabular-nums">
                  {currentTime.getDate()}
                </span>
              </div>
            )}
          </div>

          <div className={`w-5 h-px ${dividerCls}`} />

          {/* Bottom: Upright Lyrics Icon Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleLyricsWindow();
            }}
            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all border ${focusRing} ${
              isLyricsOpen
                ? isLight
                  ? "bg-zinc-900 text-white border-zinc-900"
                  : "bg-zinc-100 text-zinc-950 border-zinc-100"
                : subtleBtnCls
            }`}
            title="Toggle Full Lyrics Window"
          >
            <FileText className="w-3.5 h-3.5" />
          </button>
        </div>
      );
    }

    // -------------------------------------------------------------------------
    // STYLE 5: Standard Horizontal Pill / Notch (and Left Main Pill of Auto-Split)
    // -------------------------------------------------------------------------
    return (
      <div
        className="w-full h-full grid grid-cols-[auto_1fr_auto] items-center gap-2.5 select-none island-panel-fade"
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          if ((e.target as HTMLElement).closest("button")) return;
          onStartDrag();
        }}
      >
        {/* Col 1: Pure 12-hour AM/PM clock */}
        <span className="text-[11px] font-semibold tabular-nums tracking-tight whitespace-nowrap">
          {idleClockAmPm}
        </span>

        {/* Col 2: Context-Aware Live Slot */}
        <div
          className={`min-w-0 pl-2.5 border-l flex items-center gap-2 ${
            isLight ? "border-zinc-300" : "border-zinc-800"
          }`}
        >
          {isPickingColor ? (
            <div className="flex items-center gap-2 min-w-0 text-[11px]">
              <span
                className="w-3.5 h-3.5 rounded-[4px] border border-white/25 flex-shrink-0"
                style={{ backgroundColor: pickedSample?.hex || "#f97316" }}
              />
              <span className="font-mono font-bold tabular-nums">
                {pickedSample?.hex || "Move cursor..."}
              </span>
              <span className={`text-[10px] truncate ${mutedText}`}>
                Click to copy · Esc
              </span>
            </div>
          ) : isDragOver ? (
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-accent">
              <Inbox className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">Drop files to save on Shelf</span>
            </div>
          ) : showVolumeHud ? (
            <div className="w-full grid grid-cols-[auto_1fr_auto] items-center gap-2">
              <VolumeIcon volume={volume} className={`w-3.5 h-3.5 ${mutedText}`} />
              <div className={`h-1.5 rounded-full overflow-hidden ${isLight ? "bg-zinc-300" : "bg-zinc-800"}`}>
                <div
                  className={`h-full rounded-full transition-all duration-75 ${
                    volume.muted ? "bg-zinc-500" : "bg-accent"
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
              <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
              <span className="truncate">{toast.message}</span>
            </div>
          ) : !forceMusicSlot && activeDownload ? (
            <div className="flex items-center gap-1.5 min-w-0 text-[11px]">
              <ArrowDownToLine className="w-3.5 h-3.5 text-accent flex-shrink-0" />
              <span className="font-mono tabular-nums font-semibold text-accent flex-shrink-0">
                {formatSpeed(activeDownload.speedBytesPerSec)}
              </span>
              <span className={`font-mono tabular-nums text-[10px] flex-shrink-0 ${mutedText}`}>
                {formatBytes(activeDownload.bytesDownloaded)}
              </span>
              <span className="truncate font-medium">{activeDownload.name}</span>
            </div>
          ) : !forceMusicSlot && (isTimerRunning || isTimerFinished) ? (
            <div className="flex items-center gap-1.5 min-w-0 truncate">
              <Hourglass
                className={`w-3.5 h-3.5 flex-shrink-0 ${
                  isTimerFinished ? "text-accent" : mutedText
                }`}
              />
              <span
                className={`text-[11px] font-mono tabular-nums font-medium truncate ${
                  isTimerFinished ? "text-accent font-semibold" : ""
                }`}
              >
                {isTimerFinished
                  ? timerMode === "pomodoro"
                    ? pomodoroPhase === "focus"
                      ? "Focus Complete"
                      : "Break Over"
                    : "Timer Finished"
                  : timerMode === "pomodoro"
                    ? `${pomodoroPhase === "focus" ? "Focus" : "Break"} ${formatTime(timerRemaining)}`
                    : formatTime(timerRemaining)}
              </span>
            </div>
          ) : !forceMusicSlot && isStopwatchRunning ? (
            <div className="flex items-center gap-1.5 min-w-0 truncate">
              <TimerIcon className={`w-3.5 h-3.5 flex-shrink-0 ${mutedText}`} />
              <span className="text-[11px] font-mono tabular-nums font-medium truncate">
                {formatStopwatch(stopwatchTimeMs)}
              </span>
            </div>
          ) : media.isPlaying ? (
            <div className="flex items-center gap-2 min-w-0 w-full">
              {media.thumbnail && (
                <img
                  src={media.thumbnail}
                  alt=""
                  className={`w-[18px] h-[18px] rounded-[5px] object-cover flex-shrink-0 border ${
                    isLight ? "border-zinc-300" : "border-zinc-700/70"
                  }`}
                />
              )}
              <AudioVisualizer
                isPlaying={media.isPlaying}
                style={visualizerStyle}
                isLight={isLight}
                compact
              />
              <span className="text-[11px] font-medium truncate">
                {media.title || "Playing Audio"}
              </span>
            </div>
          ) : weather ? (
            <div className="flex items-center gap-1.5 min-w-0 truncate text-[11px]">
              <WeatherIcon icon={weather.icon} className={`w-3.5 h-3.5 flex-shrink-0 ${mutedText}`} />
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
    );
  }
);
