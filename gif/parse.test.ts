import test from "node:test";
import assert from "node:assert/strict";
import { parseAdd, isBlockedIp } from "./handler.js";

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
