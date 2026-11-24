import React, { useState, useEffect } from "react";
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
    } else {
      const queryParams = new URLSearchParams(window.location.search);
      const hashMode = window.location.hash.replace("#", "");
      setWindowMode(queryParams.get("mode") || hashMode || "island");
    }
  }, []);

  // Listen to instantaneous theme changes across webviews
  useEffect(() => {
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    if (!isTauri) return;

    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<ThemeMode>("theme-changed", (event) => {
        if (event.payload === "dark" || event.payload === "light") {
          setTheme(event.payload);
          localStorage.setItem("ms-island-theme", event.payload);
        }
      }).then(fn => {
        unlisten = fn;
      });
    });

    return () => {
      if (unlisten) unlisten();
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

  // Listen to instantaneous window visibility changes across both webviews
  useEffect(() => {
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    if (!isTauri) return;

    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<boolean>("lyrics-visibility-changed", (event) => {
        setIsLyricsOpen(event.payload);
      }).then(fn => {
        unlisten = fn;
      });
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Real-time synchronization loop with Windows SMTC, Lyric Engine & Window Status
  useEffect(() => {
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    if (!isTauri) return;

    let isMounted = true;

    const pollMedia = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        
        // 1. Current media track
        const track = await invoke<MediaTrack | null>("get_current_track");
        if (isMounted && track && track.title) {
          setMedia(track);
        }

        // 2. Lyrics
        const fullLyrics = await invoke<string>("get_full_lyrics");
        if (isMounted && fullLyrics) {
          setLyricsText(fullLyrics);
        }

        // 3. Lyrics Window open/close sync
        const isOpen = await invoke<boolean>("is_lyrics_window_open");
        if (isMounted) {
          setIsLyricsOpen(isOpen);
        }
      } catch (err) {
        console.error("Failed to poll track or lyrics:", err);
      }
    };

    pollMedia();
    const interval = setInterval(pollMedia, 500);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Playback Control Handlers
  const handleTogglePlayPause = async () => {
    setMedia(prev => ({ ...prev, isPlaying: !prev.isPlaying }));
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
    setMedia(prev => ({ ...prev, positionSec: Math.floor(positionSec) }));
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
      setIsLyricsOpen(prev => !prev);
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
    <div className={`w-screen h-screen flex flex-col justify-between overflow-hidden bg-transparent ${theme === "light" ? "light" : "dark"}`}>
      {/* 1. Dynamic Island Window */}
      {windowMode === "island" && (
        <div className="w-full flex justify-center pt-0 z-50">
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
