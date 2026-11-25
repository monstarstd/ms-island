import React, { useRef, useState } from "react";
import {
  ArrowDownToLine,
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  GripVertical,
  Inbox,
  Loader2,
  Power,
  Smartphone,
  Wifi,
  X,
} from "lucide-react";
import { ActiveDownloadInfo, ShelfFileInfo, WifiShareStatus } from "../../types/system";
import { copyTextReliable, formatBytes, formatSpeed, IslandThemeTokens } from "./helpers";

interface ShelfTabProps {
  tokens: IslandThemeTokens;
  files: ShelfFileInfo[];
  activeDownload: ActiveDownloadInfo | null;
  isDragOver: boolean;
  shelfMode: "files" | "wifi";
  onSetShelfMode: (mode: "files" | "wifi") => void;
  wifiStatus: WifiShareStatus;
  wifiBusy: boolean;
  wifiError: string;
  onStartWifi: () => void;
  onStopWifi: () => void;
  onOpenWifiDir: () => void;
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
    shelfMode,
    onSetShelfMode,
    wifiStatus,
    wifiBusy,
    wifiError,
    onStartWifi,
    onStopWifi,
    onOpenWifiDir,
    onOpenFile,
    onRevealFile,
    onDragOutFile,
    onRemoveFile,
    onClearShelf,
  }) => {
    const [copiedPath, setCopiedPath] = useState<string | null>(null);
    const [copiedUrl, setCopiedUrl] = useState(false);
    const dragStartRef = useRef<{ path: string; x: number; y: number; fired: boolean } | null>(
      null
    );
    const { isLight, surfaceSubtle, mutedText, subtleBtnCls, focusRing } = tokens;

    const handleCopyPath = (path: string) => {
      copyTextReliable(path);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 1500);
    };

    const handleCopyUrl = () => {
      if (!wifiStatus.url) return;
      copyTextReliable(wifiStatus.url);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1600);
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

    const shareableCount = files.filter((f) => !f.isDir).length;

    return (
      <div className="w-full h-full grid grid-rows-[auto_1fr] gap-2 min-h-0">
        {/* Compact Mode Switcher Header (Files | Wi-Fi Drop) */}
        <div className="flex items-center justify-between gap-2">
          <div
            className={`grid grid-cols-2 p-0.5 rounded-lg border text-[10px] font-medium ${
              isLight ? "bg-zinc-200/80 border-zinc-300" : "bg-[#141418] border-zinc-800"
            }`}
          >
            <button
              onClick={() => onSetShelfMode("files")}
              className={`px-2.5 py-0.5 rounded-md flex items-center justify-center gap-1.5 transition-colors ${focusRing} ${
                shelfMode === "files"
                  ? isLight
                    ? "bg-white text-zinc-950 font-semibold shadow-sm"
                    : "bg-zinc-800 text-white font-semibold"
                  : isLight
                    ? "text-zinc-600 hover:text-zinc-950"
                    : "text-zinc-400 hover:text-white"
              }`}
            >
              <Inbox className="w-3 h-3" />
              <span>Files{files.length > 0 ? ` (${files.length})` : ""}</span>
            </button>

            <button
              onClick={() => onSetShelfMode("wifi")}
              className={`px-2.5 py-0.5 rounded-md flex items-center justify-center gap-1.5 transition-colors ${focusRing} ${
                shelfMode === "wifi"
                  ? isLight
                    ? "bg-white text-zinc-950 font-semibold shadow-sm"
                    : "bg-zinc-800 text-white font-semibold"
                  : isLight
                    ? "text-zinc-600 hover:text-zinc-950"
                    : "text-zinc-400 hover:text-white"
              }`}
            >
              <Wifi className={`w-3 h-3 ${wifiStatus.running ? "text-emerald-500" : ""}`} />
              <span>Wi-Fi</span>
              {wifiStatus.running && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
              )}
            </button>
          </div>

          {shelfMode === "files" ? (
            <div className="flex items-center gap-2 text-[10px]">
              <span className={`truncate max-w-[230px] ${mutedText}`}>
                {files.length > 0 ? "Drag any item out to other apps" : "Watching Downloads folder"}
              </span>
              {files.length > 0 && (
                <button
                  onClick={onClearShelf}
                  className={`px-2 py-0.5 rounded-md border transition-colors ${subtleBtnCls}`}
                >
                  Clear
                </button>
              )}
            </div>
          ) : (
            <div className={`text-[10px] flex items-center gap-1.5 ${mutedText}`}>
              <Smartphone className="w-3 h-3" />
              <span>
                {wifiStatus.running
                  ? `${shareableCount} shared · ${wifiStatus.receivedCount} received`
                  : "Offline · Local Wi-Fi only"}
              </span>
            </div>
          )}
        </div>

        {/* Mode 1: Shelf Files List */}
        {shelfMode === "files" ? (
          <div
            className={`scrollable-area overflow-y-auto p-2 space-y-1.5 transition-colors min-h-0 ${surfaceSubtle} ${
              isDragOver ? "border-accent" : ""
            }`}
          >
            {/* Live Browser Download Banner */}
            {activeDownload && (
              <div
                className={`px-2.5 py-2 rounded-lg border border-accent/50 grid grid-cols-[auto_1fr_auto] items-center gap-2.5 ${
                  isLight ? "bg-accent/10" : "bg-accent/15"
                }`}
              >
                <ArrowDownToLine className="w-4 h-4 text-accent" />
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold truncate">{activeDownload.name}</div>
                  <div className={`text-[10px] font-mono tabular-nums ${mutedText}`}>
                    Downloading · {formatBytes(activeDownload.bytesDownloaded)}
                  </div>
                </div>
                <span className="text-[10px] font-mono tabular-nums font-semibold text-accent">
                  {formatSpeed(activeDownload.speedBytesPerSec)}
                </span>
              </div>
            )}

            {files.length === 0 && !activeDownload ? (
              <div
                className={`w-full h-full flex flex-col items-center justify-center text-center px-6 ${mutedText}`}
              >
                <Inbox className="w-5 h-5 mb-1 opacity-70" />
                <p className="text-xs font-medium">Drop files, download, or receive via Wi-Fi</p>
                <p className="text-[10px] mt-0.5">
                  Drag any item out to WhatsApp, Figma, Gmail, or Explorer.
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
                        file.fromDownload || file.fromWifi
                          ? "bg-accent/15 text-accent border border-accent/30"
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
                        {file.fromWifi
                          ? " · Wi-Fi"
                          : file.fromDownload
                            ? " · Browser Download"
                            : ""}
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
        ) : (
          /* Mode 2: Local Wi-Fi Shelf (On-Demand QR + LAN File & Clipboard Drop) */
          <div className={`p-3 min-h-0 flex items-center justify-center ${surfaceSubtle}`}>
            {!wifiStatus.running ? (
              <div className="w-full flex flex-col items-center justify-center text-center gap-2 px-4">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center border ${
                    isLight
                      ? "bg-zinc-200/80 border-zinc-300 text-zinc-800"
                      : "bg-zinc-900 border-zinc-800 text-zinc-200"
                  }`}
                >
                  <Wifi className="w-4 h-4 text-accent" />
                </div>
                <div>
                  <div className="text-xs font-semibold">Cross-Device Wi-Fi Shelf</div>
                  <p className={`text-[10px] mt-0.5 max-w-[340px] ${mutedText}`}>
                    Scan QR from Android, iPhone, or Mac on the same Wi-Fi to send photos, files, or
                    clipboard text straight into Shelf. Server stays OFF when unused.
                  </p>
                </div>
                {wifiError && <div className="text-[10px] text-red-400">{wifiError}</div>}
                <button
                  onClick={onStartWifi}
                  disabled={wifiBusy}
                  className={`px-3.5 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 transition-all active:scale-[0.97] disabled:opacity-50 ${focusRing} bg-accent text-white hover:opacity-95`}
                >
                  {wifiBusy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Wifi className="w-3.5 h-3.5" />
                  )}
                  <span>Start Wi-Fi Shelf</span>
                </button>
              </div>
            ) : (
              <div className="w-full h-full grid grid-cols-[auto_1fr] items-center gap-3.5">
                {/* Crisp Vector QR Code (with white quiet zone for instant camera scan) */}
                <div
                  className="w-[124px] h-[124px] rounded-xl bg-white p-1.5 shadow-sm border border-zinc-300/60 flex items-center justify-center flex-shrink-0 overflow-hidden [&>svg]:w-full [&>svg]:h-full"
                  title="Scan with your phone camera to connect"
                  dangerouslySetInnerHTML={{ __html: wifiStatus.qrSvg }}
                />

                {/* Connection Details & Actions */}
                <div className="min-w-0 h-full flex flex-col justify-between py-0.5">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                      <span className="text-xs font-semibold">Scan QR on Phone</span>
                    </div>
                    <p className={`text-[10px] mt-0.5 leading-snug ${mutedText}`}>
                      Same Wi-Fi required. Session token is embedded in the QR for private access.
                    </p>
                  </div>

                  <div
                    className={`px-2 py-1 rounded-lg border flex items-center justify-between gap-2 ${
                      isLight
                        ? "bg-white border-zinc-300 text-zinc-900"
                        : "bg-[#0c0c0e] border-zinc-800 text-zinc-200"
                    }`}
                  >
                    <span className="text-[10px] font-mono truncate" title={wifiStatus.url}>
                      {wifiStatus.displayUrl}
                    </span>
                    <button
                      onClick={handleCopyUrl}
                      className={`px-1.5 py-0.5 rounded text-[9px] font-medium flex items-center gap-1 border flex-shrink-0 transition-colors ${subtleBtnCls}`}
                      title="Copy full session link (includes token)"
                    >
                      {copiedUrl ? (
                        <>
                          <Check className="w-2.5 h-2.5 text-emerald-500" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-2.5 h-2.5" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={onOpenWifiDir}
                      className={`flex-1 py-1 px-2 rounded-lg border text-[10px] font-medium flex items-center justify-center gap-1.5 transition-colors ${focusRing} ${subtleBtnCls}`}
                      title={wifiStatus.saveDir || "Downloads\\MS Island"}
                    >
                      <FolderOpen className="w-3 h-3" />
                      <span>Received Folder</span>
                    </button>

                    <button
                      onClick={onStopWifi}
                      disabled={wifiBusy}
                      className={`py-1 px-2.5 rounded-lg border text-[10px] font-semibold flex items-center justify-center gap-1 transition-colors ${focusRing} ${
                        isLight
                          ? "bg-red-50 hover:bg-red-100 text-red-600 border-red-200"
                          : "bg-red-950/50 hover:bg-red-950/80 text-red-400 border-red-900/60"
                      }`}
                    >
                      <Power className="w-3 h-3" />
                      <span>Stop</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
);
