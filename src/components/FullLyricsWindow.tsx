import React, { useState } from "react";
import { X, Copy, Check, FileText, Search, Loader2, Music, Sun, Moon } from "lucide-react";
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
  const [copiedLyrics, setCopiedLyrics] = useState(false);
  const [copiedTrack, setCopiedTrack] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [customLyrics, setCustomLyrics] = useState<string | null>(null);

  const isLight = theme === "light";

  const handleCopyLyrics = () => {
    const textToCopy = customLyrics || lyricsText;
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy);
      setCopiedLyrics(true);
      setTimeout(() => setCopiedLyrics(false), 2000);
    }
  };

  const handleCopyTrackInfo = () => {
    const trackInfo = media.artist && media.title
      ? `${media.artist} - ${media.title}`
      : media.title || "Unknown Track";
    navigator.clipboard.writeText(trackInfo);
    setCopiedTrack(true);
    setTimeout(() => setCopiedTrack(false), 2000);
  };

  const handleManualSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const res = await invoke<string>("search_lyrics_manual", { query: searchQuery.trim() });
      setCustomLyrics(res);
    } catch (err) {
      console.error("Manual search failed:", err);
    } finally {
      setIsSearching(false);
    }
  };

  const displayedLyrics = customLyrics || lyricsText;

  return (
    <div 
      className={`w-full h-full flex flex-col rounded-2xl shadow-2xl overflow-hidden select-none border transition-colors duration-200 ${
        isLight 
          ? "bg-white border-zinc-300 text-zinc-900" 
          : "bg-zinc-950 border-zinc-800 text-white"
      }`}
    >
      {/* Draggable Native Header */}
      <div 
        data-tauri-drag-region
        className={`flex items-center justify-between px-4 py-2.5 border-b cursor-move transition-colors ${
          isLight 
            ? "bg-zinc-100/90 border-zinc-300" 
            : "bg-zinc-900 border-zinc-800"
        }`}
        onMouseDown={onStartDrag}
      >
        <div data-tauri-drag-region className="flex items-center gap-2.5 min-w-0 pr-2">
          <FileText className={`w-4 h-4 flex-shrink-0 ${isLight ? "text-zinc-600" : "text-zinc-400"}`} />
          <div data-tauri-drag-region className="min-w-0">
            <h3 data-tauri-drag-region className="text-xs font-semibold truncate leading-tight">
              {media.title || "Full Lyrics"}
            </h3>
            <p data-tauri-drag-region className={`text-[10px] truncate leading-tight mt-0.5 ${isLight ? "text-zinc-500" : "text-zinc-400"}`}>
              {media.artist || "YouTube / Media Player"}
            </p>
          </div>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Copy Track Info (Artist - Title) Button */}
          <button
            onClick={handleCopyTrackInfo}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors border ${
              isLight
                ? "bg-zinc-200 hover:bg-zinc-300 text-zinc-700 hover:text-zinc-900 border-zinc-300"
                : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border-zinc-700"
            }`}
            title="Copy Title & Artist"
          >
            {copiedTrack ? (
              <>
                <Check className="w-3 h-3 text-emerald-500" />
                <span className="text-emerald-600 font-semibold">Copied Info</span>
              </>
            ) : (
              <>
                <Music className="w-3 h-3" />
                <span>Copy Info</span>
              </>
            )}
          </button>

          {/* Copy Lyrics Button */}
          <button
            onClick={handleCopyLyrics}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors border ${
              isLight
                ? "bg-zinc-200 hover:bg-zinc-300 text-zinc-700 hover:text-zinc-900 border-zinc-300"
                : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border-zinc-700"
            }`}
            title="Copy Full Lyrics"
          >
            {copiedLyrics ? (
              <>
                <Check className="w-3 h-3 text-emerald-500" />
                <span className="text-emerald-600 font-semibold">Copied Lyrics</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copy Lyrics</span>
              </>
            )}
          </button>

          {/* Theme Toggle Button */}
          <button
            onClick={onToggleTheme}
            className={`p-1 rounded transition-colors ${
              isLight 
                ? "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200" 
                : "text-zinc-400 hover:text-white hover:bg-zinc-800"
            }`}
            title={isLight ? "Switch to Dark Mode" : "Switch to Light Mode"}
          >
            {isLight ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
          </button>

          {/* Close Window Button */}
          <button
            onClick={onClose}
            className={`p-1 rounded transition-colors ${
              isLight
                ? "text-zinc-500 hover:text-red-500 hover:bg-zinc-200"
                : "text-zinc-400 hover:text-red-400 hover:bg-zinc-800"
            }`}
            title="Close Lyrics Window"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Manual Search Bar */}
      <form 
        onSubmit={handleManualSearch}
        className={`flex items-center gap-1.5 px-3 py-2 border-b transition-colors ${
          isLight ? "bg-zinc-50 border-zinc-200" : "bg-zinc-900/60 border-zinc-800"
        }`}
      >
        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Type song title or artist to search manually..."
            className={`w-full text-xs rounded-lg px-2.5 py-1.5 pl-8 focus:outline-none transition-colors border ${
              isLight
                ? "bg-white border-zinc-300 text-zinc-900 placeholder-zinc-400 focus:border-zinc-500"
                : "bg-zinc-900 border-zinc-800 text-white placeholder-zinc-500 focus:border-zinc-600"
            }`}
          />
          <Search className={`w-3.5 h-3.5 absolute left-2.5 top-2 ${isLight ? "text-zinc-400" : "text-zinc-500"}`} />
        </div>
        <button
          type="submit"
          disabled={isSearching || !searchQuery.trim()}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1 border disabled:opacity-50 ${
            isLight
              ? "bg-zinc-900 hover:bg-zinc-800 text-white border-zinc-900"
              : "bg-zinc-800 hover:bg-zinc-700 text-white border-zinc-700"
          }`}
        >
          {isSearching ? <Loader2 className="w-3 h-3 animate-spin" /> : "Search"}
        </button>
      </form>

      {/* Scrollable Full Lyrics Body */}
      <div className="flex-1 p-5 overflow-y-auto select-text font-sans">
        {displayedLyrics ? (
          <div className={`text-sm leading-relaxed whitespace-pre-line tracking-wide ${isLight ? "text-zinc-800 font-normal" : "text-zinc-200 font-normal"}`}>
            {displayedLyrics}
          </div>
        ) : (
          <div className={`w-full h-full flex flex-col items-center justify-center text-xs text-center py-10 ${isLight ? "text-zinc-500" : "text-zinc-500"}`}>
            <p>Detecting playback from YouTube / Media Player...</p>
            <p className={`mt-1 text-[11px] ${isLight ? "text-zinc-400" : "text-zinc-600"}`}>Or use the search box above to search manually.</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className={`px-4 py-2 border-t flex items-center justify-between text-[10px] transition-colors ${
        isLight ? "bg-zinc-100 border-zinc-300 text-zinc-500" : "bg-zinc-900/80 border-zinc-800 text-zinc-500"
      }`}>
        <span>Dual Engine: LRCLIB &amp; Genius</span>
        <span>Drag header to move window anywhere</span>
      </div>
    </div>
  );
};
