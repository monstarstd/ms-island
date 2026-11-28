import React from "react";
import {
  ArrowDownToLine,
  ExternalLink,
  FileText,
  Hourglass,
  Inbox,
  Music,
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
  onFocusMediaSource: () => void;
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
    onFocusMediaSource,
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
    // STYLE 3: Vertical Side Capsule (Notch & Pill on Left / Right edges)
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
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onFocusMediaSource();
                }}
                className="flex flex-col items-center gap-1 focus:outline-none"
                title={`Back to ${media.sourceApp || "Media Player"}`}
              >
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
              </button>
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

        {/* Col 3: Back-to-Tab + Clean Lyrics Button */}
        <div className="flex items-center gap-1">
          {media.title && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFocusMediaSource();
              }}
              className={`p-1 rounded-md flex items-center justify-center transition-all border ${focusRing} ${subtleBtnCls}`}
              title={`Back to ${media.sourceApp || "Media Player"}`}
              aria-label={`Back to ${media.sourceApp || "Media Player"}`}
            >
              <ExternalLink className="w-3 h-3" />
            </button>
          )}
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
      </div>
    );
  }
);
