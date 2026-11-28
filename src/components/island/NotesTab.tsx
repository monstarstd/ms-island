import React, { useState } from "react";
import {
  Bookmark,
  Check,
  Clipboard,
  Copy,
  Pipette,
  Plus,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { ClipboardEntry, QuickSnippet } from "../../types/system";
import { copyTextReliable, IslandThemeTokens } from "./helpers";

interface NotesTabProps {
  tokens: IslandThemeTokens;
  notesMode: "scratchpad" | "snippets" | "clipboard";
  onSetNotesMode: (mode: "scratchpad" | "snippets" | "clipboard") => void;
  notesText: string;
  onNotesChange: (val: string) => void;
  snippets: QuickSnippet[];
  onAddSnippet: (label: string, text: string) => void;
  onDeleteSnippet: (id: string) => void;
  recentColors: string[];
  onStartColorPicker: () => void;
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
    snippets,
    onAddSnippet,
    onDeleteSnippet,
    recentColors,
    onStartColorPicker,
    clipboardHistory,
    winClipboardSynced,
    onCopyClipItem,
    onDeleteClipItem,
    onClearClipboard,
  }) => {
    const [notesCopied, setNotesCopied] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [addingSnippet, setAddingSnippet] = useState(false);
    const [newLabel, setNewLabel] = useState("");
    const [newText, setNewText] = useState("");
    const { isLight, surfaceSubtle, mutedText, subtleBtnCls, primaryBtnCls, focusRing } = tokens;

    const wordCount = notesText.trim() ? notesText.trim().split(/\s+/).length : 0;

    const handleCopyNotes = () => {
      if (!notesText) return;
      copyTextReliable(notesText);
      setNotesCopied(true);
      setTimeout(() => setNotesCopied(false), 1600);
    };

    const handleCopyValue = (id: string, value: string) => {
      copyTextReliable(value);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1400);
    };

    const handleSaveSnippet = (e: React.FormEvent) => {
      e.preventDefault();
      const text = newText.trim();
      if (!text) return;
      const label = newLabel.trim() || text.slice(0, 24);
      onAddSnippet(label, text);
      setNewLabel("");
      setNewText("");
      setAddingSnippet(false);
    };

    return (
      <div className="w-full h-full grid grid-rows-[auto_1fr_auto] gap-2 min-h-0">
        {/* Top 3-Mode Switcher: Notes | Snippets | Clipboard */}
        <div className="flex items-center justify-between gap-2">
          <div
            className={`grid grid-cols-3 p-0.5 rounded-lg border text-[10px] font-medium ${
              isLight ? "bg-zinc-200/80 border-zinc-300" : "bg-[#141418] border-zinc-800"
            }`}
          >
            <button
              onClick={() => onSetNotesMode("scratchpad")}
              className={`px-2 py-0.5 rounded-md flex items-center justify-center gap-1 transition-all ${focusRing} ${
                notesMode === "scratchpad"
                  ? isLight
                    ? "bg-white text-zinc-950 font-semibold shadow-sm"
                    : "bg-zinc-800 text-white font-semibold"
                  : mutedText
              }`}
            >
              <StickyNote className="w-3 h-3" />
              <span>Notes</span>
            </button>
            <button
              onClick={() => onSetNotesMode("snippets")}
              className={`px-2 py-0.5 rounded-md flex items-center justify-center gap-1 transition-all ${focusRing} ${
                notesMode === "snippets"
                  ? isLight
                    ? "bg-white text-zinc-950 font-semibold shadow-sm"
                    : "bg-zinc-800 text-white font-semibold"
                  : mutedText
              }`}
            >
              <Bookmark className="w-3 h-3" />
              <span>Snippets{snippets.length > 0 ? ` (${snippets.length})` : ""}</span>
            </button>
            <button
              onClick={() => onSetNotesMode("clipboard")}
              className={`px-2 py-0.5 rounded-md flex items-center justify-center gap-1 transition-all ${focusRing} ${
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

          {notesMode === "snippets" && (
            <button
              onClick={() => setAddingSnippet((prev) => !prev)}
              className={`px-2 py-0.5 rounded-md text-[10px] font-medium border flex items-center gap-1 transition-colors ${focusRing} ${
                addingSnippet ? primaryBtnCls : subtleBtnCls
              }`}
            >
              {addingSnippet ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
              <span>{addingSnippet ? "Cancel" : "New"}</span>
            </button>
          )}

          {notesMode === "clipboard" && clipboardHistory.length > 0 && (
            <button
              onClick={onClearClipboard}
              className={`px-2 py-0.5 rounded-md text-[10px] border transition-colors ${focusRing} ${subtleBtnCls}`}
            >
              Clear
            </button>
          )}
        </div>

        {/* Mode 1: Scratchpad */}
        {notesMode === "scratchpad" && (
          <>
            <textarea
              value={notesText}
              onChange={(e) => onNotesChange(e.target.value)}
              placeholder="Quick notes, reminders, or drafts... (Auto-saved locally)"
              className={`w-full h-full resize-none rounded-xl border p-2.5 text-[11px] leading-relaxed focus:outline-none focus-visible:ring-1 focus-visible:ring-accent select-text ${
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
        )}

        {/* Mode 2: Quick Snippets + Recent Picked Colors */}
        {notesMode === "snippets" && (
          <>
            <div className={`scrollable-area overflow-y-auto p-1.5 space-y-1.5 min-h-0 ${surfaceSubtle}`}>
              {addingSnippet && (
                <form
                  onSubmit={handleSaveSnippet}
                  className={`p-1.5 rounded-lg border grid grid-cols-[110px_1fr_auto] items-center gap-1.5 ${
                    isLight ? "bg-zinc-100 border-zinc-300" : "bg-[#0c0c0e] border-zinc-700/80"
                  }`}
                >
                  <input
                    type="text"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="Label (e.g. Email)"
                    className={`h-7 px-2 text-[11px] rounded-md border focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                      isLight
                        ? "bg-white border-zinc-300 text-zinc-900 placeholder-zinc-500"
                        : "bg-[#141418] border-zinc-800 text-zinc-100 placeholder-zinc-500"
                    }`}
                  />
                  <input
                    type="text"
                    value={newText}
                    onChange={(e) => setNewText(e.target.value)}
                    placeholder="Text to copy in 1 click..."
                    autoFocus
                    className={`h-7 px-2 text-[11px] rounded-md border focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                      isLight
                        ? "bg-white border-zinc-300 text-zinc-900 placeholder-zinc-500"
                        : "bg-[#141418] border-zinc-800 text-zinc-100 placeholder-zinc-500"
                    }`}
                  />
                  <button
                    type="submit"
                    disabled={!newText.trim()}
                    className={`h-7 px-2.5 rounded-md text-[10px] font-semibold disabled:opacity-40 ${focusRing} ${primaryBtnCls}`}
                  >
                    Save
                  </button>
                </form>
              )}

              {snippets.length === 0 && !addingSnippet ? (
                <div className={`w-full h-full flex flex-col items-center justify-center text-center px-4 ${mutedText}`}>
                  <p className="text-[11px] font-medium">No quick snippets saved yet</p>
                  <p className="text-[10px] mt-0.5">
                    Click New to store emails, commands, or templates for 1-click copy.
                  </p>
                </div>
              ) : (
                snippets.map((snip) => (
                  <div
                    key={snip.id}
                    onClick={() => handleCopyValue(snip.id, snip.text)}
                    className={`grid grid-cols-[1fr_auto] items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${
                      isLight ? "bg-zinc-100/80 hover:bg-zinc-200/70" : "bg-[#0c0c0e] hover:bg-zinc-800/80"
                    }`}
                    title={`Click to copy: ${snip.text}`}
                  >
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold truncate leading-tight">
                        {snip.label}
                      </div>
                      <div className={`text-[10px] truncate mt-0.5 ${mutedText}`}>{snip.text}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                          copiedId === snip.id
                            ? "border-emerald-500/40 text-emerald-500 bg-emerald-500/10 font-semibold"
                            : subtleBtnCls
                        }`}
                      >
                        {copiedId === snip.id ? "Copied" : "Copy"}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSnippet(snip.id);
                        }}
                        className={`p-0.5 rounded border transition-colors ${subtleBtnCls}`}
                        title="Delete snippet"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer: Recent Picked Color Swatches + Eyedropper trigger */}
            <div className="flex items-center justify-between gap-2 text-[10px]">
              <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                <button
                  onClick={onStartColorPicker}
                  className={`px-2 py-0.5 rounded-md border flex items-center gap-1 flex-shrink-0 transition-colors ${focusRing} ${subtleBtnCls}`}
                  title="Pick any color from screen"
                >
                  <Pipette className="w-3 h-3 text-accent" />
                  <span>Pick Color</span>
                </button>
                {recentColors.length > 0 ? (
                  <div className="flex items-center gap-1 min-w-0">
                    {recentColors.slice(0, 6).map((hex) => (
                      <button
                        key={hex}
                        onClick={() => handleCopyValue(`color-${hex}`, hex)}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-mono transition-colors ${subtleBtnCls}`}
                        title={`Copy ${hex}`}
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-sm border border-black/20 flex-shrink-0"
                          style={{ backgroundColor: hex }}
                        />
                        <span>{copiedId === `color-${hex}` ? "OK" : hex}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className={`truncate ${mutedText}`}>Click any snippet to copy instantly</span>
                )}
              </div>
            </div>
          </>
        )}

        {/* Mode 3: Win+V Clipboard History */}
        {notesMode === "clipboard" && (
          <>
            <div className={`scrollable-area overflow-y-auto p-1.5 space-y-1 min-h-0 ${surfaceSubtle}`}>
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
                          setCopiedId(item.id);
                          setTimeout(() => setCopiedId(null), 1400);
                          onCopyClipItem(item);
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${subtleBtnCls}`}
                        title="Copy back to clipboard"
                      >
                        {copiedId === item.id ? "Copied" : "Copy"}
                      </button>
                      <button
                        onClick={() => {
                          onAddSnippet(item.text.trim().slice(0, 22), item.text);
                          onSetNotesMode("snippets");
                        }}
                        className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${subtleBtnCls}`}
                        title="Save as Quick Snippet"
                      >
                        + Snip
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
                  <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
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
