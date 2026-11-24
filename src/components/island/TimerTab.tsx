import React from "react";
import { formatTime, IslandThemeTokens } from "./helpers";

interface TimerTabProps {
  tokens: IslandThemeTokens;
  timerDuration: number;
  timerRemaining: number;
  isTimerRunning: boolean;
  isTimerFinished: boolean;
  onStartPause: () => void;
  onReset: () => void;
  onSetPreset: (seconds: number, autoStart?: boolean) => void;
  onAdjust: (diff: number) => void;
}

export const TimerTab: React.FC<TimerTabProps> = React.memo(
  ({
    tokens,
    timerDuration,
    timerRemaining,
    isTimerRunning,
    isTimerFinished,
    onStartPause,
    onReset,
    onSetPreset,
    onAdjust,
  }) => {
    const { isLight, mutedText, subtleBtnCls, primaryBtnCls, focusRing } = tokens;

    return (
      <div className="w-full h-full grid grid-cols-12 gap-4 items-stretch">
        <div className="col-span-5 py-1 px-1 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-medium ${mutedText}`}>Countdown</span>
              <span
                className={`text-[10px] font-semibold ${
                  isTimerFinished || isTimerRunning ? "text-accent" : mutedText
                }`}
              >
                {isTimerFinished ? "Complete" : isTimerRunning ? "Running" : "Ready"}
              </span>
            </div>
            <div
              className={`text-4xl font-mono font-bold tabular-nums mt-2 leading-none ${
                isTimerFinished ? "text-accent" : ""
              }`}
            >
              {formatTime(timerRemaining)}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <button
              onClick={() => onAdjust(-60)}
              className={`py-1.5 rounded-lg border text-[10px] font-mono transition-all ${focusRing} ${subtleBtnCls}`}
            >
              -1m
            </button>
            <button
              onClick={() => onAdjust(60)}
              className={`py-1.5 rounded-lg border text-[10px] font-mono transition-all ${focusRing} ${subtleBtnCls}`}
            >
              +1m
            </button>
            <button
              onClick={() => onAdjust(10)}
              className={`py-1.5 rounded-lg border text-[10px] font-mono transition-all ${focusRing} ${subtleBtnCls}`}
            >
              +10s
            </button>
          </div>
        </div>

        <div className="col-span-7 flex flex-col justify-between gap-2.5 py-0.5">
          {isTimerFinished ? (
            <div
              className={`flex-1 p-3 flex flex-col justify-between border border-accent/60 rounded-xl ${
                isLight ? "bg-accent/10" : "bg-accent/15"
              }`}
            >
              <div>
                <div className="text-xs font-semibold text-accent">Timer Completed</div>
                <p className={`text-[11px] mt-0.5 ${mutedText}`}>Your countdown reached 0:00.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={onReset}
                  className={`py-1.5 rounded-lg text-xs font-semibold transition-all ${focusRing} ${primaryBtnCls}`}
                >
                  Dismiss
                </button>
                <button
                  onClick={() => onSetPreset(300, true)}
                  className={`py-1.5 rounded-lg text-xs font-medium border transition-all ${focusRing} ${subtleBtnCls}`}
                >
                  +5 min
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { label: "1 min", sec: 60 },
                  { label: "5 min", sec: 300 },
                  { label: "15 min", sec: 900 },
                  { label: "25m Focus", sec: 1500 },
                ].map((preset) => {
                  const active = timerDuration === preset.sec;
                  return (
                    <button
                      key={preset.sec}
                      onClick={() => onSetPreset(preset.sec)}
                      className={`py-2 rounded-lg text-[11px] font-medium transition-all border ${focusRing} ${
                        active
                          ? isLight
                            ? "bg-zinc-900 border-zinc-900 text-white font-semibold"
                            : "bg-zinc-800 border-zinc-600 text-white font-semibold"
                          : subtleBtnCls
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              <div className={`w-full h-1.5 rounded-full overflow-hidden ${isLight ? "bg-zinc-300" : "bg-zinc-800"}`}>
                <div
                  className="h-full bg-accent transition-all duration-300"
                  style={{
                    width: `${
                      timerDuration > 0
                        ? Math.max(0, Math.min(100, ((timerDuration - timerRemaining) / timerDuration) * 100))
                        : 0
                    }%`,
                  }}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={onStartPause}
                  className={`py-1.5 rounded-lg font-semibold text-xs transition-all ${focusRing} ${primaryBtnCls}`}
                >
                  {isTimerRunning ? "Pause" : "Start"}
                </button>
                <button
                  onClick={onReset}
                  className={`py-1.5 rounded-lg text-xs font-medium transition-all border ${focusRing} ${subtleBtnCls}`}
                >
                  Reset
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }
);
