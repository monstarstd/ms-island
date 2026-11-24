import React from "react";
import { FileText, Moon, Power, RefreshCw, Sun } from "lucide-react";
import { IslandThemeTokens } from "./helpers";

interface ContextMenuProps {
  position: { x: number; y: number };
  tokens: IslandThemeTokens;
  isLyricsOpen: boolean;
  onCloseMenu: () => void;
  onRefresh: () => void;
  onToggleLyrics: () => void;
  onToggleTheme: () => void;
  onQuit: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = React.memo(
  ({
    position,
    tokens,
    isLyricsOpen,
    onCloseMenu,
    onRefresh,
    onToggleLyrics,
    onToggleTheme,
    onQuit,
  }) => {
    const { isLight, mutedText, focusRing } = tokens;

    return (
      <>
        <div
          className="fixed inset-0 z-[90]"
          onClick={onCloseMenu}
          onContextMenu={(e) => {
            e.preventDefault();
            onCloseMenu();
          }}
        />
        <div
          className={`context-menu-pop fixed z-[100] w-[184px] p-1 rounded-xl border shadow-2xl select-none ${
            isLight
              ? "bg-[#f8f8f7] border-zinc-300 text-zinc-900 shadow-black/15"
              : "bg-[#121216] border-zinc-800 text-zinc-100 shadow-black/90"
          }`}
          style={{ left: `${position.x}px`, top: `${position.y}px` }}
        >
          <button
            onClick={onRefresh}
            className={`w-full px-2.5 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-2 transition-colors ${focusRing} ${
              isLight ? "hover:bg-zinc-200/80" : "hover:bg-zinc-800"
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5 text-accent" />
            <span>Refresh &amp; Center</span>
          </button>

          <button
            onClick={() => {
              onCloseMenu();
              onToggleLyrics();
            }}
            className={`w-full px-2.5 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-2 transition-colors ${focusRing} ${
              isLight ? "hover:bg-zinc-200/80" : "hover:bg-zinc-800"
            }`}
          >
            <FileText className={`w-3.5 h-3.5 ${mutedText}`} />
            <span>{isLyricsOpen ? "Hide Lyrics" : "Show Lyrics"}</span>
          </button>

          <button
            onClick={() => {
              onCloseMenu();
              onToggleTheme();
            }}
            className={`w-full px-2.5 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-2 transition-colors ${focusRing} ${
              isLight ? "hover:bg-zinc-200/80" : "hover:bg-zinc-800"
            }`}
          >
            {isLight ? (
              <Moon className={`w-3.5 h-3.5 ${mutedText}`} />
            ) : (
              <Sun className={`w-3.5 h-3.5 ${mutedText}`} />
            )}
            <span>{isLight ? "Dark Mode" : "Light Mode"}</span>
          </button>

          <div className={`my-1 h-px ${isLight ? "bg-zinc-200" : "bg-zinc-800"}`} />

          <button
            onClick={onQuit}
            className={`w-full px-2.5 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-2 transition-colors ${focusRing} ${
              isLight ? "text-red-600 hover:bg-red-50" : "text-red-400 hover:bg-red-950/50"
            }`}
          >
            <Power className="w-3.5 h-3.5" />
            <span>Close MS Island</span>
          </button>
        </div>
      </>
    );
  }
);
