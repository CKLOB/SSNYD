// Deezer 공개 검색 API — 인증키 없이 무료로 쓸 수 있다 (Spotify는 유료 전환)
export interface DeezerTrack {
  id: number;
  title: string;
  link: string;
  artist: { name: string };
  album: { title: string; cover_big?: string };
}

const TIMEOUT_MS = 8000;

export async function searchTracks(query: string, limit = 10): Promise<DeezerTrack[]> {
  const params = new URLSearchParams({ q: query, limit: String(Math.min(25, Math.max(1, limit))) });
  const res = await fetch(`https://api.deezer.com/search?${params}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`Deezer HTTP ${res.status}`);
  }
  const json = (await res.json()) as { data?: DeezerTrack[]; error?: { message?: string } };
  // Deezer는 오류도 200 OK + error 필드로 돌려준다
  if (json.error) throw new Error(`Deezer 오류: ${json.error.message ?? "Unknown"}`);
  return json.data ?? [];
}
