export interface MediaTrack {
  title: string;
  artist: string;
  album: string;
  thumbnail?: string;
  thumbId?: string | null;
  sourceApp: string;
  isPlaying: boolean;
  positionSec: number;
  durationSec: number;
}

export interface LyricLine {
  timeSec: number;
  text: string;
}
