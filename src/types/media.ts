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

export interface LyricsSuggestion {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  durationSec: number;
  lyrics: string;
  syncedLyrics?: string | null;
}

export interface LyricsPayload {
  plainLyrics: string;
  syncedLyrics?: string | null;
  trackName?: string | null;
  artistName?: string | null;
  status: "idle" | "loading" | "found" | "not_found";
  suggestions?: LyricsSuggestion[];
}

export const EMPTY_LYRICS_PAYLOAD: LyricsPayload = {
  plainLyrics: "",
  syncedLyrics: null,
  trackName: null,
  artistName: null,
  status: "idle",
  suggestions: [],
};
