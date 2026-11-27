export interface VolumeInfo {
  level: number;
  muted: boolean;
}

export interface SystemStats {
  cpuPercent: number;
  ramPercent: number;
  ramUsedGb: number;
  ramTotalGb: number;
}

export interface BatteryInfo {
  hasBattery: boolean;
  percent: number;
  isCharging: boolean;
}

export interface AudioDeviceInfo {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface ClipboardEntry {
  id: string;
  text: string;
  source: string;
}

export interface ClipboardSyncPayload {
  items: ClipboardEntry[];
  windowsHistoryEnabled: boolean;
}

export interface ShelfFileInfo {
  name: string;
  path: string;
  sizeBytes: number;
  isDir: boolean;
  ext: string;
  fromDownload?: boolean;
  fromWifi?: boolean;
}

export interface WifiShareStatus {
  running: boolean;
  url: string;
  displayUrl: string;
  qrSvg: string;
  saveDir: string;
  receivedCount: number;
}

export interface ActiveDownloadInfo {
  name: string;
  path: string;
  bytesDownloaded: number;
  speedBytesPerSec: number;
}

export interface IslandToast {
  kind: string;
  message: string;
}

export interface WeatherInfo {
  city: string;
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  tempMax: number;
  tempMin: number;
  condition: string;
  icon: string;
  isDay: boolean;
}

export type VisualizerStyle = "bars" | "wave" | "dots";

export type BarStyle = "notch" | "island" | "orb" | "handle" | "tile";

export type PomodoroPhase = "focus" | "short" | "long";

export interface QuickSnippet {
  id: string;
  label: string;
  text: string;
}

export interface ColorSample {
  hex: string;
  r: number;
  g: number;
  b: number;
  cancelled?: boolean;
}
