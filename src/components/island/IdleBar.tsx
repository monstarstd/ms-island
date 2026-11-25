import React from "react";
import { ArrowDownToLine, FileText, Hourglass, Inbox, Music, Timer as TimerIcon } from "lucide-react";
import { MediaTrack } from "../../types/media";
import {
  ActiveDownloadInfo,
  IslandToast,
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
  idleClockAmPm: string;
  currentTime: Date;
  media: MediaTrack;
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
  isStopwatchRunning: boolean;
  stopwatchTimeMs: number;
  weather: WeatherInfo | null;
  vertical?: boolean;
  onToggleLyricsWindow: () => void;
  onStartDrag: () => void;
}

export const IdleBar: React.FC<IdleBarProps> = React.memo(
  ({
    tokens,
    idleClockAmPm,
    currentTime,
    media,
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
    isStopwatchRunning,
    stopwatchTimeMs,
    weather,
    vertical = false,
    onToggleLyricsWindow,
    onStartDrag,
  }) => {
    const { isLight, mutedText, subtleBtnCls, focusRing } = tokens;

    if (vertical) {
      const hour24 = currentTime.getHours();
      const hour12 = String(hour24 % 12 || 12).padStart(2, "0");
      const minute = String(currentTime.getMinutes()).padStart(2, "0");
      const ampm = hour24 >= 12 ? "PM" : "AM";
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
          {/* Top: Upright Stacked Clock (scannable without tilting head) */}
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
            {isDragOver ? (
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

    return (
      <div
        className="w-full h-full grid grid-cols-[auto_1fr_auto] items-center gap-2.5 select-none island-panel-fade"
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
          ) : activeDownload ? (
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
          ) : isTimerRunning || isTimerFinished ? (
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
