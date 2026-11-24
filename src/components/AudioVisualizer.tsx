import React, { useEffect, useState } from "react";
import { VisualizerStyle } from "../types/system";

interface AudioVisualizerProps {
  isPlaying: boolean;
  style: VisualizerStyle;
  isLight: boolean;
  compact?: boolean;
  spectrum?: number[]; // Real WASAPI 8-band spectrum [0.0..1.0]
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  isPlaying,
  style,
  isLight,
  compact = false,
  spectrum,
}) => {
  const [phase, setPhase] = useState<number>(0);

  // Subtle phase ticker only for the Wave curve smoothness when audio is active
  useEffect(() => {
    if (!isPlaying || style !== "wave") return;
    const id = setInterval(() => {
      setPhase(Date.now() / 130);
    }, 55);
    return () => clearInterval(id);
  }, [isPlaying, style]);

  // Convert real WASAPI [0..1] bands to pixel heights [2..15]
  const hasLiveSignal = Boolean(spectrum && spectrum.some((v) => v > 0.02));
  const maxPx = compact ? 13 : 16;

  const levels: number[] =
    spectrum && spectrum.length === 8
      ? spectrum.map((v) => {
          if (!isPlaying && v < 0.02) return 2;
          return Math.max(2, Math.round(2 + Math.min(1, v) * (maxPx - 2)));
        })
      : [2, 2, 2, 2, 2, 2, 2, 2];

  const colorClass = hasLiveSignal
    ? "bg-[#f97316]"
    : isLight
      ? "bg-zinc-900"
      : "bg-zinc-100";

  const strokeColor = hasLiveSignal
    ? "#f97316"
    : isLight
      ? "#18181b"
      : "#f4f4f5";

  // Style 1: Vertical Bars
  if (style === "bars") {
    const slice = compact ? levels.slice(0, 6) : levels;
    return (
      <div className={`flex items-end gap-[2px] flex-shrink-0 ${compact ? "h-3.5 w-6" : "h-4 w-9"}`}>
        {slice.map((h, i) => (
          <div
            key={i}
            className={`w-[2px] rounded-full transition-[height] duration-75 ${colorClass}`}
            style={{ height: `${h}px` }}
          />
        ))}
      </div>
    );
  }

  // Style 2: Smooth Real-Energy Wave
  if (style === "wave") {
    const w = compact ? 28 : 40;
    const h = compact ? 14 : 16;
    const mid = h / 2;
    const avgEnergy =
      spectrum && spectrum.length > 0
        ? spectrum.reduce((a, b) => a + b, 0) / spectrum.length
        : 0;
    const points: string[] = [];
    const steps = 16;

    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * w;
      const env = Math.sin((i / steps) * Math.PI);
      const bandIdx = Math.min(7, Math.floor((i / steps) * 8));
      const localEnergy = spectrum ? spectrum[bandIdx] : 0;
      const amp =
        isPlaying || hasLiveSignal
          ? Math.max(0.6, (mid - 1.5) * Math.min(1, localEnergy * 0.75 + avgEnergy * 0.65)) * env
          : 0.3;
      const y = mid + Math.sin(i * 0.95 + phase * 1.9) * amp;
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }

    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="flex-shrink-0 overflow-visible">
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

  // Style 3: Minimalist Bouncing Dots driven by real WASAPI bands
  const dotSlice = compact ? levels.slice(0, 5) : levels.slice(0, 7);
  return (
    <div className={`flex items-center justify-between flex-shrink-0 ${compact ? "h-3.5 w-6" : "h-4 w-9"}`}>
      {dotSlice.map((lvl, i) => {
        const offset = Math.min(5, (lvl - 2) * 0.42);
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
