import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Battery,
  BatteryCharging,
  Check,
  Download,
  Loader2,
  Monitor,
  Power,
  RefreshCw,
  Speaker,
} from "lucide-react";
import {
  AudioDeviceInfo,
  BatteryInfo,
  SystemStats,
  UpdateCheckResult,
  VolumeInfo,
} from "../../types/system";
import { ScrubBar } from "../ScrubBar";
import { IslandThemeTokens, VolumeIcon } from "./helpers";

interface SystemTabProps {
  tokens: IslandThemeTokens;
  sysStats: SystemStats;
  cpuHistory: number[];
  battery: BatteryInfo;
  audioDevices: AudioDeviceInfo[];
  volume: VolumeInfo;
  autoHideFullscreen: boolean;
  autostartEnabled: boolean;
  autostartBusy: boolean;
  onSwitchAudioDevice: (device: AudioDeviceInfo) => void;
  onSetVolume: (val: number) => void;
  onToggleMute: () => void;
  onToggleAutoHideFullscreen: () => void;
  onToggleAutostart: () => void;
}

export const SystemTab: React.FC<SystemTabProps> = React.memo(
  ({
    tokens,
    sysStats,
    cpuHistory,
    battery,
    audioDevices,
    volume,
    autoHideFullscreen,
    autostartEnabled,
    autostartBusy,
    onSwitchAudioDevice,
    onSetVolume,
    onToggleMute,
    onToggleAutoHideFullscreen,
    onToggleAutostart,
  }) => {
    const { isLight, surfaceSubtle, mutedText, subtleBtnCls, focusRing } = tokens;
    const [checkingUpdate, setCheckingUpdate] = useState(false);
    const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
    const [updateError, setUpdateError] = useState<string | null>(null);

    const handleCheckUpdates = async () => {
      const isTauri = !!(window as any).__TAURI_INTERNALS__;
      if (!isTauri || checkingUpdate) return;
      setCheckingUpdate(true);
      setUpdateError(null);
      try {
        const res = await invoke<UpdateCheckResult>("check_for_updates");
        setUpdateInfo(res);
      } catch {
        setUpdateError("Offline");
      } finally {
        setCheckingUpdate(false);
      }
    };

    const handleOpenRelease = () => {
      const isTauri = !!(window as any).__TAURI_INTERNALS__;
      if (isTauri && updateInfo?.releaseUrl) {
        invoke("open_external_url", { url: updateInfo.releaseUrl }).catch(() => {});
      }
    };

    return (
      <div className="w-full h-full grid grid-cols-12 gap-2.5 items-stretch min-h-0">
        {/* Left (6 cols): Hardware Monitor + Audio Output Switcher */}
        <div className="col-span-6 grid grid-rows-[auto_1fr] gap-1.5 min-h-0 h-full">
          <div className={`p-2 grid grid-cols-2 gap-2.5 ${surfaceSubtle}`}>
            <div className="flex flex-col justify-between gap-1">
              <div className="flex items-center justify-between">
                <span className={`text-[10px] font-medium ${mutedText}`}>CPU</span>
                <span className="text-xs font-mono font-bold tabular-nums">
                  {sysStats.cpuPercent.toFixed(0)}%
                </span>
              </div>
              <div
                className="grid gap-[2px] items-end h-3.5"
                style={{ gridTemplateColumns: "repeat(14, minmax(0, 1fr))" }}
              >
                {cpuHistory.map((val, idx) => (
                  <div
                    key={idx}
                    className={`rounded-sm transition-all duration-300 ${
                      idx === cpuHistory.length - 1
                        ? "bg-accent"
                        : isLight
                          ? "bg-zinc-700"
                          : "bg-zinc-400"
                    }`}
                    style={{
                      height: `${Math.max(18, Math.min(100, val))}%`,
                      opacity: 0.35 + (idx / cpuHistory.length) * 0.65,
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="flex flex-col justify-between gap-1">
              <div className="flex items-center justify-between">
                <span className={`text-[10px] font-medium ${mutedText}`}>RAM</span>
                <span className="text-xs font-mono font-bold tabular-nums">
                  {sysStats.ramPercent.toFixed(0)}%
                </span>
              </div>
              <div className={`w-full h-1.5 rounded-full overflow-hidden ${isLight ? "bg-zinc-200" : "bg-zinc-800"}`}>
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    isLight ? "bg-zinc-900" : "bg-zinc-100"
                  }`}
                  style={{ width: `${Math.min(100, sysStats.ramPercent)}%` }}
                />
              </div>
              <div className={`text-[10px] font-mono tabular-nums leading-none ${mutedText}`}>
                {sysStats.ramUsedGb.toFixed(1)}/{sysStats.ramTotalGb.toFixed(0)} GB
              </div>
            </div>
          </div>

          <div className={`p-2 flex flex-col overflow-hidden min-h-0 ${surfaceSubtle}`}>
            <div className="flex items-center justify-between pb-1 mb-1 border-b border-zinc-800/30 flex-shrink-0">
              <div className={`flex items-center gap-1.5 text-[10px] font-medium ${mutedText}`}>
                <Speaker className="w-3 h-3" />
                <span>Audio Output</span>
              </div>
              {battery.hasBattery && (
                <div className={`flex items-center gap-1 text-[10px] font-mono tabular-nums ${mutedText}`}>
                  {battery.isCharging ? (
                    <BatteryCharging className="w-3 h-3 text-accent" />
                  ) : (
                    <Battery className="w-3 h-3" />
                  )}
                  <span>{battery.percent}%</span>
                </div>
              )}
            </div>

            <div className="scrollable-area flex-1 min-h-0 overflow-y-auto space-y-1">
              {audioDevices.length === 0 ? (
                <div className={`text-[10px] py-2 text-center ${mutedText}`}>
                  No active output devices
                </div>
              ) : (
                audioDevices.map((dev) => (
                  <button
                    key={dev.id}
                    onClick={() => onSwitchAudioDevice(dev)}
                    className={`w-full text-left px-2 py-1 rounded-md text-[10px] flex items-center justify-between gap-2 transition-colors ${focusRing} ${
                      dev.isDefault
                        ? isLight
                          ? "bg-zinc-900 text-white font-semibold"
                          : "bg-zinc-800 text-white font-semibold"
                        : isLight
                          ? "hover:bg-zinc-100 text-zinc-700"
                          : "hover:bg-zinc-800/60 text-zinc-300"
                    }`}
                    title={dev.name}
                  >
                    <span className="truncate">{dev.name}</span>
                    {dev.isDefault && (
                      <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right (6 cols): Volume ScrubBar + Fullscreen Hide + Auto-Start + About/Updates */}
        <div className="col-span-6 grid grid-rows-[auto_1fr_1fr_auto] gap-1.5 min-h-0 h-full">
          <div className={`px-2.5 py-1.5 flex flex-col justify-center gap-0.5 min-h-0 ${surfaceSubtle}`}>
            <div className="flex items-center justify-between leading-tight">
              <span className={`text-[10px] font-medium ${mutedText}`}>Master Volume</span>
              <span className="text-[11px] font-mono font-bold tabular-nums">
                {volume.muted ? "Muted" : `${volume.level}%`}
              </span>
            </div>
            <div className="grid grid-cols-[auto_1fr] items-center gap-2">
              <button
                onClick={onToggleMute}
                className={`p-0.5 rounded ${focusRing} ${
                  isLight ? "text-zinc-700 hover:bg-zinc-100" : "text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                <VolumeIcon volume={volume} className="w-3.5 h-3.5" />
              </button>
              <ScrubBar
                value={volume.muted ? 0 : volume.level}
                max={100}
                onChange={onSetVolume}
                isLight={isLight}
                accent
                ariaLabel="System master volume"
              />
            </div>
          </div>

          <div className={`px-2.5 py-1 flex items-center justify-between gap-2 min-h-0 ${surfaceSubtle}`}>
            <div className="min-w-0 leading-tight">
              <div className="flex items-center gap-1.5 text-[10.5px] font-medium">
                <Monitor className={`w-3.5 h-3.5 flex-shrink-0 ${mutedText}`} />
                <span className="truncate">Auto-Hide Fullscreen</span>
              </div>
              <div className={`text-[9.5px] truncate mt-0.5 ${mutedText}`}>Hide during videos &amp; games</div>
            </div>
            <button
              onClick={onToggleAutoHideFullscreen}
              aria-label="Toggle auto-hide on fullscreen"
              className={`w-9 h-5 rounded-full p-0.5 transition-colors flex items-center flex-shrink-0 ${focusRing} ${
                autoHideFullscreen
                  ? "bg-accent justify-end"
                  : isLight
                    ? "bg-zinc-300 justify-start"
                    : "bg-zinc-700 justify-start"
              }`}
            >
              <div className="w-4 h-4 rounded-full bg-white shadow-sm" />
            </button>
          </div>

          <div className={`px-2.5 py-1 flex items-center justify-between gap-2 min-h-0 ${surfaceSubtle}`}>
            <div className="min-w-0 leading-tight">
              <div className="flex items-center gap-1.5 text-[10.5px] font-medium">
                <Power className={`w-3.5 h-3.5 flex-shrink-0 ${mutedText}`} />
                <span className="truncate">Start with Windows</span>
              </div>
              <div className={`text-[9.5px] truncate mt-0.5 ${mutedText}`} title="Global Shortcuts: Alt+I Island · Alt+L Lyrics · Alt+Shift+Space Play">
                Alt+I · Alt+L · Alt+Shift+Space
              </div>
            </div>
            <button
              onClick={onToggleAutostart}
              disabled={autostartBusy}
              aria-label="Toggle start with Windows"
              className={`w-9 h-5 rounded-full p-0.5 transition-colors flex items-center flex-shrink-0 ${focusRing} ${
                autostartEnabled
                  ? "bg-accent justify-end"
                  : isLight
                    ? "bg-zinc-300 justify-start"
                    : "bg-zinc-700 justify-start"
              }`}
            >
              <div className="w-4 h-4 rounded-full bg-white shadow-sm" />
            </button>
          </div>

          <div className={`px-2.5 py-1 flex items-center justify-between gap-2 min-h-0 ${surfaceSubtle}`}>
            <div className="min-w-0 leading-tight">
              <div className="text-[10px] font-semibold truncate">MS Island v1.0.0</div>
              <div className={`text-[9px] truncate ${mutedText}`}>Monstar Studio</div>
            </div>
            {updateInfo?.updateAvailable ? (
              <button
                onClick={handleOpenRelease}
                className={`px-2 py-0.5 rounded-md text-[9.5px] font-semibold flex items-center gap-1 bg-accent text-white hover:opacity-90 transition-opacity ${focusRing}`}
                title={`Download v${updateInfo.latestVersion}`}
              >
                <Download className="w-2.5 h-2.5" />
                <span>v{updateInfo.latestVersion}</span>
              </button>
            ) : (
              <button
                onClick={handleCheckUpdates}
                disabled={checkingUpdate}
                className={`px-2 py-0.5 rounded-md text-[9.5px] font-medium flex items-center gap-1 border transition-colors ${focusRing} ${subtleBtnCls}`}
                title="Check GitHub Releases for updates"
              >
                {checkingUpdate ? (
                  <Loader2 className="w-2.5 h-2.5 animate-spin text-accent" />
                ) : updateInfo ? (
                  <Check className="w-2.5 h-2.5 text-emerald-500" />
                ) : (
                  <RefreshCw className="w-2.5 h-2.5" />
                )}
                <span>
                  {checkingUpdate
                    ? "Checking"
                    : updateError
                      ? updateError
                      : updateInfo
                        ? "Up to date"
                        : "Updates"}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
);
