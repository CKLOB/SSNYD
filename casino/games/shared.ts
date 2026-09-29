import { ButtonInteraction, EmbedBuilder, MessageFlags } from "discord.js";

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface BetResult {
  error?: string;
  amount?: number;
}

export function parseAmountInput(
  arg: string | undefined,
  balance: number,
): { error?: string; amount?: number } {
  if (!arg) return { error: "❌ 금액을 입력하세요." };
  const lower = arg.toLowerCase().trim();
  let amount: number;
  if (lower === "올인" || lower === "all") {
    amount = balance;
  } else if (lower === "반" || lower === "half" || lower === "절반") {
    amount = Math.floor(balance / 2);
  } else {
    amount = parseInt(arg);
    if (isNaN(amount)) return { error: "❌ 올바른 금액을 입력하세요." };
  }
  return { amount };
}

export function parseBet(arg: string | undefined, balance: number): BetResult {
  const { error, amount } = parseAmountInput(arg, balance);
  if (error || amount === undefined) return { error: error ?? "❌ 베팅 금액을 입력하세요." };
  if (amount < 1000) return { error: "❌ 최소 베팅 금액은 1,000원입니다." };
  if (amount > balance) return { error: "❌ 잔액이 부족합니다" };
  return { amount };
}

export function fmt(n: number): string {
  return (n >= 0 ? "+" : "") + n.toLocaleString() + "원";
}

// 진행 중인 게임. 예전엔 Set이라 버튼을 안 누르고 떠나면 재시작 전까지 영원히 "진행 중"으로 묶였다.
// 이제 만료 시각을 두고, 버튼 customId에 게임 id를 넣어 옛 메시지 버튼이나 연타로 두 번 정산되지 않게 한다.
interface ActiveGame {
  id: string;
  expiresAt: number;
  settling: boolean;
}

const BUTTON_GAME_TTL_MS = 5 * 60 * 1000;
const activeGames = new Map<string, ActiveGame>();
let gameSeq = 0;

export function isGambling(userId: string): boolean {
  const game = activeGames.get(userId);
  if (!game) return false;
  if (game.expiresAt <= Date.now()) {
    activeGames.delete(userId);
    return false;
  }
  return true;
}

// 게임 시작 — 버튼 customId에 붙일 게임 id를 돌려준다
export function startGame(userId: string, ttlMs = BUTTON_GAME_TTL_MS): string {
  const id = (++gameSeq).toString(36);
  activeGames.set(userId, { id, expiresAt: Date.now() + ttlMs, settling: false });
  return id;
}

// 버튼으로 결과를 정산하기 직전에 호출. 해당 게임이 살아 있고 아직 정산 전일 때만 true.
export function claimGame(userId: string, gameId: string): boolean {
  const game = activeGames.get(userId);
  if (!game || game.id !== gameId || game.settling || !isGambling(userId)) return false;
  game.settling = true;
  return true;
}

export function endGame(userId: string): void {
  activeGames.delete(userId);
}

// 버튼을 누른 사람이 게임 주인인지, 그 게임이 아직 정산 전인지 확인한다. 아니면 본인에게만 안내하고 false.
export async function claimButton(
  interaction: ButtonInteraction,
  userId: string,
  gameId: string,
): Promise<boolean> {
  if (interaction.user.id !== userId) {
    await interaction.reply({
      content: "❌ 이 게임은 당신의 게임이 아닙니다.",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  if (!claimGame(userId, gameId)) {
    await interaction.reply({
      content: "⌛ 이미 끝났거나 만료된 게임입니다.",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  return true;
}

export function insufficientEmbed(title: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle(title)
    .setDescription("❌ 잔액이 부족합니다.");
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
