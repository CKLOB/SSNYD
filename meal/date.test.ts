import test from "node:test";
import assert from "node:assert/strict";
import { parseMealDate } from "./handler.js";

test("연도 생략 형식은 올해로 본다", () => {
  assert.equal(parseMealDate("10/5", 2026), "20261005");
  assert.equal(parseMealDate("10-05", 2026), "20261005");
  assert.equal(parseMealDate("10.5", 2026), "20261005");
  assert.equal(parseMealDate("1005", 2026), "20261005");
});

test("연도 포함 형식", () => {
  assert.equal(parseMealDate("2027-03-02", 2026), "20270302");
  assert.equal(parseMealDate("20270302", 2026), "20270302");
  assert.equal(parseMealDate(" 2027/3/2 ", 2026), "20270302");
});

test("없는 날짜나 잘못된 형식은 null", () => {
  assert.equal(parseMealDate("2/30", 2026), null);
  assert.equal(parseMealDate("13/1", 2026), null);
  assert.equal(parseMealDate("2026-02-29", 2026), null);
  assert.equal(parseMealDate("내일", 2026), null);
  assert.equal(parseMealDate("105", 2026), null);
});

test("윤년 2월 29일", () => {
  assert.equal(parseMealDate("2/29", 2028), "20280229");
});
