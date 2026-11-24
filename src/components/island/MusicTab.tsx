import React from "react";
import {
  FileText,
  Music,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { MediaTrack } from "../../types/media";
import { VisualizerStyle, VolumeInfo } from "../../types/system";
import { AudioVisualizer } from "../AudioVisualizer";
import { ScrubBar } from "../ScrubBar";
import { formatTime, IslandThemeTokens, VolumeIcon } from "./helpers";

interface MusicTabProps {
  tokens: IslandThemeTokens;
  media: MediaTrack;
  isLyricsOpen: boolean;
  visualizerStyle: VisualizerStyle;
  volume: VolumeInfo;
  onSetVisualizer: (style: VisualizerStyle) => void;
  onTogglePlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (pos: number) => void;
  onToggleLyricsWindow: () => void;
  onSetVolume: (val: number) => void;
  onToggleMute: () => void;
}

export const MusicTab: React.FC<MusicTabProps> = React.memo(
  ({
    tokens,
    media,
    isLyricsOpen,
    visualizerStyle,
    volume,
    onSetVisualizer,
    onTogglePlayPause,
    onPrev,
    onNext,
    onSeek,
    onToggleLyricsWindow,
    onSetVolume,
    onToggleMute,
  }) => {
    const { isLight, mutedText, subtleBtnCls, primaryBtnCls, focusRing } = tokens;

    return (
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
                onClick={() => onSetVisualizer(style)}
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
              onClick={onToggleMute}
              className={`p-1 rounded-md transition-colors ${focusRing} ${
                isLight ? "text-zinc-700 hover:bg-zinc-200" : "text-zinc-300 hover:bg-zinc-800"
              }`}
              title={volume.muted ? "Unmute" : "Mute"}
            >
              <VolumeIcon volume={volume} className="w-3.5 h-3.5" />
            </button>
            <ScrubBar
              value={volume.muted ? 0 : volume.level}
              max={100}
              onChange={onSetVolume}
              isLight={isLight}
              ariaLabel="Master volume"
            />
            <span className={`text-[10px] font-mono tabular-nums w-7 text-right ${mutedText}`}>
              {volume.muted ? "0%" : `${volume.level}%`}
            </span>
          </div>
        </div>
      </div>
    );
  }
);
