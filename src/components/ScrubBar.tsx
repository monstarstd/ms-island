import React, { useRef, useState } from "react";

interface ScrubBarProps {
  value: number; // 0 to max
  max: number;
  onChange: (nextVal: number) => void;
  isLight: boolean;
  accent?: boolean;
  disabled?: boolean;
  formatTooltip?: (val: number) => string;
  ariaLabel: string;
}

export const ScrubBar: React.FC<ScrubBarProps> = ({
  value,
  max,
  onChange,
  isLight,
  accent = false,
  disabled = false,
  formatTooltip,
  ariaLabel,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);

  const safeMax = max > 0 ? max : 100;
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));

  const computeValueFromClientX = (clientX: number) => {
    if (!trackRef.current) return value;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * safeMax;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    onChange(computeValueFromClientX(e.clientX));
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!trackRef.current || disabled) return;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverRatio(ratio);
    if (isDragging) {
      onChange(ratio * safeMax);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setIsDragging(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = safeMax * 0.05;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(Math.min(safeMax, value + step));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(Math.max(0, value - step));
    }
  };

  const fillClass = accent
    ? "bg-accent"
    : isLight
      ? "bg-zinc-900"
      : "bg-zinc-100";

  const trackClass = isLight ? "bg-zinc-300/90" : "bg-zinc-800";

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={Math.round(safeMax)}
      aria-valuenow={Math.round(value)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => {
        if (!isDragging) setHoverRatio(null);
      }}
      onKeyDown={handleKeyDown}
      className={`group relative w-full h-3.5 flex items-center select-none focus:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded-full ${
        disabled ? "opacity-40 cursor-default" : "cursor-pointer"
      }`}
    >
      {/* Hover timestamp preview tooltip */}
      {formatTooltip && hoverRatio !== null && !disabled && (
        <div
          className={`pointer-events-none absolute -top-5 -translate-x-1/2 px-1.5 py-0.5 rounded text-[9px] font-mono tabular-nums font-medium border ${
            isLight
              ? "bg-zinc-900 text-white border-zinc-800"
              : "bg-zinc-100 text-zinc-950 border-zinc-300"
          }`}
          style={{ left: `${Math.max(8, Math.min(92, hoverRatio * 100))}%` }}
        >
          {formatTooltip(hoverRatio * safeMax)}
        </div>
      )}

      {/* Track */}
      <div
        className={`relative w-full rounded-full overflow-hidden transition-all duration-150 ${trackClass} ${
          isDragging || hoverRatio !== null ? "h-[6px]" : "h-[4px]"
        }`}
      >
        <div
          className={`h-full rounded-full transition-[width] ${isDragging ? "duration-0" : "duration-100"} ${fillClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Subtle tactile thumb on hover/drag */}
      {!disabled && (isDragging || hoverRatio !== null) && (
        <div
          className={`pointer-events-none absolute w-2.5 h-2.5 rounded-full -translate-x-1/2 border transition-transform ${
            isLight
              ? "bg-white border-zinc-900"
              : "bg-white border-zinc-950"
          } ${isDragging ? "scale-110" : "scale-100"}`}
          style={{ left: `${pct}%` }}
        />
      )}
    </div>
  );
};
