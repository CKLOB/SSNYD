import net from "node:net";
import { lookup } from "node:dns/promises";
import { Message, AttachmentBuilder, ChatInputCommandInteraction } from "discord.js";
import {
  addGifTrigger,
  getGifTrigger,
  getAllGifKeywords,
  getGifKeywords,
  deleteGifTrigger,
} from "../db.js";

const CMD_ADD = "!gif등록";
const CMD_LIST = "!gif목록";
const CMD_DEL = "!gif삭제";
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_KEYWORD = 100;
const EXT: Record<string, string> = {
  "image/gif": "gif",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const USAGE = `❌ 사용법: \`${CMD_ADD} 키워드 URL\` 또는 \`${CMD_ADD} 키워드\` + GIF 파일 첨부`;

// ponytail: 단일 인스턴스 전제. 봇을 여러 대 띄우면 한쪽 등록이 다른 쪽 캐시에 안 퍼진다 — 그때 TTL 재조회나 pub/sub으로 올린다.
const keywords = new Map<string, Set<string>>();

export async function initGifCache(): Promise<void> {
  keywords.clear();
  for (const row of await getAllGifKeywords()) {
    const set = keywords.get(row.guild_id) ?? new Set<string>();
    set.add(row.keyword);
    keywords.set(row.guild_id, set);
  }
}

export type ParseResult = { keyword: string; url: string } | { error: string };

function validate(keyword: string, url: string | undefined): ParseResult {
  if (!keyword) return { error: USAGE };
  if (keyword.length > MAX_KEYWORD)
    return { error: `❌ 키워드는 ${MAX_KEYWORD}자 이하여야 합니다.` };
  if (/[\r\n]/.test(keyword)) return { error: "❌ 키워드에 줄바꿈은 쓸 수 없습니다." };
  // 문장 중간도 잡기 때문에 1글자 키워드는 아무 메시지에나 걸린다
  if (keyword.length < 2) return { error: "❌ 키워드는 2자 이상이어야 합니다." };
  if (keyword.startsWith("!"))
    return { error: "❌ `!`로 시작하는 키워드는 명령어와 겹쳐서 쓸 수 없습니다." };
  if (!url) return { error: USAGE };
  if (!/^https:\/\//i.test(url))
    return { error: "❌ `https://`로 시작하는 주소만 등록할 수 있습니다." };
  return { keyword, url };
}

export function parseAdd(rest: string, attachmentUrl?: string): ParseResult {
  const trimmed = rest.trim();
  if (attachmentUrl) return validate(trimmed, attachmentUrl);

  const match = trimmed.match(/^(.*\S)\s+(\S+)$/);
  if (!match) return { error: USAGE };
  return validate(match[1].trim(), match[2]);
}

// 등록 URL은 서버 안에서 봇이 직접 열기 때문에(SSRF) 내부망 주소를 먼저 걸러낸다
export function isBlockedIp(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, "").toLowerCase();

  if (net.isIPv4(addr)) {
    const [a, b] = addr.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true; // unspecified / private / loopback
    if (a === 169 && b === 254) return true; // link-local + 클라우드 메타데이터
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 192 && b === 0) return true; // IETF 프로토콜 할당 (192.0.0/24 포함)
    if (a === 198 && (b === 18 || b === 19)) return true; // 벤치마크 대역
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  // IPv4-mapped/translated 주소는 v4 규칙으로 되돌려서 판정한다 (::ffff:127.0.0.1, ::ffff:7f00:1)
  if (addr.startsWith("::ffff:")) {
    const rest = addr.slice(7);
    if (net.isIPv4(rest)) return isBlockedIp(rest);
    const hex = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const n = ((parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16)) >>> 0;
      return isBlockedIp([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."));
    }
    return true;
  }
  if (addr.startsWith("64:ff9b:")) return true; // NAT64 변환 프리픽스
  if (addr === "::" || addr === "::1") return true;
  if (/^f[cd]/.test(addr)) return true; // fc00::/7 unique local
  if (/^fe[89ab]/.test(addr)) return true; // fe80::/10 link-local
  return false;
}

async function checkPublicHost(raw: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "❌ 올바른 URL이 아닙니다.";
  }
  if (parsed.protocol !== "https:") return "❌ `https://` 주소만 등록할 수 있습니다.";

  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await lookup(host, { all: true })).map((r) => r.address);
    } catch {
      return "❌ 주소를 찾을 수 없습니다.";
    }
  }
  if (addresses.length === 0 || addresses.some(isBlockedIp)) {
    return "❌ 내부/비공개 주소는 등록할 수 없습니다.";
  }
  return null;
}

// ponytail: DNS 재바인딩(검사 직후 IP가 바뀌는 경우)까지는 안 막는다 — 그건 IP 고정 dispatcher가 필요.
// 홉마다 재검사 + https 강제로 현실적인 내부망 접근은 막힌다.
async function safeFetch(url: string): Promise<Response | { error: string }> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const blocked = await checkPublicHost(current);
    if (blocked) return { error: blocked };

    const res = await fetch(current, { redirect: "manual" });
    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get("location");
    if (!location) return { error: "❌ 파일을 받지 못했습니다. (리다이렉트 응답이 이상합니다)" };
    current = new URL(location, current).toString();
  }
  return { error: "❌ 리다이렉트가 너무 많습니다." };
}

// content-length는 없거나 거짓말일 수 있으므로, 받는 도중에 재서 넘으면 바로 연결을 끊는다
export async function readCapped(res: Response): Promise<Buffer | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function download(
  url: string,
): Promise<{ data: Buffer; contentType: string } | { error: string }> {
  const res = await safeFetch(url);
  if ("error" in res) return res;
  if (!res.ok)
    return { error: `❌ 파일을 받지 못했습니다. (HTTP ${res.status}) 링크가 만료됐을 수 있어요.` };

  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!contentType.startsWith("image/")) {
    await res.body?.cancel();
    return {
      error:
        "❌ 이미지가 아닙니다. Tenor/Imgur **페이지 주소** 말고 이미지 직링크(.gif)를 넣거나 파일을 첨부해주세요.",
    };
  }

  const declared = Number(res.headers.get("content-length"));
  if (declared > MAX_BYTES) {
    await res.body?.cancel();
    return { error: "❌ 파일이 너무 큽니다. (최대 12MB)" };
  }

  const data = await readCapped(res);
  if (data === null) return { error: "❌ 파일이 너무 큽니다. (최대 12MB)" };
  if (data.byteLength === 0) return { error: "❌ 빈 파일입니다." };

  return { data, contentType };
}

async function registerGif(
  guildId: string,
  authorId: string,
  parsed: ParseResult,
): Promise<string> {
  if ("error" in parsed) return parsed.error;

  const file = await download(parsed.url);
  if ("error" in file) return file.error;

  const replaced = await addGifTrigger(
    guildId,
    parsed.keyword,
    file.data,
    file.contentType,
    authorId,
  );

  const set = keywords.get(guildId) ?? new Set<string>();
  set.add(parsed.keyword);
  keywords.set(guildId, set);

  const kb = Math.round(file.data.byteLength / 1024);
  return replaced
    ? `♻️ \`${parsed.keyword}\` GIF를 교체했습니다. (${kb}KB)`
    : `✅ \`${parsed.keyword}\` 입력하면 이 GIF를 보낼게요. (${kb}KB)`;
}

async function listGifs(guildId: string): Promise<string> {
  const list = await getGifKeywords(guildId);
  return list.length === 0
    ? `📭 등록된 GIF가 없습니다. \`${CMD_ADD} 키워드 URL\`로 등록하세요.`
    : `🖼️ **등록된 GIF 키워드**\n${list.map((k) => `• \`${k}\``).join("\n")}`;
}

async function removeGif(guildId: string, keyword: string): Promise<string> {
  if (!keyword) return `❌ 사용법: \`${CMD_DEL} 키워드\``;
  const deleted = await deleteGifTrigger(guildId, keyword);
  if (deleted) keywords.get(guildId)?.delete(keyword);
  return deleted
    ? `✅ \`${keyword}\` GIF를 삭제했습니다.`
    : `❌ \`${keyword}\` 키워드를 찾을 수 없습니다.`;
}

function say(message: Message, content: string): Promise<unknown> {
  return message.reply({ content, allowedMentions: { parse: [] } });
}

// ponytail: 서버당 키워드 수가 적어서 그냥 훑는다. 수백 개가 되면 그때 Aho-Corasick 같은 걸 올린다.
export function findKeywords(set: Set<string> | undefined, content: string): string[] {
  return [...(set ?? [])].filter((keyword) => content.includes(keyword)).slice(0, 4);
}

async function sendGif(message: Message, guildId: string, keyword: string): Promise<boolean> {
  const row = await getGifTrigger(guildId, keyword);
  if (!row) {
    keywords.get(guildId)?.delete(keyword);
    return false;
  }
  const ext = EXT[row.content_type] ?? "gif";
  await message.reply({ files: [new AttachmentBuilder(row.data, { name: `gif.${ext}` })] });
  return true;
}

export async function handleGif(message: Message): Promise<boolean> {
  if (!message.guild) return false;

  const guildId = message.guild.id;
  const content = message.content.trim();

  try {
    if (content === CMD_LIST) {
      await say(message, await listGifs(guildId));
      return true;
    }

    if (content.startsWith(CMD_DEL)) {
      await say(message, await removeGif(guildId, content.slice(CMD_DEL.length).trim()));
      return true;
    }

    if (content.startsWith(CMD_ADD)) {
      const parsed = parseAdd(content.slice(CMD_ADD.length), message.attachments.first()?.url);
      await say(message, await registerGif(guildId, message.author.id, parsed));
      return true;
    }

    const hits = findKeywords(keywords.get(guildId), content);
    let sent = false;
    for (const keyword of hits) {
      if (await sendGif(message, guildId, keyword)) sent = true;
    }
    return sent;
  } catch (err) {
    console.error("[Gif]", err);
    await say(message, "❌ GIF 처리 중 오류가 발생했습니다.").catch(() => {});
    return true;
  }
}

export async function handleGifSlash(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: "❌ 이 명령어는 서버에서만 사용할 수 있습니다.",
      ephemeral: true,
    });
    return;
  }

  try {
    if (interaction.commandName === "gif목록") {
      await interaction.reply({
        content: await listGifs(guildId),
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (interaction.commandName === "gif삭제") {
      await interaction.reply({
        content: await removeGif(guildId, interaction.options.getString("키워드", true).trim()),
        allowedMentions: { parse: [] },
      });
      return;
    }

    // 다운로드가 3초를 넘길 수 있어서 먼저 defer
    await interaction.deferReply();
    const keyword = interaction.options.getString("키워드", true).trim();
    const url =
      interaction.options.getAttachment("파일")?.url ?? interaction.options.getString("주소");
    const text = await registerGif(
      guildId,
      interaction.user.id,
      validate(keyword, url ?? undefined),
    );
    await interaction.editReply({ content: text, allowedMentions: { parse: [] } });
  } catch (err) {
    console.error("[Gif]", err);
    const content = "❌ GIF 처리 중 오류가 발생했습니다.";
    const done = interaction.deferred || interaction.replied;
    await (done ? interaction.editReply({ content }) : interaction.reply({ content })).catch(
      () => {},
    );
  }
}
