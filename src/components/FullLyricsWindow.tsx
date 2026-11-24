import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Copy, Check, FileText, Search, Loader2, Music, Sun, Moon, Pin, PinOff, Minus, Plus } from "lucide-react";
import { MediaTrack } from "../types/media";
import { ThemeMode } from "../types/theme";

interface FullLyricsWindowProps {
  media: MediaTrack;
  lyricsText: string;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onClose: () => void;
  onStartDrag: () => void;
}

export const FullLyricsWindow: React.FC<FullLyricsWindowProps> = ({
  media,
  lyricsText,
  theme,
  onToggleTheme,
  onClose,
  onStartDrag
}) => {
  const [isWindowHovered, setIsWindowHovered] = useState(false);
  const [copiedLyrics, setCopiedLyrics] = useState(false);
  const [copiedTrack, setCopiedTrack] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [customLyrics, setCustomLyrics] = useState<string | null>(null);
  const [isPinned, setIsPinned] = useState(true);
  const [backdropMode, setBackdropMode] = useState<"solid" | "smoked" | "acrylic">(() => {
    const saved = localStorage.getItem("ms-island-lyrics-backdrop");
    return saved === "acrylic" || saved === "smoked" || saved === "solid" ? saved : "solid";
  });
  const [fontSize, setFontSize] = useState<number>(() => {
    const saved = Number(localStorage.getItem("ms-island-lyrics-font"));
    return saved >= 12 && saved <= 20 ? saved : 14;
  });

  const isLight = theme === "light";
  const isAcrylic = backdropMode === "acrylic";
  const isSmoked = backdropMode === "smoked";

  // Sync native Windows DWM Acrylic / Matte backdrop whenever mode or theme changes
  useEffect(() => {
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    if (!isTauri) return;
    invoke("set_lyrics_backdrop", { mode: backdropMode, isLight }).catch((e) => {
      console.error("Failed to set lyrics backdrop:", e);
    });
  }, [backdropMode, isLight]);

  const handleSetBackdrop = (next: "solid" | "smoked" | "acrylic") => {
    setBackdropMode(next);
    localStorage.setItem("ms-island-lyrics-backdrop", next);
  };

  // Reset custom manual lyrics when a new track plays
  useEffect(() => {
    setCustomLyrics(null);
  }, [media.title]);

  // Escape key blurs search input first, otherwise closes window cleanly
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
          target.blur();
          return;
        }
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const adjustFontSize = (delta: number) => {
    const next = Math.max(12, Math.min(20, fontSize + delta));
    setFontSize(next);
    localStorage.setItem("ms-island-lyrics-font", String(next));
  };

  const handleTogglePin = async () => {
    const next = !isPinned;
    setIsPinned(next);
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    if (isTauri) {
      try {
        await invoke("set_lyrics_always_on_top", { pinned: next });
      } catch (e) {
        console.error("Failed to toggle pin:", e);
      }
    }
  };

  const handleCopyLyrics = () => {
    const textToCopy = customLyrics || lyricsText;
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy);
      setCopiedLyrics(true);
      setTimeout(() => setCopiedLyrics(false), 1800);
    }
  };

  const handleCopyTrackInfo = () => {
    const trackInfo =
      media.artist && media.title
        ? `${media.artist} - ${media.title}`
        : media.title || "Unknown Track";
    navigator.clipboard.writeText(trackInfo);
    setCopiedTrack(true);
    setTimeout(() => setCopiedTrack(false), 1800);
  };

  const handleManualSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    try {
      const res = await invoke<string>("search_lyrics_manual", { query: searchQuery.trim() });
      setCustomLyrics(res);
    } catch (err) {
      console.error("Manual search failed:", err);
    } finally {
      setIsSearching(false);
    }
  };

  const displayedLyrics = customLyrics || lyricsText;

  const btnCls = isAcrylic
    ? isLight
      ? "bg-black/[0.06] hover:bg-black/[0.12] text-zinc-900 border-black/12 active:scale-[0.97]"
      : "bg-white/[0.08] hover:bg-white/[0.15] text-zinc-100 border-white/12 active:scale-[0.97]"
    : isLight
      ? "bg-zinc-200/80 hover:bg-zinc-300 text-zinc-800 border-zinc-300 active:scale-[0.97]"
      : "bg-zinc-800/90 hover:bg-zinc-700 text-zinc-200 border-zinc-700 active:scale-[0.97]";

  const shellRadiusCls = isAcrylic ? "rounded-lg" : "rounded-2xl";
  const topRadiusCls = isAcrylic ? "rounded-t-lg" : "rounded-t-2xl";
  const dividerCls = isAcrylic
    ? isLight
      ? "border-black/10"
      : "border-white/10"
    : isLight
      ? "border-zinc-300"
      : "border-zinc-800";

  return (
    <div
      onMouseEnter={() => setIsWindowHovered(true)}
      onMouseLeave={() => setIsWindowHovered(false)}
      className={`w-full h-full flex flex-col ${shellRadiusCls} overflow-hidden select-none border transition-[border-color,box-shadow] duration-150 ease-out ${
        isAcrylic
          ? isLight
            ? "bg-transparent border-black/15 text-zinc-900"
            : "bg-transparent border-white/15 text-zinc-100"
          : isSmoked && !isWindowHovered
            ? isLight
              ? "border-zinc-300/65 shadow-lg text-zinc-900"
              : "border-zinc-800/70 shadow-lg text-zinc-100"
            : isLight
              ? "border-zinc-300 shadow-2xl text-zinc-900"
              : "border-zinc-800 shadow-2xl text-zinc-100"
      }`}
    >
      {/* TOP ZONE: Solid in Solid/Smoked modes, unified transparent Acrylic in Acrylic mode */}
      <div
        className={`flex-shrink-0 border-b transition-[background-color,border-color] duration-150 ${topRadiusCls} ${dividerCls} ${
          isAcrylic
            ? "bg-transparent"
            : isLight
              ? "bg-[#efefec]"
              : "bg-[#121215]"
        }`}
      >
        {/* Draggable Native Header */}
        <div
          className={`flex items-center justify-between px-4 py-2.5 border-b cursor-move transition-colors ${dividerCls}`}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            if ((e.target as HTMLElement).closest("button")) return;
            onStartDrag();
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0 pr-2">
            {media.thumbnail ? (
              <img
                src={media.thumbnail}
                alt="Track cover"
                className="w-7 h-7 rounded-md object-cover flex-shrink-0 border border-zinc-700/40"
              />
            ) : (
              <FileText className={`w-4 h-4 flex-shrink-0 ${isLight ? "text-zinc-600" : "text-zinc-400"}`} />
            )}
            <div className="min-w-0">
              <h3 className="text-xs font-semibold truncate leading-tight">
                {media.title || "Full Lyrics"}
              </h3>
              <p className={`text-[11px] truncate leading-tight mt-0.5 ${isLight ? "text-zinc-600" : "text-zinc-400"}`}>
                {media.artist || "No active media detected"}
              </p>
            </div>
          </div>

          {/* Header Action Buttons */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={handleCopyTrackInfo}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all border focus:outline-none focus-visible:ring-1 focus-visible:ring-[#f97316] ${btnCls}`}
              title="Copy Title & Artist"
            >
              {copiedTrack ? (
                <>
                  <Check className="w-3 h-3 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Music className="w-3 h-3" />
                  <span>Info</span>
                </>
              )}
            </button>

            <button
              onClick={handleCopyLyrics}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all border focus:outline-none focus-visible:ring-1 focus-visible:ring-[#f97316] ${btnCls}`}
              title="Copy Full Lyrics"
            >
              {copiedLyrics ? (
                <>
                  <Check className="w-3 h-3 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Lyrics</span>
                </>
              )}
            </button>

            <button
              onClick={handleTogglePin}
              className={`p-1.5 rounded-md transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-[#f97316] active:scale-[0.95] ${
                isPinned
                  ? "text-[#f97316] hover:bg-zinc-800/40"
                  : isLight
                    ? "text-zinc-500 hover:bg-zinc-200"
                    : "text-zinc-400 hover:bg-zinc-800"
              }`}
              title={isPinned ? "Always on top (Click to unpin)" : "Pin always on top"}
            >
              {isPinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={onToggleTheme}
              className={`p-1.5 rounded-md transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-[#f97316] active:scale-[0.95] ${
                isLight ? "text-zinc-700 hover:bg-zinc-200" : "text-zinc-400 hover:text-white hover:bg-zinc-800"
              }`}
              title={isLight ? "Switch to Dark Mode" : "Switch to Light Mode"}
            >
              {isLight ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={onClose}
              className={`p-1.5 rounded-md transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-[#f97316] active:scale-[0.95] ${
                isLight ? "text-zinc-600 hover:text-red-600 hover:bg-zinc-200" : "text-zinc-400 hover:text-red-400 hover:bg-zinc-800"
              }`}
              title="Close Lyrics Window (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Manual Search Bar (Unified Acrylic in Acrylic mode, Solid in Solid/Smoked) */}
        <form
          onSubmit={handleManualSearch}
          className={`flex items-center gap-1.5 px-3.5 py-2 transition-colors ${
            isAcrylic
              ? "bg-transparent"
              : isLight
                ? "bg-[#f3f3f0]"
                : "bg-[#101013]"
          }`}
        >
          <div className="relative flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search song title or artist..."
              className={`w-full text-xs rounded-lg px-2.5 py-1.5 pl-8 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#f97316] transition-colors border ${
                isAcrylic
                  ? isLight
                    ? "bg-black/[0.06] border-black/15 text-zinc-900 placeholder-zinc-600"
                    : "bg-white/[0.08] border-white/15 text-zinc-100 placeholder-zinc-400"
                  : isLight
                    ? "bg-white border-zinc-300 text-zinc-900 placeholder-zinc-500"
                    : "bg-zinc-900 border-zinc-800 text-zinc-100 placeholder-zinc-500"
              }`}
            />
            <Search className={`w-3.5 h-3.5 absolute left-2.5 top-2 ${isAcrylic ? (isLight ? "text-zinc-600" : "text-zinc-400") : "text-zinc-500"}`} />
          </div>
          <button
            type="submit"
            disabled={isSearching || !searchQuery.trim()}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1 border disabled:opacity-45 active:scale-[0.97] ${
              isLight
                ? "bg-zinc-900 hover:bg-zinc-800 text-white border-zinc-900"
                : "bg-zinc-100 hover:bg-white text-zinc-950 border-zinc-100"
            }`}
          >
            {isSearching ? <Loader2 className="w-3 h-3 animate-spin" /> : "Search"}
          </button>
        </form>
      </div>

      {/* LYRICS BODY BOX: Solid (always 100%) | Smoked (78% -> 100% on hover) | Acrylic (unified glass) */}
      <div
        className={`flex-1 px-6 py-5 overflow-y-auto select-text transition-[background-color] duration-150 ease-out ${
          isAcrylic
            ? "bg-transparent"
            : isSmoked && !isWindowHovered
              ? isLight
                ? "bg-[#f8f8f7]/84"
                : "bg-[#0c0c0e]/78"
              : isLight
                ? "bg-[#f8f8f7]"
                : "bg-[#0c0c0e]"
        }`}
      >
        {displayedLyrics ? (
          <div
            className={`leading-[1.8] whitespace-pre-line tracking-[0.01em] max-w-[42ch] transition-[color] duration-150 ${
              isLight ? "text-zinc-900" : "text-zinc-100"
            }`}
            style={{ fontSize: `${fontSize}px` }}
          >
            {displayedLyrics}
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-center py-10 px-4">
            <p className={`text-xs font-medium ${isLight ? "text-zinc-800" : "text-zinc-200"}`}>
              Waiting for audio playback
            </p>
            <p className={`mt-1 text-[11px] ${isLight ? "text-zinc-600" : "text-zinc-400"}`}>
              Play a track in YouTube or Spotify, or search manually above.
            </p>
          </div>
        )}
      </div>

      {/* Footer: 3-Mode Selector (Solid / Smoked / Acrylic) + Font Size Controls */}
      <div
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          if ((e.target as HTMLElement).closest("button")) return;
          onStartDrag();
        }}
        className={`px-3.5 py-2 border-t flex items-center justify-between text-[11px] cursor-move transition-[background-color,opacity] duration-150 ${dividerCls} ${
          isAcrylic
            ? isLight
              ? "bg-transparent text-zinc-700"
              : "bg-transparent text-zinc-300"
            : isLight
              ? "bg-[#efefec] text-zinc-600"
              : "bg-[#121215] text-zinc-400"
        } ${isSmoked && !isWindowHovered ? "opacity-80" : "opacity-100"}`}
      >
        <div
          className={`grid grid-cols-3 p-0.5 rounded-lg border text-[10px] font-medium ${
            isAcrylic
              ? isLight
                ? "bg-black/[0.06] border-black/12"
                : "bg-white/[0.07] border-white/12"
              : isLight
                ? "bg-zinc-200/80 border-zinc-300"
                : "bg-[#0c0c0e] border-zinc-800"
          }`}
          title="Lyrics background style"
        >
          {(["solid", "smoked", "acrylic"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => handleSetBackdrop(mode)}
              className={`px-2 py-0.5 rounded-md capitalize transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[#f97316] ${
                backdropMode === mode
                  ? isAcrylic
                    ? isLight
                      ? "bg-white/90 text-zinc-950 font-semibold shadow-sm"
                      : "bg-white/20 text-white font-semibold"
                    : isLight
                      ? "bg-white text-zinc-950 font-semibold shadow-sm"
                      : "bg-zinc-800 text-white font-semibold"
                  : isLight
                    ? "text-zinc-600 hover:text-zinc-950"
                    : "text-zinc-400 hover:text-white"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] mr-0.5">Text</span>
          <button
            onClick={() => adjustFontSize(-1)}
            disabled={fontSize <= 12}
            className={`p-1 rounded border disabled:opacity-35 transition-colors ${btnCls}`}
            title="Decrease font size"
          >
            <Minus className="w-2.5 h-2.5" />
          </button>
          <span className="text-[10px] font-mono tabular-nums w-6 text-center">{fontSize}</span>
          <button
            onClick={() => adjustFontSize(1)}
            disabled={fontSize >= 20}
            className={`p-1 rounded border disabled:opacity-35 transition-colors ${btnCls}`}
            title="Increase font size"
          >
            <Plus className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
