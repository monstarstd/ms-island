import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  X,
  Copy,
  Check,
  FileText,
  Search,
  Loader2,
  Music,
  Sun,
  Moon,
  Pin,
  PinOff,
  Minus,
  Plus,
  RotateCcw,
} from "lucide-react";
import { MediaTrack } from "../types/media";
import { ThemeMode } from "../types/theme";
import { formatTime } from "./island/helpers";

interface LyricsSuggestion {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  durationSec: number;
  lyrics: string;
}

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
  onStartDrag,
}) => {
  const [copiedLyrics, setCopiedLyrics] = useState(false);
  const [copiedTrack, setCopiedTrack] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [customLyrics, setCustomLyrics] = useState<string | null>(null);
  const [customMeta, setCustomMeta] = useState<{ title: string; artist: string } | null>(null);

  // Live autocomplete suggestions
  const [suggestions, setSuggestions] = useState<LyricsSuggestion[]>([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const suggestReqIdRef = useRef(0);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  const [isPinned, setIsPinned] = useState(true);
  const [backdropMode, setBackdropMode] = useState<"solid" | "acrylic">(() => {
    const saved = localStorage.getItem("ms-island-lyrics-backdrop");
    return saved === "acrylic" ? "acrylic" : "solid";
  });
  const [fontSize, setFontSize] = useState<number>(() => {
    const saved = Number(localStorage.getItem("ms-island-lyrics-font"));
    return saved >= 12 && saved <= 20 ? saved : 13;
  });

  const isLight = theme === "light";
  const isAcrylic = backdropMode === "acrylic";

  // Sync native Windows DWM Acrylic / Solid backdrop whenever mode or theme changes
  useEffect(() => {
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    if (!isTauri) return;
    invoke("set_lyrics_backdrop", { mode: backdropMode, isLight }).catch((e) => {
      console.error("Failed to set lyrics backdrop:", e);
    });
  }, [backdropMode, isLight]);

  const handleSetBackdrop = (next: "solid" | "acrylic") => {
    setBackdropMode(next);
    localStorage.setItem("ms-island-lyrics-backdrop", next);
  };

  // Reset custom manual lyrics when a new track plays
  useEffect(() => {
    setCustomLyrics(null);
    setCustomMeta(null);
  }, [media.title]);

  // Debounced live LRCLIB autocomplete while typing
  useEffect(() => {
    const q = searchQuery.trim();
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    if (!isTauri || q.length < 2) {
      setSuggestions([]);
      setIsSuggesting(false);
      setActiveIndex(-1);
      return;
    }

    const reqId = ++suggestReqIdRef.current;
    setIsSuggesting(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await invoke<LyricsSuggestion[]>("suggest_lyrics", { query: q });
        if (suggestReqIdRef.current === reqId) {
          setSuggestions(Array.isArray(res) ? res : []);
          setActiveIndex(-1);
          setIsSuggesting(false);
        }
      } catch {
        if (suggestReqIdRef.current === reqId) {
          setSuggestions([]);
          setIsSuggesting(false);
        }
      }
    }, 320);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [dropdownOpen]);

  // Escape key closes dropdown -> blurs input -> closes window cleanly
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (dropdownOpen) {
          setDropdownOpen(false);
          return;
        }
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
  }, [onClose, dropdownOpen]);

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

  const handleSelectSuggestion = (item: LyricsSuggestion) => {
    setCustomLyrics(item.lyrics);
    setCustomMeta({
      title: item.trackName,
      artist: item.artistName || item.albumName || "Manual Selection",
    });
    setSearchQuery(item.artistName ? `${item.trackName} - ${item.artistName}` : item.trackName);
    setDropdownOpen(false);
    setActiveIndex(-1);
  };

  const handleResetToPlaying = () => {
    setCustomLyrics(null);
    setCustomMeta(null);
    setSearchQuery("");
    setSuggestions([]);
    setDropdownOpen(false);
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
    const activeTitle = customMeta?.title || media.title;
    const activeArtist = customMeta?.artist || media.artist;
    const trackInfo =
      activeArtist && activeTitle
        ? `${activeArtist} - ${activeTitle}`
        : activeTitle || "Unknown Track";
    navigator.clipboard.writeText(trackInfo);
    setCopiedTrack(true);
    setTimeout(() => setCopiedTrack(false), 1800);
  };

  const handleManualSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (dropdownOpen && activeIndex >= 0 && suggestions[activeIndex]) {
      handleSelectSuggestion(suggestions[activeIndex]);
      return;
    }
    if (!searchQuery.trim()) return;

    setDropdownOpen(false);
    setIsSearching(true);
    try {
      const res = await invoke<string>("search_lyrics_manual", { query: searchQuery.trim() });
      setCustomLyrics(res);
      setCustomMeta({ title: searchQuery.trim(), artist: "Manual Search" });
    } catch (err) {
      console.error("Manual search failed:", err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!dropdownOpen || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
    }
  };

  const displayedLyrics = customLyrics || lyricsText;
  const displayedTitle = customMeta?.title || media.title || "Full Lyrics";
  const displayedArtist = customMeta?.artist || media.artist || "No active media detected";

  const btnCls = isAcrylic
    ? isLight
      ? "bg-black/[0.06] hover:bg-black/[0.12] text-zinc-900 border-black/12 active:scale-[0.97]"
      : "bg-white/[0.08] hover:bg-white/[0.15] text-zinc-100 border-white/12 active:scale-[0.97]"
    : isLight
      ? "bg-zinc-200/80 hover:bg-zinc-300 text-zinc-800 border-zinc-300 active:scale-[0.97]"
      : "bg-zinc-800/90 hover:bg-zinc-700 text-zinc-200 border-zinc-700 active:scale-[0.97]";

  const iconBtnCls = isAcrylic
    ? isLight
      ? "text-zinc-700 hover:bg-black/10"
      : "text-zinc-300 hover:text-white hover:bg-white/10"
    : isLight
      ? "text-zinc-700 hover:bg-zinc-200"
      : "text-zinc-400 hover:text-white hover:bg-zinc-800";

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
      className={`w-full h-full flex flex-col ${shellRadiusCls} overflow-hidden select-none border transition-[border-color,box-shadow] duration-150 ease-out ${
        isAcrylic
          ? isLight
            ? "bg-transparent border-black/15 text-zinc-900"
            : "bg-transparent border-white/15 text-zinc-100"
          : isLight
            ? "border-zinc-300 shadow-2xl text-zinc-900"
            : "border-zinc-800 shadow-2xl text-zinc-100"
      }`}
    >
      {/* TOP ZONE: Solid in Solid mode, unified transparent Acrylic in Acrylic mode */}
      <div
        className={`relative flex-shrink-0 border-b transition-[background-color,border-color] duration-150 ${topRadiusCls} ${dividerCls} ${
          isAcrylic
            ? "bg-transparent"
            : isLight
              ? "bg-[#efefec]"
              : "bg-[#121215]"
        }`}
      >
        {/* Draggable Compact Header (optimized for 340px width so title stays readable) */}
        <div
          className={`flex items-center justify-between px-3 py-2 border-b cursor-move transition-colors ${dividerCls}`}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            if ((e.target as HTMLElement).closest("button")) return;
            onStartDrag();
          }}
        >
          <div className="flex items-center gap-2 min-w-0 pr-1.5">
            {media.thumbnail && !customMeta ? (
              <img
                src={media.thumbnail}
                alt="Track cover"
                className="w-6 h-6 rounded-md object-cover flex-shrink-0 border border-zinc-700/40"
              />
            ) : (
              <FileText className={`w-3.5 h-3.5 flex-shrink-0 ${isLight ? "text-zinc-600" : "text-zinc-400"}`} />
            )}
            <div className="min-w-0">
              <h3 className="text-[11px] font-semibold truncate leading-tight" title={displayedTitle}>
                {displayedTitle}
              </h3>
              <p className={`text-[10px] truncate leading-tight mt-0.5 ${isLight ? "text-zinc-600" : "text-zinc-400"}`} title={displayedArtist}>
                {displayedArtist}
              </p>
            </div>
          </div>

          {/* Compact Action Icons */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {customMeta && (
              <button
                onClick={handleResetToPlaying}
                className={`p-1.5 rounded-md transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.95] text-accent ${
                  isLight ? "hover:bg-black/10" : "hover:bg-white/10"
                }`}
                title="Back to currently playing track"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              onClick={handleCopyTrackInfo}
              className={`p-1.5 rounded-md transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.95] ${iconBtnCls}`}
              title="Copy Title & Artist"
            >
              {copiedTrack ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Music className="w-3.5 h-3.5" />
              )}
            </button>

            <button
              onClick={handleCopyLyrics}
              className={`p-1.5 rounded-md transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.95] ${iconBtnCls}`}
              title="Copy Full Lyrics"
            >
              {copiedLyrics ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>

            <button
              onClick={handleTogglePin}
              className={`p-1.5 rounded-md transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.95] ${
                isPinned
                  ? "text-accent hover:bg-white/10"
                  : iconBtnCls
              }`}
              title={isPinned ? "Always on top (Click to unpin)" : "Pin always on top"}
            >
              {isPinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={onToggleTheme}
              className={`p-1.5 rounded-md transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.95] ${iconBtnCls}`}
              title={isLight ? "Switch to Dark Mode" : "Switch to Light Mode"}
            >
              {isLight ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={onClose}
              className={`p-1.5 rounded-md transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.95] ${
                isLight ? "text-zinc-600 hover:text-red-600 hover:bg-black/10" : "text-zinc-400 hover:text-red-400 hover:bg-white/10"
              }`}
              title="Close Lyrics Window (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Manual Search Bar + Live Autocomplete Dropdown */}
        <div ref={searchWrapRef} className="relative">
          <form
            onSubmit={handleManualSearch}
            className={`flex items-center gap-1.5 px-3 py-2 transition-colors ${
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
                onFocus={() => {
                  if (searchQuery.trim().length >= 2) setDropdownOpen(true);
                }}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setDropdownOpen(e.target.value.trim().length >= 2);
                }}
                onKeyDown={handleInputKeyDown}
                placeholder="Search song or artist..."
                className={`w-full text-[11px] rounded-lg px-2.5 py-1.5 pl-7 pr-6 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent transition-colors border ${
                  isAcrylic
                    ? isLight
                      ? "bg-black/[0.06] border-black/15 text-zinc-900 placeholder-zinc-600"
                      : "bg-white/[0.08] border-white/15 text-zinc-100 placeholder-zinc-400"
                    : isLight
                      ? "bg-white border-zinc-300 text-zinc-900 placeholder-zinc-500"
                      : "bg-zinc-900 border-zinc-800 text-zinc-100 placeholder-zinc-500"
                }`}
              />
              <Search
                className={`w-3 h-3 absolute left-2.5 top-[9px] ${
                  isAcrylic ? (isLight ? "text-zinc-600" : "text-zinc-400") : "text-zinc-500"
                }`}
              />
              {isSuggesting && (
                <Loader2 className="w-3 h-3 animate-spin text-accent absolute right-2 top-[9px]" />
              )}
            </div>
            <button
              type="submit"
              disabled={isSearching || !searchQuery.trim()}
              className={`px-2.5 py-1.5 text-[11px] font-medium rounded-lg transition-all flex items-center gap-1 border disabled:opacity-45 active:scale-[0.97] ${
                isLight
                  ? "bg-zinc-900 hover:bg-zinc-800 text-white border-zinc-900"
                  : "bg-zinc-100 hover:bg-white text-zinc-950 border-zinc-100"
              }`}
            >
              {isSearching ? <Loader2 className="w-3 h-3 animate-spin" /> : "Search"}
            </button>
          </form>

          {/* Live Suggestions Dropdown */}
          {dropdownOpen && searchQuery.trim().length >= 2 && (suggestions.length > 0 || isSuggesting) && (
            <div
              className={`absolute left-2.5 right-2.5 top-[calc(100%-2px)] z-40 rounded-xl border shadow-2xl overflow-hidden max-h-[220px] overflow-y-auto ${
                isLight
                  ? "bg-[#f8f8f7] border-zinc-300 text-zinc-900 shadow-black/20"
                  : "bg-[#141419] border-zinc-800 text-zinc-100 shadow-black/80"
              }`}
            >
              {suggestions.length === 0 && isSuggesting ? (
                <div className={`px-3 py-2.5 text-[11px] flex items-center gap-2 ${isLight ? "text-zinc-600" : "text-zinc-400"}`}>
                  <Loader2 className="w-3 h-3 animate-spin text-accent" />
                  <span>Finding matching songs...</span>
                </div>
              ) : (
                <div className="p-1 space-y-0.5">
                  {suggestions.map((item, idx) => {
                    const isHighlighted = idx === activeIndex;
                    return (
                      <button
                        key={`${item.id}-${idx}`}
                        type="button"
                        onMouseEnter={() => setActiveIndex(idx)}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSelectSuggestion(item);
                        }}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg grid grid-cols-[1fr_auto] items-center gap-2 transition-colors ${
                          isHighlighted
                            ? isLight
                              ? "bg-zinc-200/90 text-zinc-950"
                              : "bg-zinc-800 text-white"
                            : isLight
                              ? "hover:bg-zinc-200/70"
                              : "hover:bg-zinc-800/70"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-[11px] font-medium truncate leading-tight">
                            {item.trackName}
                          </div>
                          <div className={`text-[10px] truncate leading-tight mt-0.5 ${isLight ? "text-zinc-600" : "text-zinc-400"}`}>
                            {item.artistName}
                            {item.albumName ? ` · ${item.albumName}` : ""}
                          </div>
                        </div>
                        {item.durationSec > 0 && (
                          <span className={`text-[10px] font-mono tabular-nums flex-shrink-0 ${isHighlighted ? "text-accent font-semibold" : isLight ? "text-zinc-500" : "text-zinc-500"}`}>
                            {formatTime(item.durationSec)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* LYRICS BODY BOX: Solid (always 100%) | Acrylic (unified glass) */}
      <div
        className={`flex-1 px-4 py-4 overflow-y-auto select-text transition-[background-color] duration-150 ease-out ${
          isAcrylic
            ? "bg-transparent"
            : isLight
              ? "bg-[#f8f8f7]"
              : "bg-[#0c0c0e]"
        }`}
      >
        {displayedLyrics ? (
          <div
            className={`leading-[1.75] whitespace-pre-line tracking-[0.01em] transition-[color] duration-150 ${
              isLight ? "text-zinc-900" : "text-zinc-100"
            }`}
            style={{ fontSize: `${fontSize}px` }}
          >
            {displayedLyrics}
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-center py-8 px-3">
            <p className={`text-xs font-medium ${isLight ? "text-zinc-800" : "text-zinc-200"}`}>
              Waiting for audio playback
            </p>
            <p className={`mt-1 text-[11px] ${isLight ? "text-zinc-600" : "text-zinc-400"}`}>
              Play a track in YouTube or Spotify, or search above.
            </p>
          </div>
        )}
      </div>

      {/* Footer: 2-Mode Selector (Solid / Acrylic) + Font Size Controls */}
      <div
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          if ((e.target as HTMLElement).closest("button")) return;
          onStartDrag();
        }}
        className={`px-3 py-1.5 border-t flex items-center justify-between text-[11px] cursor-move transition-[background-color] duration-150 ${dividerCls} ${
          isAcrylic
            ? isLight
              ? "bg-transparent text-zinc-700"
              : "bg-transparent text-zinc-300"
            : isLight
              ? "bg-[#efefec] text-zinc-600"
              : "bg-[#121215] text-zinc-400"
        }`}
      >
        <div
          className={`grid grid-cols-2 p-0.5 rounded-lg border text-[10px] font-medium ${
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
          {(["solid", "acrylic"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => handleSetBackdrop(mode)}
              className={`px-2.5 py-0.5 rounded-md capitalize transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
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

        <div className="flex items-center gap-1">
          <span className="text-[10px] mr-0.5">Text</span>
          <button
            onClick={() => adjustFontSize(-1)}
            disabled={fontSize <= 12}
            className={`p-1 rounded border disabled:opacity-35 transition-colors ${btnCls}`}
            title="Decrease font size"
          >
            <Minus className="w-2.5 h-2.5" />
          </button>
          <span className="text-[10px] font-mono tabular-nums w-5 text-center">{fontSize}</span>
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
