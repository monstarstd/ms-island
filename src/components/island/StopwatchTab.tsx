import React from "react";
import { Flag } from "lucide-react";
import { formatStopwatch, IslandThemeTokens } from "./helpers";

interface StopwatchTabProps {
  tokens: IslandThemeTokens;
  stopwatchTimeMs: number;
  isStopwatchRunning: boolean;
  stopwatchLaps: number[];
  onToggle: () => void;
  onLap: () => void;
  onReset: () => void;
}

export const StopwatchTab: React.FC<StopwatchTabProps> = React.memo(
  ({
    tokens,
    stopwatchTimeMs,
    isStopwatchRunning,
    stopwatchLaps,
    onToggle,
    onLap,
    onReset,
  }) => {
    const { isLight, surfaceSubtle, mutedText, subtleBtnCls, primaryBtnCls, focusRing } = tokens;

    return (
      <div className="w-full h-full grid grid-cols-12 gap-4 items-stretch">
        <div className="col-span-5 py-1 px-1 flex flex-col justify-between">
          <div>
            <div className={`text-[10px] font-medium ${mutedText}`}>Stopwatch</div>
            <div className="text-[28px] font-mono font-bold tabular-nums tracking-tight mt-2 leading-none">
              {formatStopwatch(stopwatchTimeMs)}
            </div>
          </div>

          <div className="space-y-1.5">
            <button
              onClick={onToggle}
              className={`w-full py-1.5 rounded-lg font-semibold text-[11px] transition-all ${focusRing} ${primaryBtnCls}`}
            >
              {isStopwatchRunning ? "Pause" : "Start"}
            </button>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={onLap}
                disabled={!isStopwatchRunning}
                className={`py-1.5 rounded-lg text-[11px] font-medium disabled:opacity-40 transition-all border flex items-center justify-center gap-1 ${focusRing} ${subtleBtnCls}`}
              >
                <Flag className="w-3 h-3" />
                <span>Lap</span>
              </button>
              <button
                onClick={onReset}
                className={`py-1.5 rounded-lg text-[11px] font-medium transition-all border ${focusRing} ${subtleBtnCls}`}
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        <div className={`col-span-7 p-2.5 flex flex-col overflow-hidden ${surfaceSubtle}`}>
          <div
            className={`flex items-center justify-between text-[10px] font-medium pb-1.5 border-b ${
              isLight ? "border-zinc-200 text-zinc-600" : "border-zinc-800 text-zinc-400"
            }`}
          >
            <span>Lap Splits</span>
            <span className="font-mono tabular-nums">{stopwatchLaps.length} laps</span>
          </div>

          <div className="scrollable-area flex-1 overflow-y-auto pt-1.5 space-y-1 font-mono tabular-nums text-[11px]">
            {stopwatchLaps.length === 0 ? (
              <div className={`w-full h-full flex items-center justify-center text-[11px] font-sans ${mutedText}`}>
                Press Lap while running to record splits
              </div>
            ) : (
              stopwatchLaps.map((lapMs, idx) => (
                <div
                  key={`${stopwatchLaps.length - idx}-${Math.round(lapMs)}`}
                  className={`grid grid-cols-2 items-center px-2 py-1 rounded-md ${
                    isLight ? "bg-zinc-100 text-zinc-800" : "bg-[#0c0c0e] text-zinc-200"
                  }`}
                >
                  <span className={`text-[10px] ${mutedText}`}>Lap #{stopwatchLaps.length - idx}</span>
                  <span className="text-right font-semibold">{formatStopwatch(lapMs)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }
);
