import React from "react";
import { Flame, Hourglass } from "lucide-react";
import { PomodoroPhase } from "../../types/system";
import { formatTime, IslandThemeTokens } from "./helpers";

interface TimerTabProps {
  tokens: IslandThemeTokens;
  timerMode: "countdown" | "pomodoro";
  onSetTimerMode: (mode: "countdown" | "pomodoro") => void;
  pomodoroPhase: PomodoroPhase;
  pomodoroCompleted: number;
  onSelectPomodoroPhase: (phase: PomodoroPhase, autoStart?: boolean) => void;
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
    timerMode,
    onSetTimerMode,
    pomodoroPhase,
    pomodoroCompleted,
    onSelectPomodoroPhase,
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

    const nextBreakPhase: PomodoroPhase =
      pomodoroCompleted > 0 && pomodoroCompleted % 4 === 0 ? "long" : "short";
    const cycleDots = pomodoroCompleted % 4;
    const isPomo = timerMode === "pomodoro";

    const phaseLabel =
      pomodoroPhase === "focus"
        ? "Focus Session"
        : pomodoroPhase === "short"
          ? "Short Break"
          : "Long Break";

    return (
      <div className="w-full h-full grid grid-rows-[auto_1fr] gap-2">
        {/* Top Mode Switcher: Countdown | Pomodoro */}
        <div className="flex items-center justify-between gap-2">
          <div
            className={`grid grid-cols-2 p-0.5 rounded-lg border text-[10px] font-medium ${
              isLight ? "bg-zinc-200/80 border-zinc-300" : "bg-[#141418] border-zinc-800"
            }`}
          >
            <button
              onClick={() => onSetTimerMode("countdown")}
              className={`px-2.5 py-0.5 rounded-md flex items-center justify-center gap-1.5 transition-colors ${focusRing} ${
                !isPomo
                  ? isLight
                    ? "bg-white text-zinc-950 font-semibold shadow-sm"
                    : "bg-zinc-800 text-white font-semibold"
                  : mutedText
              }`}
            >
              <Hourglass className="w-3 h-3" />
              <span>Countdown</span>
            </button>
            <button
              onClick={() => onSetTimerMode("pomodoro")}
              className={`px-2.5 py-0.5 rounded-md flex items-center justify-center gap-1.5 transition-colors ${focusRing} ${
                isPomo
                  ? isLight
                    ? "bg-white text-zinc-950 font-semibold shadow-sm"
                    : "bg-zinc-800 text-white font-semibold"
                  : mutedText
              }`}
            >
              <Flame className={`w-3 h-3 ${isPomo ? "text-accent" : ""}`} />
              <span>Pomodoro</span>
            </button>
          </div>

          {isPomo ? (
            <div className="flex items-center gap-2 text-[10px]">
              <span className={mutedText}>
                Session #{pomodoroCompleted + (pomodoroPhase === "focus" ? 1 : 0)}
              </span>
              <div className="flex items-center gap-1" title={`${pomodoroCompleted} focus sessions completed`}>
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={`w-1.5 h-1.5 rounded-full transition-colors ${
                      i < cycleDots
                        ? "bg-accent"
                        : isLight
                          ? "bg-zinc-300"
                          : "bg-zinc-700"
                    }`}
                  />
                ))}
              </div>
            </div>
          ) : (
            <span
              className={`text-[10px] font-semibold ${
                isTimerFinished || isTimerRunning ? "text-accent" : mutedText
              }`}
            >
              {isTimerFinished ? "Complete" : isTimerRunning ? "Running" : "Ready"}
            </span>
          )}
        </div>

        {/* Main 12-Col Split */}
        <div className="grid grid-cols-12 gap-4 items-stretch min-h-0">
          {/* Left 5 Cols: Hero Timer Display + Fine Controls */}
          <div className="col-span-5 py-0.5 px-1 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className={`text-[10px] font-medium ${mutedText}`}>
                  {isPomo ? phaseLabel : "Remaining"}
                </span>
                {isPomo && (
                  <span
                    className={`text-[10px] font-semibold ${
                      isTimerFinished || isTimerRunning ? "text-accent" : mutedText
                    }`}
                  >
                    {isTimerFinished ? "Done" : isTimerRunning ? "Active" : "Ready"}
                  </span>
                )}
              </div>
              <div
                className={`text-[34px] font-mono font-bold tabular-nums mt-1.5 leading-none tracking-tight ${
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

          {/* Right 7 Cols: Presets / Pomodoro Phases + Progress + Actions */}
          <div className="col-span-7 flex flex-col justify-between gap-2 py-0.5">
            {isTimerFinished ? (
              <div
                className={`flex-1 p-3 flex flex-col justify-between border border-accent/60 rounded-xl ${
                  isLight ? "bg-accent/10" : "bg-accent/15"
                }`}
              >
                <div>
                  <div className="text-[13px] font-semibold text-accent leading-tight">
                    {isPomo
                      ? pomodoroPhase === "focus"
                        ? "Focus Session Complete"
                        : "Break Finished"
                      : "Timer Completed"}
                  </div>
                  <p className={`text-[11px] mt-1 ${mutedText}`}>
                    {isPomo
                      ? pomodoroPhase === "focus"
                        ? nextBreakPhase === "long"
                          ? "4 sessions done — time for a 15m long break."
                          : "Nice work — take a 5m short break."
                        : "Ready for your next 25m focus session."
                      : "Your countdown reached 0:00."}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {isPomo ? (
                    <button
                      onClick={() =>
                        onSelectPomodoroPhase(
                          pomodoroPhase === "focus" ? nextBreakPhase : "focus",
                          true
                        )
                      }
                      className={`py-1.5 rounded-lg text-[11px] font-semibold transition-all ${focusRing} ${primaryBtnCls}`}
                    >
                      {pomodoroPhase === "focus"
                        ? nextBreakPhase === "long"
                          ? "Start 15m Break"
                          : "Start 5m Break"
                        : "Start Focus"}
                    </button>
                  ) : (
                    <button
                      onClick={() => onSetPreset(300, true)}
                      className={`py-1.5 rounded-lg text-[11px] font-semibold transition-all ${focusRing} ${primaryBtnCls}`}
                    >
                      +5 min
                    </button>
                  )}
                  <button
                    onClick={onReset}
                    className={`py-1.5 rounded-lg text-[11px] font-medium border transition-all ${focusRing} ${subtleBtnCls}`}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ) : (
              <>
                {isPomo ? (
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { id: "focus", label: "Focus", sub: "25m" },
                        { id: "short", label: "Short", sub: "5m" },
                        { id: "long", label: "Long", sub: "15m" },
                      ] as const
                    ).map((p) => {
                      const active = pomodoroPhase === p.id;
                      return (
                        <button
                          key={p.id}
                          onClick={() => onSelectPomodoroPhase(p.id, false)}
                          className={`py-2 px-1 rounded-lg text-center transition-all border ${focusRing} ${
                            active
                              ? isLight
                                ? "bg-zinc-900 border-zinc-900 text-white"
                                : "bg-zinc-800 border-zinc-600 text-white"
                              : subtleBtnCls
                          }`}
                        >
                          <div className="text-[11px] font-semibold leading-tight">{p.label}</div>
                          <div
                            className={`text-[10px] font-mono mt-0.5 ${
                              active ? "text-accent" : mutedText
                            }`}
                          >
                            {p.sub}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { label: "1 min", sec: 60 },
                      { label: "5 min", sec: 300 },
                      { label: "15 min", sec: 900 },
                      { label: "25 min", sec: 1500 },
                    ].map((preset) => {
                      const active = timerDuration === preset.sec;
                      return (
                        <button
                          key={preset.sec}
                          onClick={() => onSetPreset(preset.sec)}
                          className={`py-1.5 rounded-lg text-[11px] font-medium transition-all border ${focusRing} ${
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
                )}

                <div
                  className={`w-full h-1.5 rounded-full overflow-hidden ${
                    isLight ? "bg-zinc-300" : "bg-zinc-800"
                  }`}
                >
                  <div
                    className="h-full bg-accent transition-all duration-300"
                    style={{
                      width: `${
                        timerDuration > 0
                          ? Math.max(
                              0,
                              Math.min(100, ((timerDuration - timerRemaining) / timerDuration) * 100)
                            )
                          : 0
                      }%`,
                    }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={onStartPause}
                    className={`py-1.5 rounded-lg font-semibold text-[11px] transition-all ${focusRing} ${primaryBtnCls}`}
                  >
                    {isTimerRunning ? "Pause" : "Start"}
                  </button>
                  <button
                    onClick={onReset}
                    className={`py-1.5 rounded-lg text-[11px] font-medium transition-all border ${focusRing} ${subtleBtnCls}`}
                  >
                    Reset
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
);
