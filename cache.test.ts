import test from "node:test";
import assert from "node:assert/strict";
import { TtlCache } from "./cache.js";

test("동시에 들어온 같은 키 요청은 로더를 한 번만 부른다", async () => {
  const cache = new TtlCache<number>();
  let calls = 0;
  const loader = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return 42;
  };
  const results = await Promise.all([
    cache.getOrLoad("k", loader, () => 1000),
    cache.getOrLoad("k", loader, () => 1000),
    cache.getOrLoad("k", loader, () => 1000),
  ]);
  assert.deepEqual(results, [42, 42, 42]);
  assert.equal(calls, 1);
  assert.equal(await cache.getOrLoad("k", loader, () => 1000), 42);
  assert.equal(calls, 1);
});

test("null도 캐시된다 (결과 없음 캐싱)", async () => {
  const cache = new TtlCache<number | null>();
  let calls = 0;
  const loader = async () => {
    calls++;
    return null;
  };
  await cache.getOrLoad("k", loader, () => 1000);
  assert.equal(cache.get("k"), null);
  await cache.getOrLoad("k", loader, () => 1000);
  assert.equal(calls, 1);
});

test("TTL이 지나면 다시 불러온다", async () => {
  const cache = new TtlCache<number>();
  cache.set("k", 1, 5);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(cache.get("k"), undefined);
});

test("로더가 실패하면 캐시하지 않고 다음 요청에서 다시 시도한다", async () => {
  const cache = new TtlCache<number>();
  await assert.rejects(
    cache.getOrLoad(
      "k",
      () => Promise.reject(new Error("boom")),
      () => 1000,
    ),
  );
  assert.equal(
    await cache.getOrLoad(
      "k",
      async () => 7,
      () => 1000,
    ),
    7,
  );
});

test("load는 캐시를 무시하고 새로 불러온다 (예열)", async () => {
  const cache = new TtlCache<number>();
  cache.set("k", 1, 1000);
  assert.equal(
    await cache.load(
      "k",
      async () => 2,
      () => 1000,
    ),
    2,
  );
  assert.equal(cache.get("k"), 2);
});

test("최대 개수를 넘으면 오래된 것부터 버린다", () => {
  const cache = new TtlCache<number>(2);
  cache.set("a", 1, 1000);
  cache.set("b", 2, 1000);
  cache.set("c", 3, 1000);
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b"), 2);
  assert.equal(cache.get("c"), 3);
});
