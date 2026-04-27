export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface BetResult {
  error?: string;
  amount?: number;
}

export function parseBet(arg: string | undefined, balance: number): BetResult {
  if (!arg) return { error: "❌ 베팅 금액을 입력하세요." };
  const lower = arg.toLowerCase();
  let amount: number;
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

export function fmt(n: number): string {
  return (n >= 0 ? "+" : "") + n.toLocaleString() + "원";
}

export const activeGamblers = new Set<string>();

export function isGambling(userId: string): boolean {
  return activeGamblers.has(userId);
}

export const SUITS = ["♠", "♥", "♦", "♣"];
export const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export interface Card {
  s: string;
  v: string;
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const v of VALUES) deck.push({ s, v });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
