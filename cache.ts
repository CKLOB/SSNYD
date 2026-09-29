// 조회 결과를 TTL 동안 보관하고, 같은 키로 동시에 들어온 요청은 진행 중인 호출 하나를 공유한다.
// (점심시간에 여러 명이 동시에 !밥을 쳐도 외부 API는 한 번만 부른다)
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();
  private readonly inflight = new Map<string, Promise<V>>();

  constructor(private readonly maxEntries = 500) {}

  // 캐시 미스는 undefined — null은 "결과 없음"을 캐시한 정상 값으로 취급한다
  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) this.prune();
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  // 캐시를 무시하고 새로 불러온다 (예열용). 이미 불러오는 중이면 그 결과를 같이 기다린다.
  load(key: string, loader: () => Promise<V>, ttlMs: (value: V) => number): Promise<V> {
    const running = this.inflight.get(key);
    if (running) return running;

    const promise = loader()
      .then((value) => {
        this.set(key, value, ttlMs(value));
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  getOrLoad(key: string, loader: () => Promise<V>, ttlMs: (value: V) => number): Promise<V> {
    const hit = this.get(key);
    return hit !== undefined ? Promise.resolve(hit) : this.load(key, loader, ttlMs);
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    // 만료된 게 없으면 가장 오래 전에 넣은 것부터 버린다 (Map은 삽입 순서를 유지)
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
