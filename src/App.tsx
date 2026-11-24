import React, { useState, useEffect, useRef } from "react";
import { DynamicIsland } from "./components/DynamicIsland";
import { FullLyricsWindow } from "./components/FullLyricsWindow";
import { MediaTrack } from "./types/media";
import { ThemeMode } from "./types/theme";

const EMPTY_TRACK: MediaTrack = {
  title: "",
  artist: "",
  album: "",
  sourceApp: "YouTube",
  thumbnail: undefined,
  thumbId: null,
  isPlaying: false,
  positionSec: 0,
  durationSec: 0
};

export const App: React.FC = () => {
  const [windowMode, setWindowMode] = useState<string>(() => {
    const queryParams = new URLSearchParams(window.location.search);
    const hashMode = window.location.hash.replace("#", "");
    return queryParams.get("mode") || hashMode || "island";
  });
  const [media, setMedia] = useState<MediaTrack>(EMPTY_TRACK);
  const [lyricsText, setLyricsText] = useState<string>("");
  const [isLyricsOpen, setIsLyricsOpen] = useState<boolean>(false);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem("ms-island-theme");
    return (saved === "light" || saved === "dark") ? saved : "dark";
  });

  const lastThumbIdRef = useRef<string | null>(null);
  const cachedThumbDataRef = useRef<string | undefined>(undefined);

  // Detect which window this is in Tauri
  useEffect(() => {
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    if (isTauri) {
      import("@tauri-apps/api/webviewWindow").then(({ getCurrentWebviewWindow }) => {
        try {
          const label = getCurrentWebviewWindow().label;
          if (label) setWindowMode(label);
        } catch (e) {
          console.error("Failed to get window label", e);
        }
      });
    }
  }, []);

  // Listen to theme, lyrics visibility, lyrics text, and lightweight media events
  useEffect(() => {
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    if (!isTauri) return;

    let unlisteners: Array<() => void> = [];
    let isMounted = true;

    const applyTrackUpdate = async (track: MediaTrack) => {
      if (!isMounted || !track || !track.title) return;

      // Only fetch base64 album cover artwork ONCE when thumbId actually changes!
      const incomingThumbId = track.thumbId || null;
      if (incomingThumbId && incomingThumbId !== lastThumbIdRef.current) {
        lastThumbIdRef.current = incomingThumbId;
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const dataUrl = await invoke<string | null>("get_current_thumbnail");
          cachedThumbDataRef.current = dataUrl || undefined;
        } catch {
          cachedThumbDataRef.current = undefined;
        }
      } else if (!incomingThumbId) {
        lastThumbIdRef.current = null;
        cachedThumbDataRef.current = undefined;
      }

      if (isMounted) {
        setMedia({
          ...track,
          thumbnail: cachedThumbDataRef.current,
        });
      }
    };

    import("@tauri-apps/api/event").then(async ({ listen }) => {
      const u1 = await listen<ThemeMode>("theme-changed", (event) => {
        if (event.payload === "dark" || event.payload === "light") {
          setTheme(event.payload);
          localStorage.setItem("ms-island-theme", event.payload);
        }
      });
      const u2 = await listen<boolean>("lyrics-visibility-changed", (event) => {
        setIsLyricsOpen(event.payload);
      });
      const u3 = await listen<string>("lyrics-updated", (event) => {
        setLyricsText(event.payload);
      });
      const u4 = await listen<MediaTrack>("media-updated", (event) => {
        applyTrackUpdate(event.payload);
      });
      const u5 = await listen("media-cleared", () => {
        if (!isMounted) return;
        lastThumbIdRef.current = null;
        cachedThumbDataRef.current = undefined;
        setMedia(EMPTY_TRACK);
      });
      unlisteners = [u1, u2, u3, u4, u5];
    });

    // Initial state hydration + lightweight 1200ms RAM-cache safety sync (0 WinRT calls!)
    const syncCachedState = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const track = await invoke<MediaTrack | null>("get_current_track");
        if (!isMounted) return;
        if (track && track.title) {
          await applyTrackUpdate(track);
        } else {
          lastThumbIdRef.current = null;
          cachedThumbDataRef.current = undefined;
          setMedia((prev) => (prev.title ? EMPTY_TRACK : prev));
        }
      } catch {}
    };

    import("@tauri-apps/api/core").then(async ({ invoke }) => {
      try {
        const [track, fullLyrics, isOpen] = await Promise.all([
          invoke<MediaTrack | null>("get_current_track"),
          invoke<string>("get_full_lyrics"),
          invoke<boolean>("is_lyrics_window_open"),
        ]);
        if (isMounted) {
          if (track && track.title) await applyTrackUpdate(track);
          if (fullLyrics) setLyricsText(fullLyrics);
          setIsLyricsOpen(isOpen);
        }
      } catch (err) {
        console.error("Failed initial state hydration:", err);
      }
    });

    const safetyPoll = setInterval(syncCachedState, 1200);

    return () => {
      isMounted = false;
      clearInterval(safetyPoll);
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  // Toggle Theme Handler (Dark <-> Light)
  const handleToggleTheme = () => {
    const nextTheme: ThemeMode = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    localStorage.setItem("ms-island-theme", nextTheme);
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    if (isTauri) {
      import("@tauri-apps/api/event").then(({ emit }) => {
        emit("theme-changed", nextTheme);
      });
    }
  };

  // Playback Control Handlers
  const handleTogglePlayPause = async () => {
    setMedia((prev) => ({ ...prev, isPlaying: !prev.isPlaying }));
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("toggle_play_pause");
      } catch (e) {
        console.error("Failed to invoke play pause:", e);
      }
    }
  };

  const handleNext = async () => {
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("skip_next");
      } catch (e) {
        console.error("Failed to invoke skip next:", e);
      }
    }
  };

  const handlePrev = async () => {
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("skip_prev");
      } catch (e) {
        console.error("Failed to invoke skip prev:", e);
      }
    }
  };

  const handleSeek = async (positionSec: number) => {
    setMedia((prev) => ({ ...prev, positionSec: Math.floor(positionSec) }));
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("seek_position", { positionSec: Math.floor(positionSec) });
      } catch (e) {
        console.error("Failed to seek position:", e);
      }
    }
  };

  const handleToggleLyricsWindow = async () => {
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const isOpen = await invoke<boolean>("toggle_lyrics_window");
        setIsLyricsOpen(isOpen);
      } catch (e) {
        console.error("Failed to toggle lyrics window:", e);
      }
    } else {
      setIsLyricsOpen((prev) => !prev);
    }
  };

  const handleCloseLyricsWindow = async () => {
    setIsLyricsOpen(false);
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("close_lyrics_window");
      } catch (e) {
        console.error("Failed to close lyrics window:", e);
      }
    }
  };

  const handleStartDrag = async () => {
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("start_window_drag");
      } catch {
        try {
          const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
          await getCurrentWebviewWindow().startDragging();
        } catch (e) {
          console.error("Failed to start dragging window:", e);
        }
      }
    }
  };

  return (
    <div
      className={`w-screen h-screen flex flex-col justify-between overflow-hidden bg-transparent ${theme === "light" ? "light" : "dark"
        }`}
    >
      {/* 1. Dynamic Island Window */}
      {windowMode === "island" && (
        <div className="w-full h-full z-50">
          <DynamicIsland
            media={media}
            isLyricsOpen={isLyricsOpen}
            theme={theme}
            onToggleTheme={handleToggleTheme}
            onTogglePlayPause={handleTogglePlayPause}
            onNext={handleNext}
            onPrev={handlePrev}
            onSeek={handleSeek}
            onToggleLyricsWindow={handleToggleLyricsWindow}
            onStartDrag={handleStartDrag}
          />
        </div>
      )}

      {/* 2. Full Dedicated Lyrics Popup Window */}
      {windowMode === "lyrics" && (
        <div className="w-full h-full p-2">
          <FullLyricsWindow
            media={media}
            lyricsText={lyricsText}
            theme={theme}
            onToggleTheme={handleToggleTheme}
            onClose={handleCloseLyricsWindow}
            onStartDrag={handleStartDrag}
          />
        </div>
      )}
    </div>
  );
};
