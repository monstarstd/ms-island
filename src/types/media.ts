export interface MediaTrack {
  title: string;
  artist: string;
  album: string;
  thumbnail?: string;
  sourceApp?: string; // "YouTube", "Spotify", "Brave", etc.
  isPlaying: boolean;
  positionSec: number;
  durationSec: number;
}

export interface LyricLine {
  timeSec: number;
  text: string;
}

export interface IslandSettings {
  lyricsEnabled: boolean;
  lyricsFontSize: number; // in px, default 24
  autoHideIsland: boolean;
  isLyricsRepositionMode: boolean;
}
