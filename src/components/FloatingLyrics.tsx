import React from "react";
import { LyricLine } from "../types/media";

interface FloatingLyricsProps {
  currentLine: LyricLine | null;
  nextLine: LyricLine | null;
  isPlaying: boolean;
  fontSize?: number; // default 24px
  isRepositionMode?: boolean;
  onDragStart?: () => void;
}

export const FloatingLyrics: React.FC<FloatingLyricsProps> = ({
  currentLine,
  nextLine,
  isPlaying,
  fontSize = 24,
  isRepositionMode = false,
  onDragStart
}) => {
  const isVisible = isPlaying && (currentLine !== null || nextLine !== null);

  return (
    <div
      className={`w-full h-full flex flex-col items-center justify-center select-none transition-opacity duration-300 ${
        isVisible || isRepositionMode ? "opacity-100" : "opacity-0 pointer-events-none"
      } ${
        isRepositionMode 
          ? "border border-dashed border-zinc-500 bg-zinc-950/80 rounded-xl cursor-move p-4" 
          : "p-2"
      }`}
      onMouseDown={isRepositionMode ? onDragStart : undefined}
    >
      {isRepositionMode && (
        <div className="absolute top-2 left-4 text-[10px] font-medium text-zinc-300 bg-zinc-800 px-2 py-0.5 rounded">
          Geser kotak ini untuk memindahkan posisi lirik
        </div>
      )}

      {/* Flat Active Lyric Line (No glow, clean drop-shadow for wallpaper legibility) */}
      <div 
        className="w-full text-center font-semibold text-white tracking-normal leading-relaxed drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]"
        style={{ fontSize: `${fontSize}px` }}
      >
        {isRepositionMode ? (
          <span className="text-zinc-300">Lirik aktif tampil di sini (format flat)</span>
        ) : currentLine ? (
          <span>{currentLine.text}</span>
        ) : (
          <span className="opacity-0">...</span>
        )}
      </div>

      {/* Flat Next Lyric Line */}
      <div 
        className="w-full text-center font-normal text-zinc-400 tracking-normal mt-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
        style={{ fontSize: `${Math.max(13, fontSize - 6)}px` }}
      >
        {isRepositionMode ? (
          <span className="text-zinc-500">Baris lirik berikutnya tampil di bawahnya</span>
        ) : nextLine ? (
          <span>{nextLine.text}</span>
        ) : (
          <span className="opacity-0">...</span>
        )}
      </div>
    </div>
  );
};
