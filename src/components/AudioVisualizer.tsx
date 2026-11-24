import React, { useEffect, useState } from "react";
import { VisualizerStyle } from "../types/system";

interface AudioVisualizerProps {
  isPlaying: boolean;
  style: VisualizerStyle;
  isLight: boolean;
  compact?: boolean;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  isPlaying,
  style,
  isLight,
  compact = false,
}) => {
  const [levels, setLevels] = useState<number[]>([3, 5, 8, 12, 10, 7, 5, 3]);
  const [phase, setPhase] = useState<number>(0);

  useEffect(() => {
    if (!isPlaying) {
      setLevels([2, 2, 2, 2, 2, 2, 2, 2]);
      return;
    }

    const interval = setInterval(() => {
      const t = Date.now() / 115;
      setPhase(t);
      setLevels([
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
  }, [isPlaying]);

  const colorClass = isLight ? "bg-zinc-900" : "bg-white";
  const strokeColor = isLight ? "#18181b" : "#ffffff";

  // Style 1: Vertical Bars
  if (style === "bars") {
    const slice = compact ? levels.slice(0, 6) : levels;
    return (
      <div className={`flex items-end gap-[2px] flex-shrink-0 ${compact ? "h-3.5 w-6" : "h-4 w-9"}`}>
        {slice.map((h, i) => (
          <div
            key={i}
            className={`w-[2px] rounded-full transition-all duration-75 ${colorClass}`}
            style={{ height: `${Math.min(compact ? 13 : 16, h)}px` }}
          />
        ))}
      </div>
    );
  }

  // Style 2: Smooth Animated Wave
  if (style === "wave") {
    const w = compact ? 28 : 40;
    const h = compact ? 14 : 16;
    const mid = h / 2;
    const points: string[] = [];
    const steps = 16;
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * w;
      const env = Math.sin((i / steps) * Math.PI); // taper ends smoothly
      const amp = isPlaying ? (mid - 2) * env : 0.4;
      const y = mid + Math.sin(i * 0.9 + phase * 1.8) * amp;
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }

    return (
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        className="flex-shrink-0 overflow-visible"
      >
        <polyline
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points.join(" ")}
        />
      </svg>
    );
  }

  // Style 3: Minimalist Bouncing Dots
  const dotSlice = compact ? levels.slice(0, 5) : levels.slice(0, 7);
  return (
    <div className={`flex items-center justify-between flex-shrink-0 ${compact ? "h-3.5 w-6" : "h-4 w-9"}`}>
      {dotSlice.map((lvl, i) => {
        const offset = isPlaying ? Math.min(4.5, (lvl - 2) * 0.35) : 0;
        const dir = i % 2 === 0 ? -1 : 1;
        return (
          <div
            key={i}
            className={`w-[3px] h-[3px] rounded-full transition-transform duration-75 ${colorClass}`}
            style={{ transform: `translateY(${(offset * dir).toFixed(1)}px)` }}
          />
        );
      })}
    </div>
  );
};
