import test from "node:test";
import assert from "node:assert/strict";
import { parseAdd, isBlockedIp, readCapped, findKeyword } from "./handler.js";

test("공백이 들어간 키워드 + URL", () => {
  assert.deepEqual(parseAdd(" @충동적 구매@ https://x.test/a.gif"), {
    keyword: "@충동적 구매@",
    url: "https://x.test/a.gif",
  });
});

test("첨부파일이 있으면 나머지 전체가 키워드", () => {
  assert.deepEqual(parseAdd(" @충동적 구매@ ", "https://cdn.test/b.gif"), {
    keyword: "@충동적 구매@",
    url: "https://cdn.test/b.gif",
  });
});

test("URL도 첨부도 없으면 사용법 안내", () => {
  assert.ok("error" in parseAdd(" 키워드만"));
});

test("URL이 아닌 마지막 토큰은 거부", () => {
  assert.ok("error" in parseAdd("키워드 그냥텍스트"));
});

test("! 로 시작하는 키워드는 거부", () => {
  assert.ok("error" in parseAdd("!밥 https://x.test/a.gif"));
});

test("100자 초과 키워드는 거부", () => {
  assert.ok("error" in parseAdd(`${"가".repeat(101)} https://x.test/a.gif`));
});

test("http 주소는 거부 (https만 허용)", () => {
  assert.ok("error" in parseAdd("키워드 http://x.test/a.gif"));
});

test("내부망 IP 차단", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ]) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
});

test("공인 IP는 통과", () => {
  for (const ip of ["1.1.1.1", "162.159.130.234", "172.32.0.1", "192.169.0.1", "2606:4700::1111"]) {
    assert.equal(isBlockedIp(ip), false, ip);
  }
});

test("IPv4-mapped IPv6 16진 표기도 차단", () => {
  assert.equal(isBlockedIp("::ffff:7f00:1"), true); // 127.0.0.1
  assert.equal(isBlockedIp("::ffff:a9fe:a9fe"), true); // 169.254.169.254
  assert.equal(isBlockedIp("::ffff:0a00:0001"), true); // 10.0.0.1
});

test("NAT64/벤치마크 대역 차단", () => {
  assert.equal(isBlockedIp("64:ff9b::7f00:1"), true);
  assert.equal(isBlockedIp("198.18.0.1"), true);
  assert.equal(isBlockedIp("192.0.0.1"), true);
});

function streamOf(totalBytes: number, chunk = 64 * 1024): Response {
  let sent = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (sent >= totalBytes) return controller.close();
        const size = Math.min(chunk, totalBytes - sent);
        sent += size;
        controller.enqueue(new Uint8Array(size));
      },
    }),
  );
}

test("8MB 넘는 응답은 다 받지 않고 끊는다", async () => {
  assert.equal(await readCapped(streamOf(9 * 1024 * 1024)), null);
});

test("한도 이내 응답은 그대로 반환", async () => {
  const data = await readCapped(streamOf(1024));
  assert.equal(data?.byteLength, 1024);
});

test("문장 중간에 있어도 잡는다", () => {
  const set = new Set(["@충동적 구매@"]);
  assert.equal(findKeyword(set, "이거 @충동적 구매@ ㅋㅋ"), "@충동적 구매@");
  assert.equal(findKeyword(set, "@충동적 구매@"), "@충동적 구매@");
  assert.equal(findKeyword(set, "그냥 잡담"), null);
});

test("여러 개 걸리면 더 긴 키워드가 이긴다", () => {
  const set = new Set(["구매", "@충동적 구매@"]);
  assert.equal(findKeyword(set, "이거 @충동적 구매@ 했다"), "@충동적 구매@");
  assert.equal(findKeyword(set, "구매했음"), "구매");
});

test("1글자 키워드는 등록 거부", () => {
  assert.ok("error" in parseAdd("ㅋ https://x.test/a.gif"));
});
