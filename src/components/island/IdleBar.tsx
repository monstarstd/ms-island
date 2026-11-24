import React from "react";
import { ArrowDownToLine, FileText, Hourglass, Inbox, Timer as TimerIcon } from "lucide-react";
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
  spectrum: number[];
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
    spectrum,
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
    onToggleLyricsWindow,
    onStartDrag,
  }) => {
    const { isLight, mutedText, subtleBtnCls, focusRing } = tokens;

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
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#f97316]">
              <Inbox className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">Drop files to save on Shelf</span>
            </div>
          ) : showVolumeHud ? (
            <div className="w-full grid grid-cols-[auto_1fr_auto] items-center gap-2">
              <VolumeIcon volume={volume} className={`w-3.5 h-3.5 ${mutedText}`} />
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
          ) : activeDownload ? (
            <div className="flex items-center gap-1.5 min-w-0 text-[11px]">
              <ArrowDownToLine className="w-3.5 h-3.5 text-[#f97316] flex-shrink-0" />
              <span className="font-mono tabular-nums font-semibold text-[#f97316] flex-shrink-0">
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
