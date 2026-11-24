import React, { useState } from "react";
import { Check, Copy, ExternalLink, FolderOpen, Inbox, X } from "lucide-react";
import { ShelfFileInfo } from "../../types/system";
import { formatBytes, IslandThemeTokens } from "./helpers";

interface ShelfTabProps {
  tokens: IslandThemeTokens;
  files: ShelfFileInfo[];
  isDragOver: boolean;
  onOpenFile: (path: string) => void;
  onRevealFile: (path: string) => void;
  onRemoveFile: (path: string) => void;
  onClearShelf: () => void;
}

export const ShelfTab: React.FC<ShelfTabProps> = React.memo(
  ({
    tokens,
    files,
    isDragOver,
    onOpenFile,
    onRevealFile,
    onRemoveFile,
    onClearShelf,
  }) => {
    const [copiedPath, setCopiedPath] = useState<string | null>(null);
    const { isLight, surfaceSubtle, mutedText, subtleBtnCls } = tokens;

    const handleCopyPath = (path: string) => {
      navigator.clipboard.writeText(path);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 1500);
    };

    return (
      <div className="w-full h-full grid grid-rows-[1fr_auto] gap-2">
        <div
          className={`scrollable-area overflow-y-auto p-2 transition-colors ${surfaceSubtle} ${
            isDragOver ? "border-[#f97316]" : ""
          }`}
        >
          {files.length === 0 ? (
            <div className={`w-full h-full flex flex-col items-center justify-center text-center px-6 ${mutedText}`}>
              <Inbox className="w-6 h-6 mb-1.5 opacity-70" />
              <p className="text-xs font-medium">Drag &amp; drop files onto Dynamic Island</p>
              <p className="text-[10px] mt-0.5">
                Hold files, screenshots, or folders here for quick access while switching windows.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {files.map((file) => (
                <div
                  key={file.path}
                  className={`grid grid-cols-[auto_1fr_auto] items-center gap-2.5 px-2.5 py-1.5 rounded-lg ${
                    isLight ? "bg-zinc-100" : "bg-[#0c0c0e]"
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-md flex items-center justify-center text-[9px] font-mono font-bold uppercase ${
                      isLight ? "bg-zinc-200 text-zinc-800" : "bg-zinc-800 text-zinc-200"
                    }`}
                  >
                    {file.isDir ? "DIR" : file.ext.slice(0, 4) || "FILE"}
                  </div>

                  <div className="min-w-0">
                    <div className="text-[11px] font-medium truncate" title={file.path}>
                      {file.name}
                    </div>
                    <div className={`text-[10px] font-mono tabular-nums ${mutedText}`}>
                      {formatBytes(file.sizeBytes)}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onOpenFile(file.path)}
                      className={`p-1 rounded border transition-colors ${subtleBtnCls}`}
                      title="Open File"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => onRevealFile(file.path)}
                      className={`p-1 rounded border transition-colors ${subtleBtnCls}`}
                      title="Show in Explorer"
                    >
                      <FolderOpen className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleCopyPath(file.path)}
                      className={`p-1 rounded border transition-colors ${subtleBtnCls}`}
                      title="Copy File Path"
                    >
                      {copiedPath === file.path ? (
                        <Check className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                    <button
                      onClick={() => onRemoveFile(file.path)}
                      className={`p-1 rounded border transition-colors ${subtleBtnCls}`}
                      title="Remove from Shelf"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between text-[10px]">
          <span className={mutedText}>
            {files.length} {files.length === 1 ? "item" : "items"} on shelf
          </span>
          {files.length > 0 && (
            <button
              onClick={onClearShelf}
              className={`px-2 py-0.5 rounded-md border transition-colors ${subtleBtnCls}`}
            >
              Clear Shelf
            </button>
          )}
        </div>
      </div>
    );
  }
);
