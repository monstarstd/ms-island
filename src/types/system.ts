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
