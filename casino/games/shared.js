const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseBet(arg, balance) {
  if (!arg) return { error: "❌ 베팅 금액을 입력하세요." };
  const lower = arg.toLowerCase();
  let amount;
  if (lower === "올인" || lower === "all") {
    amount = balance;
  } else if (lower === "반" || lower === "half") {
    amount = Math.floor(balance / 2);
  } else {
    amount = parseInt(arg);
    if (isNaN(amount)) return { error: "❌ 올바른 베팅 금액을 입력하세요." };
  }
  if (amount < 1000) return { error: "❌ 최소 베팅 금액은 1,000원입니다." };
  if (amount > balance) return { error: "❌ 잔액이 부족합니다" };
  return { amount };
}

function fmt(n) {
  return (n >= 0 ? "+" : "") + n.toLocaleString() + "원";
}

const activeGamblers = new Set();

function isGambling(userId) {
  return activeGamblers.has(userId);
}

const SUITS = ["♠", "♥", "♦", "♣"];
const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function createDeck() {
  const deck = [];
  for (const s of SUITS) for (const v of VALUES) deck.push({ s, v });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export { sleep, parseBet, fmt, activeGamblers, isGambling, SUITS, VALUES, createDeck };
