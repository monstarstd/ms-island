import React, { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  X,
  Copy,
  Check,
  FileText,
  Search,
  Loader2,
  Music,
  Pin,
  PinOff,
  Minus,
  Plus,
  RotateCcw,
  PanelRightClose,
  PanelLeftClose,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { LyricsPayload, LyricsSuggestion, MediaTrack } from "../types/media";
import { ThemeMode } from "../types/theme";
import { ScrubBar } from "./ScrubBar";
import { copyTextReliable, formatTime } from "./island/helpers";

interface SyncedLine {
  timeSec: number;
  text: string;
}

function parseLrcLines(lrc: string | null | undefined): SyncedLine[] {
  if (!lrc) return [];
  const lines: SyncedLine[] = [];
  const timeRe = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  for (const rawLine of lrc.split(/\r?\n/)) {
    const matches = [...rawLine.matchAll(timeRe)];
    if (matches.length === 0) continue;
    const text = rawLine.replace(timeRe, "").trim();
    if (!text) continue;
    for (const m of matches) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      const fracRaw = m[3] || "0";
      const frac = Number(fracRaw) / Math.pow(10, fracRaw.length);
      const timeSec = min * 60 + sec + frac;
      if (!Number.isNaN(timeSec)) {
        lines.push({ timeSec, text });
      }
    }
  }

  lines.sort((a, b) => a.timeSec - b.timeSec);
  return lines;
}

interface FullLyricsWindowProps {
  media: MediaTrack;
  lyricsData: LyricsPayload;
  theme: ThemeMode;
  onTogglePlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (positionSec: number) => void;
  onClose: () => void;
  onStartDrag: () => void;
}

export const FullLyricsWindow: React.FC<FullLyricsWindowProps> = ({
  media,
  lyricsData,
  theme,
  onTogglePlayPause,
  onPrev,
  onNext,
  onSeek,
  onClose,
  onStartDrag,
}) => {
  const [copiedLyrics, setCopiedLyrics] = useState(false);
  const [copiedTrack, setCopiedTrack] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [customPayload, setCustomPayload] = useState<LyricsPayload | null>(null);
  const [customMeta, setCustomMeta] = useState<{ title: string; artist: string } | null>(null);

  // Live autocomplete suggestions
  const [suggestions, setSuggestions] = useState<LyricsSuggestion[]>([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const suggestReqIdRef = useRef(0);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  // Synced vs Static mode + smooth playback interpolation
  const [lyricsMode, setLyricsMode] = useState<"synced" | "static">(() => {
    const saved = localStorage.getItem("ms-island-lyrics-mode");
    return saved === "static" ? "static" : "synced";
  });
  const [livePosSec, setLivePosSec] = useState<number>(media.positionSec || 0);
  const syncAnchorRef = useRef<{ basePos: number; updatedAt: number }>({
    basePos: media.positionSec || 0,
    updatedAt: performance.now(),
  });
  const [manualScrollPaused, setManualScrollPaused] = useState(false);
  const manualScrollTimerRef = useRef<number | null>(null);
  const lyricsScrollRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Universal Bar Style (controlled from MS Island) + Hover Auto-Peek (ON by default)
  const [isPinned, setIsPinned] = useState(true);
  const [lyricsDockEdge, setLyricsDockEdge] = useState<"right" | "left" | "floating">(() => {
    const saved = localStorage.getItem("ms-island-lyrics-dock");
    return saved === "left" || saved === "floating" ? saved : "right";
  });
  const [barStyle, setBarStyle] = useState<"notch" | "island">(() => {
    const saved = localStorage.getItem("ms-island-bar-style");
    return saved === "island" ? "island" : "notch";
  });
  const [autoPeek, setAutoPeek] = useState<boolean>(() => {
    const saved = localStorage.getItem("ms-island-lyrics-autopeek");
    return saved === null ? true : saved === "true";
  });
  const [isSideStacked, setIsSideStacked] = useState(false);
  const [isPeekHovered, setIsPeekHovered] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [winSize, setWinSize] = useState<{ w: number; h: number }>(() => ({
    w: typeof window !== "undefined" ? window.innerWidth || 340 : 340,
    h: typeof window !== "undefined" ? window.innerHeight || 468 : 468,
  }));
  const peekOpenTimerRef = useRef<number | null>(null);
  const peekCloseTimerRef = useRef<number | null>(null);

  const [backdropMode, setBackdropMode] = useState<"solid" | "acrylic">(() => {
    const saved = localStorage.getItem("ms-island-lyrics-backdrop");
    return saved === "acrylic" ? "acrylic" : "solid";
  });
  const [fontSize, setFontSize] = useState<number>(() => {
    const saved = Number(localStorage.getItem("ms-island-lyrics-font"));
    return saved >= 12 && saved <= 20 ? saved : 13;
  });

  const isLight = theme === "light";
  const isSideDocked = lyricsDockEdge === "right" || lyricsDockEdge === "left";
  const isCollapsed =
    autoPeek &&
    isSideDocked &&
    !isPeekHovered &&
    !dropdownOpen &&
    !isInputFocused &&
    !isSearching;
  const isAcrylic = backdropMode === "acrylic" && !isCollapsed;

  // Track inner window size for smooth exact-pixel island-shell-spring morph
  useEffect(() => {
    const onResize = () => {
      setWinSize({
        w: window.innerWidth || 340,
        h: window.innerHeight || 468,
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Sync dock edge, universal Notch/Pill style, auto-peek state, and start collapsed on show
  useEffect(() => {
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    if (!isTauri) return;
    let active = true;
    let unlisteners: Array<() => void> = [];

    invoke("set_lyrics_auto_peek", { enabled: autoPeek }).catch(() => {});
    invoke("dock_lyrics_to_edge", { edge: lyricsDockEdge }).catch(() => {});

    Promise.all([
      listen<string>("lyrics-dock-changed", (e) => {
        if (e.payload === "left" || e.payload === "right" || e.payload === "floating") {
          setLyricsDockEdge(e.payload);
          localStorage.setItem("ms-island-lyrics-dock", e.payload);
        }
      }),
      listen<string>("bar-style-changed", (e) => {
        if (e.payload === "notch" || e.payload === "island") {
          setBarStyle(e.payload);
          localStorage.setItem("ms-island-bar-style", e.payload);
        }
      }),
      listen<boolean>("side-stack-active", (e) => {
        setIsSideStacked(Boolean(e.payload));
      }),
      listen<boolean>("lyrics-visibility-changed", (e) => {
        if (e.payload) {
          setIsPeekHovered(false);
          setIsInputFocused(false);
          setDropdownOpen(false);
        }
      }),
    ]).then((fns) => {
      if (active) unlisteners = fns;
      else fns.forEach((fn) => fn());
    });

    return () => {
      active = false;
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  // Notify Rust side-stack coordinator whenever Lyrics expands/collapses (glides Island smoothly!)
  useEffect(() => {
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    if (!isTauri || !isSideDocked || !isSideStacked) return;
    const isLyricsExpanded = !isCollapsed;
    invoke("set_side_stack_focus", { source: "lyrics", active: isLyricsExpanded }).catch(() => {});
    return () => {
      if (isLyricsExpanded) {
        invoke("set_side_stack_focus", { source: "lyrics", active: false }).catch(() => {});
      }
    };
  }, [isSideDocked, isSideStacked, isCollapsed]);

  // Sync native Windows DWM Acrylic / Solid backdrop (temporarily clears Acrylic while collapsed into Peek tab)
  useEffect(() => {
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    if (!isTauri) return;
    const effectiveMode = isCollapsed ? "solid" : backdropMode;
    invoke("set_lyrics_backdrop", { mode: effectiveMode, isLight }).catch((e) => {
      console.error("Failed to set lyrics backdrop:", e);
    });
  }, [backdropMode, isCollapsed, isLight]);

  // Sync exact click-through hit-rect to Rust whenever collapsed into edge Pill/Notch
  useEffect(() => {
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    if (!isTauri) return;

    if (!isCollapsed) {
      invoke("set_lyrics_hit_rect", {
        x: 0,
        y: 0,
        width: winSize.w,
        height: winSize.h,
        pad: 0,
        fullWindow: true,
      }).catch(() => {});
      return;
    }

    const peekW = 46;
    const peekH = 112;
    const sidePad = barStyle === "island" && isSideDocked ? 10 : 0;
    const x =
      lyricsDockEdge === "left"
        ? sidePad
        : Math.max(0, winSize.w - peekW - sidePad);
    const y = Math.max(0, (winSize.h - peekH) / 2);

    invoke("set_lyrics_hit_rect", {
      x,
      y,
      width: peekW,
      height: peekH,
      pad: 0,
      fullWindow: false,
    }).catch(() => {});
  }, [isCollapsed, lyricsDockEdge, barStyle, isSideDocked, winSize]);

  useEffect(() => {
    return () => {
      if (peekOpenTimerRef.current) clearTimeout(peekOpenTimerRef.current);
      if (peekCloseTimerRef.current) clearTimeout(peekCloseTimerRef.current);
    };
  }, []);

  const handleToggleAutoPeek = () => {
    const next = !autoPeek;
    setAutoPeek(next);
    localStorage.setItem("ms-island-lyrics-autopeek", String(next));
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    if (isTauri) {
      invoke("set_lyrics_auto_peek", { enabled: next }).catch(() => {});
    }
    if (next) {
      setIsPeekHovered(true);
      if (lyricsDockEdge === "floating") {
        setLyricsDockEdge("right");
        localStorage.setItem("ms-island-lyrics-dock", "right");
        if (isTauri) {
          invoke("dock_lyrics_to_edge", { edge: "right" }).catch(() => {});
        }
      }
    }
  };

  // Identical snappy hover feel to Dynamic Island (45ms open, 100ms close)
  const handlePeekEnter = () => {
    if (!autoPeek) return;
    if (peekCloseTimerRef.current) {
      clearTimeout(peekCloseTimerRef.current);
      peekCloseTimerRef.current = null;
    }
    if (!isPeekHovered && !peekOpenTimerRef.current) {
      peekOpenTimerRef.current = window.setTimeout(() => {
        peekOpenTimerRef.current = null;
        setIsPeekHovered(true);
      }, 45);
    }
  };

  const handlePeekLeave = () => {
    if (!autoPeek) return;
    if (peekOpenTimerRef.current) {
      clearTimeout(peekOpenTimerRef.current);
      peekOpenTimerRef.current = null;
    }
    peekCloseTimerRef.current = window.setTimeout(() => {
      peekCloseTimerRef.current = null;
      setIsPeekHovered(false);
    }, 100);
  };

  const handleSetBackdrop = (next: "solid" | "acrylic") => {
    setBackdropMode(next);
    localStorage.setItem("ms-island-lyrics-backdrop", next);
  };

  const handleSetLyricsMode = (next: "synced" | "static") => {
    setLyricsMode(next);
    localStorage.setItem("ms-island-lyrics-mode", next);
    setManualScrollPaused(false);
  };

  // Auto-clear manual search & suggestions whenever the active playing track changes
  useEffect(() => {
    setCustomPayload(null);
    setCustomMeta(null);
    setSearchQuery("");
    setSuggestions([]);
    setDropdownOpen(false);
    setActiveIndex(-1);
    setManualScrollPaused(false);
    if (lyricsScrollRef.current) {
      lyricsScrollRef.current.scrollTop = 0;
    }
  }, [media.title, media.artist]);

  // Active lyrics payload & parsed LRC lines
  const activePayload = customPayload || lyricsData;
  const displayedLyrics = activePayload.plainLyrics || "";
  const syncedLines = useMemo(
    () => parseLrcLines(activePayload.syncedLyrics),
    [activePayload.syncedLyrics]
  );
  const hasSynced = syncedLines.length > 0;
  const isSyncedActive = lyricsMode === "synced" && hasSynced;

  // Sync anchor whenever SMTC reports a new playback position
  useEffect(() => {
    syncAnchorRef.current = {
      basePos: media.positionSec || 0,
      updatedAt: performance.now(),
    };
    setLivePosSec(media.positionSec || 0);
  }, [media.positionSec, media.isPlaying, media.title]);

  // Smooth interpolation tick ONLY while Synced view is active and expanded
  useEffect(() => {
    if (!isSyncedActive || !media.isPlaying || isCollapsed) return;
    const id = window.setInterval(() => {
      const elapsed = (performance.now() - syncAnchorRef.current.updatedAt) / 1000;
      const next = syncAnchorRef.current.basePos + elapsed;
      setLivePosSec(media.durationSec > 0 ? Math.min(media.durationSec, next) : next);
    }, 140);
    return () => clearInterval(id);
  }, [isSyncedActive, media.isPlaying, media.durationSec, isCollapsed]);

  const activeLineIdx = useMemo(() => {
    if (!isSyncedActive || syncedLines.length === 0) return -1;
    const t = livePosSec + 0.25;
    let idx = -1;
    for (let i = 0; i < syncedLines.length; i++) {
      if (syncedLines[i].timeSec <= t) idx = i;
      else break;
    }
    return idx;
  }, [isSyncedActive, syncedLines, livePosSec]);

  // Smooth auto-scroll active synced line into comfortable reading position (~36% from top)
  useEffect(() => {
    if (!isSyncedActive || isCollapsed || manualScrollPaused || activeLineIdx < 0) return;
    const container = lyricsScrollRef.current;
    const lineEl = lineRefs.current[activeLineIdx];
    if (!container || !lineEl) return;

    const targetTop = Math.max(
      0,
      lineEl.offsetTop - container.clientHeight * 0.36 + lineEl.clientHeight / 2
    );
    container.scrollTo({ top: targetTop, behavior: "smooth" });
  }, [activeLineIdx, isSyncedActive, isCollapsed, manualScrollPaused]);

  const pauseAutoScrollTemporarily = () => {
    if (!isSyncedActive) return;
    setManualScrollPaused(true);
    if (manualScrollTimerRef.current) clearTimeout(manualScrollTimerRef.current);
    manualScrollTimerRef.current = window.setTimeout(() => {
      setManualScrollPaused(false);
    }, 5000);
  };

  useEffect(() => {
    return () => {
      if (manualScrollTimerRef.current) clearTimeout(manualScrollTimerRef.current);
    };
  }, []);

  // Debounced live smart LRCLIB autocomplete while typing
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
    }, 300);

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

  // Escape key closes dropdown -> blurs input -> closes window; Space toggles Play/Pause when not typing
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping = !!(target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA"));

      if (e.key === "Escape") {
        if (dropdownOpen) {
          setDropdownOpen(false);
          return;
        }
        if (isTyping && target) {
          target.blur();
          return;
        }
        onClose();
        return;
      }

      if (e.key === " " && !isTyping && media.title && !isCollapsed) {
        e.preventDefault();
        onTogglePlayPause();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, dropdownOpen, media.title, isCollapsed, onTogglePlayPause]);

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
    setCustomPayload({
      plainLyrics: item.lyrics,
      syncedLyrics: item.syncedLyrics || null,
      trackName: item.trackName,
      artistName: item.artistName,
      status: "found",
      suggestions: [],
    });
    setCustomMeta({
      title: item.trackName,
      artist: item.artistName || item.albumName || "Manual Selection",
    });
    setSearchQuery(item.artistName ? `${item.trackName} - ${item.artistName}` : item.trackName);
    setDropdownOpen(false);
    setActiveIndex(-1);
    setManualScrollPaused(false);
  };

  const handleResetToPlaying = () => {
    setCustomPayload(null);
    setCustomMeta(null);
    setSearchQuery("");
    setSuggestions([]);
    setDropdownOpen(false);
    setManualScrollPaused(false);
  };

  const handleCopyLyrics = () => {
    if (displayedLyrics) {
      copyTextReliable(displayedLyrics);
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
    copyTextReliable(trackInfo);
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
      const res = await invoke<LyricsPayload>("search_lyrics_manual", {
        query: searchQuery.trim(),
      });
      setCustomPayload(res);
      setCustomMeta({
        title: res.trackName || searchQuery.trim(),
        artist: res.artistName || "Manual Search",
      });
      setManualScrollPaused(false);
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

  const handleSeekLine = (timeSec: number) => {
    setManualScrollPaused(false);
    syncAnchorRef.current = { basePos: timeSec, updatedAt: performance.now() };
    setLivePosSec(timeSec);
    onSeek(Math.floor(timeSec));
  };

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

  const pillGroupCls = isAcrylic
    ? isLight
      ? "bg-black/[0.06] border-black/12"
      : "bg-white/[0.07] border-white/12"
    : isLight
      ? "bg-zinc-200/80 border-zinc-300"
      : "bg-[#0c0c0e] border-zinc-800";

  const pillActiveCls = isAcrylic
    ? isLight
      ? "bg-white/90 text-zinc-950 font-semibold shadow-sm"
      : "bg-white/20 text-white font-semibold"
    : isLight
      ? "bg-white text-zinc-950 font-semibold shadow-sm"
      : "bg-zinc-800 text-white font-semibold";

  const pillIdleCls = isLight
    ? "text-zinc-600 hover:text-zinc-950"
    : "text-zinc-400 hover:text-white";

  const isNotchEdge = barStyle === "notch" && isSideDocked;
  const isFloatingSide = barStyle === "island" && isSideDocked;
  const shellRadiusCls = isCollapsed
    ? isNotchEdge
      ? lyricsDockEdge === "right"
        ? "rounded-l-[18px] rounded-r-none border-r-0"
        : "rounded-r-[18px] rounded-l-none border-l-0"
      : "rounded-[23px]"
    : isAcrylic
      ? "rounded-lg"
      : isNotchEdge
        ? lyricsDockEdge === "right"
          ? "rounded-l-[22px] rounded-r-none border-r-0"
          : "rounded-r-[22px] rounded-l-none border-l-0"
        : "rounded-[22px]";

  const topRadiusCls = isAcrylic
    ? "rounded-t-lg"
    : isNotchEdge
      ? lyricsDockEdge === "right"
        ? "rounded-tl-[22px] rounded-tr-none"
        : "rounded-tr-[22px] rounded-tl-none"
      : "rounded-t-[22px]";

  const dividerCls = isAcrylic
    ? isLight
      ? "border-black/10"
      : "border-white/10"
    : isLight
      ? "border-zinc-300"
      : "border-zinc-800";

  // Inset Solid card by 10px on free edges so the tight subtle shadow NEVER gets clipped by OS window bounds!
  const sideInsetPx = isFloatingSide ? 10 : 0;
  const freeEdgePad = isAcrylic ? 0 : 10;
  const expandedW = isAcrylic
    ? winSize.w
    : Math.max(260, winSize.w - freeEdgePad - sideInsetPx);
  const expandedH = isAcrylic ? winSize.h : Math.max(280, winSize.h - freeEdgePad * 2);

  const shellW = isCollapsed ? 46 : expandedW;
  const shellH = isCollapsed ? 112 : expandedH;

  const outerPadCls = isAcrylic
    ? ""
    : lyricsDockEdge === "left"
      ? isFloatingSide
        ? "pl-[10px] pr-[10px] py-[10px]"
        : "pl-0 pr-[10px] py-[10px]"
      : lyricsDockEdge === "right"
        ? isFloatingSide
          ? "pr-[10px] pl-[10px] py-[10px]"
          : "pr-0 pl-[10px] py-[10px]"
        : "p-[10px]";

  const outerAlignCls = `${
    lyricsDockEdge === "left" ? "justify-start" : "justify-end"
  } items-center ${outerPadCls}`;

  const subtleShadowCls = isAcrylic
    ? ""
    : isLight
      ? "shadow-[0_3px_10px_rgba(0,0,0,0.12)]"
      : "shadow-[0_3px_10px_rgba(0,0,0,0.34)]";

  return (
    <div className={`w-full h-full flex bg-transparent select-none ${outerAlignCls}`}>
      {/* Single Persistent Shell with Exact Same island-shell-spring Morph & Subtle Shadow as Dynamic Island */}
      <div
        onMouseEnter={handlePeekEnter}
        onMouseLeave={handlePeekLeave}
        style={{ width: `${shellW}px`, height: `${shellH}px` }}
        className={`relative island-shell-spring flex flex-col ${shellRadiusCls} ${subtleShadowCls} overflow-hidden border ${
          isAcrylic
            ? isLight
              ? "bg-transparent border-black/15 text-zinc-900"
              : "bg-transparent border-white/15 text-zinc-100"
            : isLight
              ? "bg-[#f5f5f3] border-zinc-300/90 text-zinc-900"
              : "bg-[#0c0c0e] border-zinc-700/80 text-zinc-100"
        }`}
      >
        {isCollapsed ? (
          /* Collapsed Twin Pill/Notch Content (46x112px — identical width & rhythm to Side Island!) */
          <div
            onClick={() => setIsPeekHovered(true)}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              onStartDrag();
            }}
            title={
              displayedTitle !== "Full Lyrics"
                ? `Hover for lyrics · ${displayedTitle}`
                : "Hover for lyrics"
            }
            className="w-full h-full flex flex-col items-center justify-between py-2.5 px-1 cursor-pointer island-panel-fade"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                media.isPlaying ? "bg-accent" : isLight ? "bg-zinc-400" : "bg-zinc-600"
              }`}
            />

            <div className="flex flex-col items-center gap-1">
              <FileText className="w-4 h-4 text-accent" />
              <span
                className={`text-[8px] font-bold uppercase tracking-wider leading-none ${
                  isLight ? "text-zinc-600" : "text-zinc-400"
                }`}
              >
                {hasSynced ? "SYNC" : "LYR"}
              </span>
            </div>

            {lyricsDockEdge === "left" ? (
              <ChevronRight className="w-3 h-3 text-zinc-500" />
            ) : (
              <ChevronLeft className="w-3 h-3 text-zinc-500" />
            )}
          </div>
        ) : (
          /* Expanded Full Lyrics Content */
          <div className="w-full h-full flex flex-col min-w-0 min-h-0 island-panel-fade">
            {/* TOP ZONE */}
            <div
              className={`relative flex-shrink-0 border-b transition-[background-color,border-color] duration-150 ${topRadiusCls} ${dividerCls} ${
                isAcrylic
                  ? "bg-transparent"
                  : isLight
                    ? "bg-[#efefec]"
                    : "bg-[#121215]"
              }`}
            >
              {/* Draggable Compact Header */}
              <div
                className={`flex items-center justify-between px-3 py-2 border-b cursor-move transition-colors ${dividerCls}`}
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  if ((e.target as HTMLElement).closest("button")) return;
                  onStartDrag();
                }}
              >
                <div className="flex items-center gap-2 min-w-0 pr-1">
                  {media.thumbnail && !customMeta ? (
                    <img
                      src={media.thumbnail}
                      alt="Track cover"
                      className="w-6 h-6 rounded-md object-cover flex-shrink-0 border border-zinc-700/40"
                    />
                  ) : (
                    <FileText
                      className={`w-3.5 h-3.5 flex-shrink-0 ${isLight ? "text-zinc-600" : "text-zinc-400"}`}
                    />
                  )}
                  <div className="min-w-0">
                    <h3 className="text-[12px] font-semibold truncate leading-tight" title={displayedTitle}>
                      {displayedTitle}
                    </h3>
                    <p
                      className={`text-[10px] truncate leading-tight mt-0.5 ${isLight ? "text-zinc-600" : "text-zinc-400"}`}
                      title={displayedArtist}
                    >
                      {displayedArtist}
                    </p>
                  </div>
                </div>

                {/* Compact Action Icons */}
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  {customMeta && (
                    <button
                      onClick={handleResetToPlaying}
                      className={`p-1 rounded-md transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.95] text-accent ${
                        isLight ? "hover:bg-black/10" : "hover:bg-white/10"
                      }`}
                      title="Back to currently playing track"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <button
                    onClick={handleCopyTrackInfo}
                    className={`p-1 rounded-md transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.95] ${iconBtnCls}`}
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
                    className={`p-1 rounded-md transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.95] ${iconBtnCls}`}
                    title="Copy Full Lyrics"
                  >
                    {copiedLyrics ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>

                  <button
                    onClick={handleToggleAutoPeek}
                    className={`p-1 rounded-md transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.95] ${
                      autoPeek ? "text-accent hover:bg-white/10" : iconBtnCls
                    }`}
                    title={
                      autoPeek
                        ? "Hover Auto-Peek ON (Click to keep always expanded)"
                        : "Enable Hover Auto-Peek (collapse to edge pill)"
                    }
                  >
                    {lyricsDockEdge === "left" ? (
                      <PanelLeftClose className="w-3.5 h-3.5" />
                    ) : (
                      <PanelRightClose className="w-3.5 h-3.5" />
                    )}
                  </button>

                  <button
                    onClick={handleTogglePin}
                    className={`p-1 rounded-md transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.95] ${
                      isPinned ? "text-accent hover:bg-white/10" : iconBtnCls
                    }`}
                    title={isPinned ? "Always on top (Click to unpin)" : "Pin always on top"}
                  >
                    {isPinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
                  </button>

                  <button
                    onClick={onClose}
                    className={`p-1 rounded-md transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.95] ${
                      isLight
                        ? "text-zinc-600 hover:text-red-600 hover:bg-black/10"
                        : "text-zinc-400 hover:text-red-400 hover:bg-white/10"
                    }`}
                    title="Close Lyrics Window (Esc)"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Manual Search Bar + Smart Live Autocomplete Dropdown */}
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
                        setIsInputFocused(true);
                        if (searchQuery.trim().length >= 2) setDropdownOpen(true);
                      }}
                      onBlur={() => setIsInputFocused(false)}
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

                {/* Smart Live Suggestions Dropdown */}
                {dropdownOpen &&
                  searchQuery.trim().length >= 2 &&
                  (suggestions.length > 0 || isSuggesting) && (
                    <div
                      className={`absolute left-2.5 right-2.5 top-[calc(100%-2px)] z-40 rounded-xl border shadow-2xl overflow-hidden max-h-[235px] overflow-y-auto ${
                        isLight
                          ? "bg-[#f8f8f7] border-zinc-300 text-zinc-900 shadow-black/20"
                          : "bg-[#141419] border-zinc-800 text-zinc-100 shadow-black/80"
                      }`}
                    >
                      {suggestions.length === 0 && isSuggesting ? (
                        <div
                          className={`px-3 py-2.5 text-[11px] flex items-center gap-2 ${isLight ? "text-zinc-600" : "text-zinc-400"}`}
                        >
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
                                  <div
                                    className={`text-[10px] truncate leading-tight mt-0.5 ${isLight ? "text-zinc-600" : "text-zinc-400"}`}
                                  >
                                    {item.artistName}
                                    {item.albumName ? ` · ${item.albumName}` : ""}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  {item.syncedLyrics && (
                                    <span className="text-[8px] font-semibold uppercase tracking-wider px-1 py-0.5 rounded bg-accent/15 text-accent">
                                      Sync
                                    </span>
                                  )}
                                  {item.durationSec > 0 && (
                                    <span
                                      className={`text-[10px] font-mono tabular-nums ${
                                        isHighlighted
                                          ? "text-accent font-semibold"
                                          : "text-zinc-500"
                                      }`}
                                    >
                                      {formatTime(item.durationSec)}
                                    </span>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
              </div>
            </div>

            {/* LYRICS BODY */}
            <div className="relative flex-1 min-h-0 flex flex-col">
              <div
                ref={lyricsScrollRef}
                onWheel={pauseAutoScrollTemporarily}
                onTouchStart={pauseAutoScrollTemporarily}
                className={`flex-1 px-4 py-4 overflow-y-auto transition-[background-color] duration-150 ease-out ${
                  isSyncedActive ? "select-none" : "select-text"
                } ${
                  isAcrylic
                    ? "bg-transparent"
                    : isLight
                      ? "bg-[#f8f8f7]"
                      : "bg-[#0c0c0e]"
                }`}
              >
                {activePayload.status === "loading" ? (
                  <div className="w-full h-full flex flex-col items-center justify-center text-center py-8 px-3 gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-accent" />
                    <p
                      className={`text-[11px] font-medium ${isLight ? "text-zinc-600" : "text-zinc-400"}`}
                    >
                      Searching for lyrics...
                    </p>
                  </div>
                ) : isSyncedActive ? (
                  <div className="space-y-1.5 pb-16 pt-2">
                    {syncedLines.map((line, idx) => {
                      const isActive = idx === activeLineIdx;
                      const isPast = activeLineIdx >= 0 && idx < activeLineIdx;
                      return (
                        <button
                          key={`${line.timeSec}-${idx}`}
                          ref={(el) => {
                            lineRefs.current[idx] = el;
                          }}
                          type="button"
                          onClick={() => handleSeekLine(line.timeSec)}
                          title={`Jump to ${formatTime(Math.floor(line.timeSec))}`}
                          className={`w-full text-left border-l-2 pl-2.5 py-1 rounded-r-md transition-colors duration-150 leading-[1.6] tracking-[0.01em] focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                            isActive
                              ? isLight
                                ? "border-accent text-zinc-950 font-semibold bg-black/[0.04]"
                                : "border-accent text-white font-semibold bg-white/[0.06]"
                              : isPast
                                ? isLight
                                  ? "border-transparent text-zinc-500/80 hover:text-zinc-900 hover:bg-black/[0.03]"
                                  : "border-transparent text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04]"
                                : isLight
                                  ? "border-transparent text-zinc-700/85 hover:text-zinc-950 hover:bg-black/[0.03]"
                                  : "border-transparent text-zinc-300/85 hover:text-white hover:bg-white/[0.04]"
                          }`}
                          style={{ fontSize: `${fontSize}px` }}
                        >
                          {line.text}
                        </button>
                      );
                    })}
                  </div>
                ) : displayedLyrics ? (
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
                    <p
                      className={`text-xs font-medium ${isLight ? "text-zinc-800" : "text-zinc-200"}`}
                    >
                      Waiting for audio playback
                    </p>
                    <p className={`mt-1 text-[11px] ${isLight ? "text-zinc-600" : "text-zinc-400"}`}>
                      Play a track in YouTube or Spotify, or search above.
                    </p>
                  </div>
                )}
              </div>

              {/* Snap-back pill when user scrolls manually during Synced mode */}
              {isSyncedActive && manualScrollPaused && (
                <button
                  type="button"
                  onClick={() => setManualScrollPaused(false)}
                  className={`absolute bottom-2.5 right-3 z-20 px-2.5 py-1 rounded-full text-[10px] font-semibold flex items-center gap-1.5 border shadow-lg transition-all active:scale-[0.96] ${
                    isLight
                      ? "bg-white/95 border-zinc-300 text-zinc-900 hover:bg-zinc-100"
                      : "bg-[#16161b]/95 border-zinc-700 text-zinc-100 hover:bg-zinc-800"
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                  <span>Resume Sync</span>
                </button>
              )}
            </div>

            {/* Slim Mini Player Strip (only shown when active media exists) */}
            {media.title && (
              <div
                className={`px-3 pt-1.5 pb-1.5 border-t flex flex-col gap-1 transition-[background-color] duration-150 ${dividerCls} ${
                  isAcrylic
                    ? "bg-transparent"
                    : isLight
                      ? "bg-[#f3f3f0]"
                      : "bg-[#101013]"
                }`}
              >
                <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
                  <span
                    className={`text-[9px] font-mono tabular-nums ${
                      isLight ? "text-zinc-600" : "text-zinc-400"
                    }`}
                  >
                    {formatTime(Math.floor(isSyncedActive ? livePosSec : media.positionSec || 0))}
                  </span>
                  <ScrubBar
                    value={isSyncedActive ? livePosSec : media.positionSec || 0}
                    max={media.durationSec || 1}
                    onChange={(val) => handleSeekLine(val)}
                    isLight={isLight}
                    accent
                    disabled={!media.durationSec}
                    ariaLabel="Playback timeline"
                  />
                  <span
                    className={`text-[9px] font-mono tabular-nums ${
                      isLight ? "text-zinc-600" : "text-zinc-400"
                    }`}
                  >
                    {formatTime(media.durationSec || 0)}
                  </span>
                </div>

                <div className="flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={onPrev}
                    className={`p-1 rounded-md transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.94] ${iconBtnCls}`}
                    title="Previous track"
                  >
                    <SkipBack className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={onTogglePlayPause}
                    className={`w-6 h-6 rounded-full flex items-center justify-center transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.93] ${
                      isLight
                        ? "bg-zinc-900 hover:bg-zinc-800 text-white"
                        : "bg-zinc-100 hover:bg-white text-zinc-950"
                    }`}
                    title={media.isPlaying ? "Pause (Space)" : "Play (Space)"}
                  >
                    {media.isPlaying ? (
                      <Pause className="w-3 h-3 fill-current" />
                    ) : (
                      <Play className="w-3 h-3 fill-current ml-0.5" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={onNext}
                    className={`p-1 rounded-md transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.94] ${iconBtnCls}`}
                    title="Next track"
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Footer: Backdrop (Solid / Acrylic) + Mode (Synced / Static) + Font Size */}
            <div
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                if ((e.target as HTMLElement).closest("button")) return;
                onStartDrag();
              }}
              className={`px-2.5 py-1.5 border-t flex items-center justify-between gap-1.5 text-[11px] cursor-move transition-[background-color] duration-150 ${dividerCls} ${
                isAcrylic
                  ? isLight
                    ? "bg-transparent text-zinc-700"
                    : "bg-transparent text-zinc-300"
                  : isLight
                    ? "bg-[#efefec] text-zinc-600"
                    : "bg-[#121215] text-zinc-400"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <div
                  className={`grid grid-cols-2 p-0.5 rounded-lg border text-[10px] font-medium ${pillGroupCls}`}
                  title="Lyrics background style"
                >
                  {(["solid", "acrylic"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => handleSetBackdrop(mode)}
                      className={`px-2 py-0.5 rounded-md capitalize transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                        backdropMode === mode ? pillActiveCls : pillIdleCls
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>

                <div
                  className={`grid grid-cols-2 p-0.5 rounded-lg border text-[10px] font-medium ${pillGroupCls}`}
                  title={
                    hasSynced
                      ? "Switch between Synced (auto-scroll + click-to-seek) and Static lyrics"
                      : "No synced timestamps available for this track (showing Static)"
                  }
                >
                  <button
                    type="button"
                    onClick={() => handleSetLyricsMode("synced")}
                    className={`px-2 py-0.5 rounded-md transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                      isSyncedActive
                        ? pillActiveCls
                        : !hasSynced
                          ? "opacity-40 cursor-not-allowed " + pillIdleCls
                          : pillIdleCls
                    }`}
                  >
                    Synced
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSetLyricsMode("static")}
                    className={`px-2 py-0.5 rounded-md transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                      !isSyncedActive ? pillActiveCls : pillIdleCls
                    }`}
                  >
                    Static
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0" title="Lyrics font size">
                <button
                  type="button"
                  onClick={() => adjustFontSize(-1)}
                  disabled={fontSize <= 12}
                  className={`p-1 rounded border disabled:opacity-35 transition-colors ${btnCls}`}
                  title="Decrease font size"
                >
                  <Minus className="w-2.5 h-2.5" />
                </button>
                <span className="text-[10px] font-mono tabular-nums w-4 text-center">{fontSize}</span>
                <button
                  type="button"
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
        )}
      </div>
    </div>
  );
};
