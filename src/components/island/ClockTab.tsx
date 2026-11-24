import React, { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatAmPmTime, IslandThemeTokens } from "./helpers";

interface ClockTabProps {
  tokens: IslandThemeTokens;
  currentTime: Date;
}

export const ClockTab: React.FC<ClockTabProps> = React.memo(({ tokens, currentTime }) => {
  const [calendarMonthOffset, setCalendarMonthOffset] = useState(0);
  const { isLight, surfaceSubtle, mutedText, focusRing } = tokens;

  const displayCalendarDate = new Date(
    currentTime.getFullYear(),
    currentTime.getMonth() + calendarMonthOffset,
    1
  );
  const currentMonthName = displayCalendarDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const daysInMonth = new Date(
    displayCalendarDate.getFullYear(),
    displayCalendarDate.getMonth() + 1,
    0
  ).getDate();
  const firstDayWeekday = new Date(
    displayCalendarDate.getFullYear(),
    displayCalendarDate.getMonth(),
    1
  ).getDay();
  const isCurrentViewingMonth = calendarMonthOffset === 0;

  return (
    <div className="w-full h-full grid grid-cols-12 gap-4 items-stretch">
      <div className="col-span-5 py-1.5 px-1 flex flex-col justify-between">
        <div>
          <div className={`text-[10px] font-medium ${mutedText}`}>Local Time</div>
          <div className="text-[22px] font-mono font-bold tabular-nums tracking-tight mt-1 leading-none">
            {formatAmPmTime(currentTime, true)}
          </div>
        </div>

        <div className="space-y-0.5">
          <div className="text-xs font-semibold">
            {currentTime.toLocaleDateString("en-US", { weekday: "long" })}
          </div>
          <div className={`text-[11px] ${mutedText}`}>
            {currentTime.toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </div>
        </div>

        <div
          className={`pt-2 border-t text-[10px] truncate ${
            isLight ? "border-zinc-200 text-zinc-600" : "border-zinc-800 text-zinc-400"
          }`}
        >
          {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </div>
      </div>

      <div className={`col-span-7 p-2.5 flex flex-col justify-between ${surfaceSubtle}`}>
        <div className="grid grid-cols-[auto_1fr_auto] items-center text-[11px] font-semibold mb-1">
          <button
            onClick={() => setCalendarMonthOffset((prev) => prev - 1)}
            className={`p-1 rounded-md ${focusRing} ${
              isLight ? "text-zinc-700 hover:bg-zinc-100" : "text-zinc-300 hover:bg-zinc-800"
            }`}
            title="Previous Month"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setCalendarMonthOffset(0)}
            className={`text-center rounded px-1.5 py-0.5 transition-colors ${focusRing} ${
              calendarMonthOffset !== 0
                ? isLight
                  ? "hover:bg-zinc-100 text-[#f97316]"
                  : "hover:bg-zinc-800 text-[#f97316]"
                : ""
            }`}
            title={calendarMonthOffset !== 0 ? "Return to current month" : currentMonthName}
          >
            {currentMonthName}
          </button>
          <button
            onClick={() => setCalendarMonthOffset((prev) => prev + 1)}
            className={`p-1 rounded-md ${focusRing} ${
              isLight ? "text-zinc-700 hover:bg-zinc-100" : "text-zinc-300 hover:bg-zinc-800"
            }`}
            title="Next Month"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className={`grid grid-cols-7 text-center text-[10px] font-medium mb-0.5 ${mutedText}`}>
          <span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>
        </div>

        <div className="grid grid-cols-7 gap-y-[1px] text-center text-[10px] tabular-nums">
          {Array.from({ length: firstDayWeekday }).map((_, i) => (
            <span key={`empty-${i}`} className="text-transparent">.</span>
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const dayNum = i + 1;
            const isToday = isCurrentViewingMonth && dayNum === currentTime.getDate();
            return (
              <span
                key={`day-${dayNum}`}
                className={`h-[17px] flex items-center justify-center rounded-full ${
                  isToday
                    ? "bg-[#f97316] text-white font-bold"
                    : isLight
                      ? "text-zinc-800 hover:bg-zinc-100"
                      : "text-zinc-200 hover:bg-zinc-800"
                }`}
              >
                {dayNum}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
});
