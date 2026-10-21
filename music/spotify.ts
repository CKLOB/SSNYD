export interface SpotifyArtist {
  name: string;
}

export interface SpotifyImage {
  url: string;
}

export interface SpotifyAlbum {
  name: string;
  images: SpotifyImage[];
}

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
  external_urls: { spotify: string };
  preview_url: string | null;
}

export interface SpotifySearchResponse {
  tracks?: {
    items: SpotifyTrack[];
  };
}

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

// 키가 없다고 import 시점에 던지면 봇 전체가 부팅 단계에서 죽는다. Spotify 명령을 쓸 때만 실패하게 한다.
const TIMEOUT_MS = 8000;

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      "SPOTIFY_CLIENT_ID 또는 SPOTIFY_CLIENT_SECRET 환경 변수가 설정되지 않았습니다.",
    );
  }

  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify 토큰 발급 실패: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { access_token?: string; expires_in: number };
  if (!data.access_token) throw new Error("Spotify 토큰 발급 실패");

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

export async function searchTracks(
  query: string,
  limit = 10,
  offset = 0,
): Promise<SpotifySearchResponse> {
  const token = await getToken();
  const safeLimit = Math.min(10, Math.max(1, Math.floor(Number(limit)) || 10));
  const safeOffset = Math.max(0, Math.floor(Number(offset)) || 0);

  const params = new URLSearchParams({
    q: query,
    type: "track",
    limit: String(safeLimit),
    market: "KR",
    offset: String(safeOffset),
  });
  const url = `https://api.spotify.com/v1/search?${params}`;

  console.log("[Spotify] GET", url);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[Spotify] Error:", res.status, text);
    throw new Error(`Spotify HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<SpotifySearchResponse>;
}
