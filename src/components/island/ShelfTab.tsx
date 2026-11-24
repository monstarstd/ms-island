import React, { useRef, useState } from "react";
import {
  ArrowDownToLine,
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  GripVertical,
  Inbox,
  X,
} from "lucide-react";
import { ActiveDownloadInfo, ShelfFileInfo } from "../../types/system";
import { formatBytes, formatSpeed, IslandThemeTokens } from "./helpers";

interface ShelfTabProps {
  tokens: IslandThemeTokens;
  files: ShelfFileInfo[];
  activeDownload: ActiveDownloadInfo | null;
  isDragOver: boolean;
  onOpenFile: (path: string) => void;
  onRevealFile: (path: string) => void;
  onDragOutFile: (path: string) => void;
  onRemoveFile: (path: string) => void;
  onClearShelf: () => void;
}

export const ShelfTab: React.FC<ShelfTabProps> = React.memo(
  ({
    tokens,
    files,
    activeDownload,
    isDragOver,
    onOpenFile,
    onRevealFile,
    onDragOutFile,
    onRemoveFile,
    onClearShelf,
  }) => {
    const [copiedPath, setCopiedPath] = useState<string | null>(null);
    const dragStartRef = useRef<{ path: string; x: number; y: number; fired: boolean } | null>(
      null
    );
    const { isLight, surfaceSubtle, mutedText, subtleBtnCls } = tokens;

    const handleCopyPath = (path: string) => {
      navigator.clipboard.writeText(path);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 1500);
    };

    const handleCardPointerDown = (e: React.PointerEvent, path: string) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button")) return;
      dragStartRef.current = { path, x: e.clientX, y: e.clientY, fired: false };
    };

    const handleCardPointerMove = (e: React.PointerEvent) => {
      const start = dragStartRef.current;
      if (!start || start.fired) return;
      if ((e.buttons & 1) === 0) {
        dragStartRef.current = null;
        return;
      }
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (dx * dx + dy * dy >= 36) {
        start.fired = true;
        dragStartRef.current = null;
        onDragOutFile(start.path);
      }
    };

    const handleCardPointerUp = () => {
      dragStartRef.current = null;
    };

    return (
      <div className="w-full h-full grid grid-rows-[1fr_auto] gap-2">
        <div
          className={`scrollable-area overflow-y-auto p-2 space-y-1.5 transition-colors ${surfaceSubtle} ${
            isDragOver ? "border-[#f97316]" : ""
          }`}
        >
          {/* Live Browser Download Banner */}
          {activeDownload && (
            <div
              className={`px-2.5 py-2 rounded-lg border border-[#f97316]/50 grid grid-cols-[auto_1fr_auto] items-center gap-2.5 ${
                isLight ? "bg-orange-50/90" : "bg-[#1a1410]"
              }`}
            >
              <ArrowDownToLine className="w-4 h-4 text-[#f97316]" />
              <div className="min-w-0">
                <div className="text-[11px] font-semibold truncate">{activeDownload.name}</div>
                <div className={`text-[10px] font-mono tabular-nums ${mutedText}`}>
                  Downloading · {formatBytes(activeDownload.bytesDownloaded)}
                </div>
              </div>
              <span className="text-[10px] font-mono tabular-nums font-semibold text-[#f97316]">
                {formatSpeed(activeDownload.speedBytesPerSec)}
              </span>
            </div>
          )}

          {files.length === 0 && !activeDownload ? (
            <div className={`w-full h-full flex flex-col items-center justify-center text-center px-6 ${mutedText}`}>
              <Inbox className="w-6 h-6 mb-1.5 opacity-70" />
              <p className="text-xs font-medium">Drop files here or download from browser</p>
              <p className="text-[10px] mt-0.5">
                Completed browser downloads appear here automatically. Drag any item out to WhatsApp, Figma, Gmail, or Explorer.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {files.map((file) => (
                <div
                  key={file.path}
                  onPointerDown={(e) => handleCardPointerDown(e, file.path)}
                  onPointerMove={handleCardPointerMove}
                  onPointerUp={handleCardPointerUp}
                  onPointerCancel={handleCardPointerUp}
                  className={`grid grid-cols-[auto_auto_1fr_auto] items-center gap-2 px-2 py-1.5 rounded-lg cursor-grab active:cursor-grabbing transition-colors ${
                    isLight ? "bg-zinc-100 hover:bg-zinc-200/80" : "bg-[#0c0c0e] hover:bg-zinc-800/70"
                  }`}
                  title="Drag out to any app or folder"
                >
                  <GripVertical className={`w-3.5 h-3.5 flex-shrink-0 ${mutedText}`} />

                  <div
                    className={`w-7 h-7 rounded-md flex items-center justify-center text-[9px] font-mono font-bold uppercase ${
                      file.fromDownload
                        ? "bg-[#f97316]/15 text-[#f97316] border border-[#f97316]/30"
                        : isLight
                          ? "bg-zinc-200 text-zinc-800"
                          : "bg-zinc-800 text-zinc-200"
                    }`}
                  >
                    {file.isDir ? "DIR" : file.ext.slice(0, 4) || "FILE"}
                  </div>

                  <div className="min-w-0">
                    <div className="text-[11px] font-medium truncate" title={file.path}>
                      {file.name}
                    </div>
                    <div className={`text-[10px] font-mono tabular-nums ${mutedText}`}>
                      {file.isDir ? "Folder" : formatBytes(file.sizeBytes)}
                      {file.fromDownload ? " · Browser Download" : ""}
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
            {files.length > 0
              ? `${files.length} ${files.length === 1 ? "item" : "items"} · Drag any item out to drop into other apps`
              : "Watching Downloads folder automatically"}
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
