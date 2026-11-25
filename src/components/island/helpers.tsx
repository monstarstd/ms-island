import React from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Sun,
  Moon,
  CloudSun,
  Cloud,
  CloudRain,
  CloudLightning,
  CloudFog,
  Snowflake,
  Volume2,
  Volume1,
  VolumeX,
} from "lucide-react";
import { VolumeInfo } from "../../types/system";

export interface IslandThemeTokens {
  isLight: boolean;
  shellSurface: string;
  surfaceSubtle: string;
  mutedText: string;
  subtleBtnCls: string;
  primaryBtnCls: string;
  focusRing: string;
}

export function getIslandThemeTokens(isLight: boolean): IslandThemeTokens {
  return {
    isLight,
    shellSurface: isLight
      ? "bg-[#f5f5f3] border-zinc-300/90 text-zinc-900 shadow-[0_3px_10px_rgba(0,0,0,0.12)]"
      : "bg-[#0c0c0e] border-zinc-700/80 text-zinc-100 shadow-[0_3px_10px_rgba(0,0,0,0.34)]",
    surfaceSubtle: isLight
      ? "bg-white border border-zinc-200/90 rounded-xl"
      : "bg-[#141418] border border-zinc-800/90 rounded-xl",
    mutedText: isLight ? "text-zinc-600" : "text-zinc-400",
    subtleBtnCls: isLight
      ? "bg-zinc-200/80 border-zinc-300 text-zinc-800 hover:bg-zinc-300 active:scale-[0.97]"
      : "bg-zinc-800/80 border-zinc-700/80 text-zinc-200 hover:bg-zinc-700 active:scale-[0.97]",
    primaryBtnCls: isLight
      ? "bg-zinc-900 text-white hover:bg-zinc-800 active:scale-[0.97]"
      : "bg-zinc-100 text-zinc-950 hover:bg-white active:scale-[0.97]",
    focusRing: "focus:outline-none focus-visible:ring-1 focus-visible:ring-accent",
  };
}

export function formatAmPmTime(date: Date, includeSeconds = false): string {
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const hh = hours < 10 ? `0${hours}` : `${hours}`;
  const mm = minutes < 10 ? `0${minutes}` : `${minutes}`;
  if (includeSeconds) {
    const ss = seconds < 10 ? `0${seconds}` : `${seconds}`;
    return `${hh}:${mm}:${ss} ${ampm}`;
  }
  return `${hh}:${mm} ${ampm}`;
}

export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

export function formatStopwatch(totalMs: number): string {
  const mins = Math.floor(totalMs / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const centis = Math.floor((totalMs % 1000) / 10);
  return `${mins < 10 ? "0" : ""}${mins}:${secs < 10 ? "0" : ""}${secs}.${centis < 10 ? "0" : ""}${centis}`;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return "0 KB/s";
  if (bytesPerSec < 1024 * 1024) return `${Math.max(1, Math.round(bytesPerSec / 1024))} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

/** Reliable clipboard write that works even when floating WebView2 window is unfocused */
export async function copyTextReliable(text: string): Promise<void> {
  if (!text) return;
  const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
  if (isTauri) {
    try {
      const ok = await invoke<boolean>("copy_clipboard_item", { id: "", text });
      if (ok) return;
    } catch {}
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {}
}

let sharedAudioCtx: AudioContext | null = null;

/** Call during user click (e.g. Timer Start) to unlock WebView2 AudioContext early */
export function unlockAudioContext(): void {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === "suspended") {
      sharedAudioCtx.resume().catch(() => {});
    }
  } catch {}
}

export function playSoftChime(): void {
  const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
  if (isTauri) {
    invoke("play_timer_chime").catch(() => {});
  }

  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
      sharedAudioCtx = new AudioCtx();
    }
    const ctx = sharedAudioCtx;
    const triggerNotes = () => {
      const now = ctx.currentTime;
      // Crisp 2-pulse triad chime clearly audible even over background audio
      [
        { freq: 587.33, offset: 0.0 },
        { freq: 783.99, offset: 0.13 },
        { freq: 1046.5, offset: 0.26 },
        { freq: 783.99, offset: 0.65 },
        { freq: 1046.5, offset: 0.78 },
      ].forEach(({ freq, offset }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, now + offset);
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.28, now + offset + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.48);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.52);
      });
    };

    if (ctx.state === "suspended") {
      ctx.resume().then(triggerNotes).catch(() => {});
    } else {
      triggerNotes();
    }
  } catch {
    // Native Windows chime above already fired
  }
}

export const WeatherIcon: React.FC<{ icon: string; className?: string }> = ({
  icon,
  className = "w-4 h-4",
}) => {
  switch (icon) {
    case "sun":
      return <Sun className={className} />;
    case "moon":
      return <Moon className={className} />;
    case "cloud-sun":
      return <CloudSun className={className} />;
    case "rain":
      return <CloudRain className={className} />;
    case "storm":
      return <CloudLightning className={className} />;
    case "fog":
      return <CloudFog className={className} />;
    case "snow":
      return <Snowflake className={className} />;
    default:
      return <Cloud className={className} />;
  }
};

export const VolumeIcon: React.FC<{ volume: VolumeInfo; className?: string }> = ({
  volume,
  className = "w-3.5 h-3.5",
}) => {
  if (volume.muted || volume.level === 0) return <VolumeX className={className} />;
  if (volume.level < 50) return <Volume1 className={className} />;
  return <Volume2 className={className} />;
};
