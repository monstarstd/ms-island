import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { VisualizerStyle } from "../types/system";

interface AudioVisualizerProps {
  isPlaying: boolean;
  style: VisualizerStyle;
  isLight: boolean;
  compact?: boolean;
}

const ZERO_BANDS = [0, 0, 0, 0, 0, 0, 0, 0];

export const AudioVisualizer: React.FC<AudioVisualizerProps> = React.memo(
  ({ isPlaying, style, isLight, compact = false }) => {
    const [spectrum, setSpectrum] = useState<number[]>(ZERO_BANDS);
    const [phase, setPhase] = useState<number>(0);

    // Self-contained WASAPI polling ONLY while this visualizer is mounted & audio is playing
    useEffect(() => {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
      if (!isTauri || !isPlaying) {
        setSpectrum((prev) => (prev.some((v) => v > 0) ? ZERO_BANDS : prev));
        return;
      }

      let mounted = true;
      const poll = async () => {
        try {
          const bands = await invoke<number[]>("get_audio_spectrum");
          if (mounted && Array.isArray(bands) && bands.length === 8) {
            setSpectrum((prev) => {
              for (let i = 0; i < 8; i++) {
                if (Math.abs(prev[i] - bands[i]) > 0.018) return bands;
              }
              return prev;
            });
          }
        } catch {}
      };

      poll();
      const id = window.setInterval(poll, 95);
      return () => {
        mounted = false;
        clearInterval(id);
      };
    }, [isPlaying]);

    // Subtle phase ticker only for the Wave curve smoothness when audio is active
    useEffect(() => {
      if (!isPlaying || style !== "wave") return;
      const id = window.setInterval(() => {
        setPhase(Date.now() / 130);
      }, 65);
      return () => clearInterval(id);
    }, [isPlaying, style]);

    const hasLiveSignal = spectrum.some((v) => v > 0.02);
    const maxPx = compact ? 13 : 16;

    const colorClass = hasLiveSignal
      ? "bg-accent"
      : isLight
        ? "bg-zinc-900"
        : "bg-zinc-100";

    const strokeColor = hasLiveSignal
      ? "var(--accent)"
      : isLight
        ? "#18181b"
        : "#f4f4f5";

    // Style 1: Vertical Bars (GPU-composited scaleY, zero layout thrash)
    if (style === "bars") {
      const slice = compact ? spectrum.slice(0, 6) : spectrum;
      return (
        <div className={`flex items-end gap-[2px] flex-shrink-0 ${compact ? "h-3.5 w-6" : "h-4 w-9"}`}>
          {slice.map((v, i) => {
            const scale = !isPlaying && v < 0.02 ? 0.14 : Math.max(0.14, Math.min(1, 0.14 + v * 0.86));
            return (
              <div
                key={i}
                className={`w-[2px] h-full origin-bottom rounded-full transition-transform duration-75 ${colorClass}`}
                style={{ transform: `scaleY(${scale.toFixed(3)})` }}
              />
            );
          })}
        </div>
      );
    }

    // Style 2: Smooth Real-Energy Wave
    if (style === "wave") {
      const w = compact ? 28 : 40;
      const h = compact ? 14 : 16;
      const mid = h / 2;
      const avgEnergy = spectrum.reduce((a, b) => a + b, 0) / spectrum.length;
      const points: string[] = [];
      const steps = 16;

      for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * w;
        const env = Math.sin((i / steps) * Math.PI);
        const bandIdx = Math.min(7, Math.floor((i / steps) * 8));
        const localEnergy = spectrum[bandIdx];
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
    const dotSlice = compact ? spectrum.slice(0, 5) : spectrum.slice(0, 7);
    return (
      <div className={`flex items-center justify-between flex-shrink-0 ${compact ? "h-3.5 w-6" : "h-4 w-9"}`}>
        {dotSlice.map((v, i) => {
          const lvl = !isPlaying && v < 0.02 ? 2 : Math.max(2, 2 + Math.min(1, v) * (maxPx - 2));
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
  }
);
