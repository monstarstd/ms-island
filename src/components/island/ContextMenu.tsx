import React from "react";
import {
  FileText,
  Moon,
  PanelTop,
  Pipette,
  Power,
  RectangleHorizontal,
  RefreshCw,
  Sun,
} from "lucide-react";
import { IslandThemeTokens } from "./helpers";

export type DockPosition = "top" | "left" | "right" | "bottom-left" | "bottom-right" | "floating";
export type DockSnapTarget = "top" | "left" | "right" | "bottom-left" | "bottom-right";

interface ContextMenuProps {
  position: { x: number; y: number };
  tokens: IslandThemeTokens;
  isLyricsOpen: boolean;
  barStyle: "notch" | "island";
  dockEdge: DockPosition;
  onCloseMenu: () => void;
  onRefresh: () => void;
  onDockToEdge: (edge: DockSnapTarget) => void;
  onStartColorPicker: () => void;
  onToggleBarStyle: () => void;
  onToggleLyrics: () => void;
  onToggleTheme: () => void;
  onQuit: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = React.memo(
  ({
    position,
    tokens,
    isLyricsOpen,
    barStyle,
    dockEdge,
    onCloseMenu,
    onRefresh,
    onDockToEdge,
    onStartColorPicker,
    onToggleBarStyle,
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
          className={`context-menu-pop fixed z-[100] w-[198px] p-1 rounded-xl border shadow-2xl select-none ${isLight
              ? "bg-[#f8f8f7] border-zinc-300 text-zinc-900 shadow-black/15"
              : "bg-[#121216] border-zinc-800 text-zinc-100 shadow-black/90"
            }`}
          style={{ left: `${position.x}px`, top: `${position.y}px` }}
        >
          {/* Quick Dock Edge Selector (5 Snap Positions) */}
          <div className="px-1.5 pt-1 pb-1.5 space-y-1">
            <div className={`text-[9px] font-semibold uppercase tracking-wider ${mutedText}`}>
              Dock Position
            </div>
            <div
              className={`grid grid-cols-3 p-0.5 rounded-lg border text-[10px] font-medium ${isLight ? "bg-zinc-200/80 border-zinc-300" : "bg-[#0c0c0e] border-zinc-800"
                }`}
            >
              {(["left", "top", "right"] as const).map((edge) => {
                const active = dockEdge === edge;
                return (
                  <button
                    key={edge}
                    onClick={() => {
                      onCloseMenu();
                      onDockToEdge(edge);
                    }}
                    className={`py-0.5 rounded-md capitalize transition-colors ${focusRing} ${active
                        ? isLight
                          ? "bg-white text-zinc-950 font-semibold shadow-sm"
                          : "bg-zinc-800 text-white font-semibold"
                        : isLight
                          ? "text-zinc-600 hover:text-zinc-950"
                          : "text-zinc-400 hover:text-white"
                      }`}
                  >
                    {edge}
                  </button>
                );
              })}
            </div>
            <div
              className={`grid grid-cols-2 p-0.5 rounded-lg border text-[10px] font-medium ${isLight ? "bg-zinc-200/80 border-zinc-300" : "bg-[#0c0c0e] border-zinc-800"
                }`}
            >
              {(
                [
                  { id: "bottom-left", label: "Bottom Left" },
                  { id: "bottom-right", label: "Bottom Right" },
                ] as const
              ).map(({ id, label }) => {
                const active = dockEdge === id;
                return (
                  <button
                    key={id}
                    onClick={() => {
                      onCloseMenu();
                      onDockToEdge(id);
                    }}
                    className={`py-0.5 rounded-md transition-colors ${focusRing} ${active
                        ? isLight
                          ? "bg-white text-zinc-950 font-semibold shadow-sm"
                          : "bg-zinc-800 text-white font-semibold"
                        : isLight
                          ? "text-zinc-600 hover:text-zinc-950"
                          : "text-zinc-400 hover:text-white"
                      }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={`mb-1 h-px ${isLight ? "bg-zinc-200" : "bg-zinc-800"}`} />

          <button
            onClick={onRefresh}
            className={`w-full px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center gap-2 transition-colors ${focusRing} ${isLight ? "hover:bg-zinc-200/80" : "hover:bg-zinc-800"
              }`}
          >
            <RefreshCw className="w-3.5 h-3.5 text-accent" />
            <span>Refresh &amp; Center</span>
          </button>

          <button
            onClick={() => {
              onCloseMenu();
              onStartColorPicker();
            }}
            className={`w-full px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center gap-2 transition-colors ${focusRing} ${
              isLight ? "hover:bg-zinc-200/80" : "hover:bg-zinc-800"
            }`}
          >
            <Pipette className="w-3.5 h-3.5 text-accent" />
            <span>Screen Color Picker</span>
          </button>

          <button
            onClick={() => {
              onCloseMenu();
              onToggleBarStyle();
            }}
            className={`w-full px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center gap-2 transition-colors ${focusRing} ${isLight ? "hover:bg-zinc-200/80" : "hover:bg-zinc-800"
              }`}
          >
            {barStyle === "notch" ? (
              <RectangleHorizontal className={`w-3.5 h-3.5 ${mutedText}`} />
            ) : (
              <PanelTop className={`w-3.5 h-3.5 ${mutedText}`} />
            )}
            <span>{barStyle === "notch" ? "Floating Pill Style" : "Edge Notch Style"}</span>
          </button>

          <button
            onClick={() => {
              onCloseMenu();
              onToggleLyrics();
            }}
            className={`w-full px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center gap-2 transition-colors ${focusRing} ${isLight ? "hover:bg-zinc-200/80" : "hover:bg-zinc-800"
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
            className={`w-full px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center gap-2 transition-colors ${focusRing} ${isLight ? "hover:bg-zinc-200/80" : "hover:bg-zinc-800"
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
            className={`w-full px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center gap-2 transition-colors ${focusRing} ${isLight ? "text-red-600 hover:bg-red-50" : "text-red-400 hover:bg-red-950/50"
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
