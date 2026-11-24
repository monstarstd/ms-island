import React, { useState } from "react";
import { Check, Clipboard, Copy, StickyNote, Trash2, X } from "lucide-react";
import { ClipboardEntry } from "../../types/system";
import { IslandThemeTokens } from "./helpers";

interface NotesTabProps {
  tokens: IslandThemeTokens;
  notesMode: "scratchpad" | "clipboard";
  onSetNotesMode: (mode: "scratchpad" | "clipboard") => void;
  notesText: string;
  onNotesChange: (val: string) => void;
  clipboardHistory: ClipboardEntry[];
  winClipboardSynced: boolean;
  onCopyClipItem: (item: ClipboardEntry) => void;
  onDeleteClipItem: (id: string) => void;
  onClearClipboard: () => void;
}

export const NotesTab: React.FC<NotesTabProps> = React.memo(
  ({
    tokens,
    notesMode,
    onSetNotesMode,
    notesText,
    onNotesChange,
    clipboardHistory,
    winClipboardSynced,
    onCopyClipItem,
    onDeleteClipItem,
    onClearClipboard,
  }) => {
    const [notesCopied, setNotesCopied] = useState(false);
    const [copiedClipId, setCopiedClipId] = useState<string | null>(null);
    const { isLight, surfaceSubtle, mutedText, subtleBtnCls, focusRing } = tokens;

    const wordCount = notesText.trim() ? notesText.trim().split(/\s+/).length : 0;

    const handleCopyNotes = () => {
      if (!notesText) return;
      navigator.clipboard.writeText(notesText);
      setNotesCopied(true);
      setTimeout(() => setNotesCopied(false), 1600);
    };

    return (
      <div className="w-full h-full grid grid-rows-[auto_1fr_auto] gap-2">
        <div className="flex items-center justify-between">
          <div
            className={`grid grid-cols-2 p-0.5 rounded-lg border text-[10px] font-medium ${
              isLight ? "bg-zinc-200/80 border-zinc-300" : "bg-[#141418] border-zinc-800"
            }`}
          >
            <button
              onClick={() => onSetNotesMode("scratchpad")}
              className={`px-2.5 py-0.5 rounded-md flex items-center gap-1 transition-all ${
                notesMode === "scratchpad"
                  ? isLight
                    ? "bg-white text-zinc-950 font-semibold shadow-sm"
                    : "bg-zinc-800 text-white font-semibold"
                  : mutedText
              }`}
            >
              <StickyNote className="w-3 h-3" />
              <span>Scratchpad</span>
            </button>
            <button
              onClick={() => onSetNotesMode("clipboard")}
              className={`px-2.5 py-0.5 rounded-md flex items-center gap-1 transition-all ${
                notesMode === "clipboard"
                  ? isLight
                    ? "bg-white text-zinc-950 font-semibold shadow-sm"
                    : "bg-zinc-800 text-white font-semibold"
                  : mutedText
              }`}
            >
              <Clipboard className="w-3 h-3" />
              <span>Clipboard ({clipboardHistory.length})</span>
            </button>
          </div>

          {notesMode === "clipboard" && clipboardHistory.length > 0 && (
            <button
              onClick={onClearClipboard}
              className={`px-2 py-0.5 rounded-md text-[10px] border transition-colors ${subtleBtnCls}`}
            >
              Clear History
            </button>
          )}
        </div>

        {notesMode === "scratchpad" ? (
          <>
            <textarea
              value={notesText}
              onChange={(e) => onNotesChange(e.target.value)}
              placeholder="Quick notes, reminders, or snippets... (Auto-saved locally)"
              className={`w-full h-full resize-none rounded-xl border p-2.5 text-xs leading-relaxed focus:outline-none focus-visible:ring-1 focus-visible:ring-[#f97316] select-text ${
                isLight
                  ? "bg-white border-zinc-300 text-zinc-900 placeholder-zinc-500"
                  : "bg-[#141418] border-zinc-800 text-zinc-100 placeholder-zinc-500"
              }`}
            />

            <div className="grid grid-cols-[1fr_auto] items-center gap-2">
              <span className={`text-[10px] font-mono tabular-nums ${mutedText}`}>
                {wordCount} words · {notesText.length} chars
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleCopyNotes}
                  disabled={!notesText}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-medium border transition-all flex items-center gap-1 disabled:opacity-40 ${focusRing} ${subtleBtnCls}`}
                >
                  {notesCopied ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-500" />
                      <span className="text-emerald-500">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy All</span>
                    </>
                  )}
                </button>
                <button
                  onClick={() => onNotesChange("")}
                  disabled={!notesText}
                  className={`px-2 py-1 rounded-lg text-[10px] font-medium border transition-all flex items-center gap-1 disabled:opacity-40 ${focusRing} ${subtleBtnCls}`}
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear</span>
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className={`scrollable-area overflow-y-auto p-1.5 space-y-1 ${surfaceSubtle}`}>
              {clipboardHistory.length === 0 ? (
                <div className={`w-full h-full flex flex-col items-center justify-center text-center px-4 ${mutedText}`}>
                  <p className="text-[11px] font-medium">Clipboard history is empty</p>
                  <p className="text-[10px] mt-0.5">Copy any text with Ctrl+C to capture it here.</p>
                </div>
              ) : (
                clipboardHistory.map((item) => (
                  <div
                    key={item.id}
                    className={`grid grid-cols-[1fr_auto] items-center gap-2 px-2.5 py-1.5 rounded-lg transition-colors ${
                      isLight ? "bg-zinc-100/80 hover:bg-zinc-200/70" : "bg-[#0c0c0e] hover:bg-zinc-800/80"
                    }`}
                  >
                    <span className="text-[11px] truncate" title={item.text}>
                      {item.text.replace(/\s+/g, " ")}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setCopiedClipId(item.id);
                          setTimeout(() => setCopiedClipId(null), 1400);
                          onCopyClipItem(item);
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${subtleBtnCls}`}
                        title="Copy back to clipboard"
                      >
                        {copiedClipId === item.id ? "Copied" : "Copy"}
                      </button>
                      <button
                        onClick={() => {
                          onNotesChange(notesText ? `${notesText}\n${item.text}` : item.text);
                          onSetNotesMode("scratchpad");
                        }}
                        className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${subtleBtnCls}`}
                        title="Append to Scratchpad"
                      >
                        + Note
                      </button>
                      <button
                        onClick={() => onDeleteClipItem(item.id)}
                        className={`p-0.5 rounded border transition-colors ${subtleBtnCls}`}
                        title="Delete from clipboard history"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className={`flex items-center gap-1.5 text-[10px] ${mutedText}`}>
              {winClipboardSynced ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#f97316] flex-shrink-0" />
                  <span>Synced with Windows Clipboard (Win + V)</span>
                </>
              ) : (
                <span>Local session history · Enable Win + V in Windows Settings to sync</span>
              )}
            </div>
          </>
        )}
      </div>
    );
  }
);
