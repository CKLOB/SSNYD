import test from "node:test";
import assert from "node:assert/strict";
import { startGame, claimGame, endGame, isGambling } from "./shared.js";

test("게임은 한 번만 정산된다 (버튼 연타 방지)", () => {
  const id = startGame("u1");
  assert.equal(isGambling("u1"), true);
  assert.equal(claimGame("u1", id), true);
  assert.equal(claimGame("u1", id), false);
  endGame("u1");
  assert.equal(isGambling("u1"), false);
});

test("예전 게임의 버튼으로는 새 게임을 정산할 수 없다", () => {
  const oldId = startGame("u2");
  const newId = startGame("u2");
  assert.notEqual(oldId, newId);
  assert.equal(claimGame("u2", oldId), false);
  assert.equal(claimGame("u2", newId), true);
  endGame("u2");
});

test("버튼을 안 누르고 떠나도 만료되면 잠금이 풀린다", async () => {
  const id = startGame("u3", 5);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(isGambling("u3"), false);
  assert.equal(claimGame("u3", id), false);
});

test("게임이 없으면 정산할 수 없다", () => {
  assert.equal(claimGame("nobody", "1"), false);
});
