import net from "node:net";
import { lookup } from "node:dns/promises";
import { Message, AttachmentBuilder } from "discord.js";
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
const MAX_BYTES = 8 * 1024 * 1024;
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

export function parseAdd(rest: string, attachmentUrl?: string): ParseResult {
  const trimmed = rest.trim();
  let keyword: string;
  let url: string;

  if (attachmentUrl) {
    keyword = trimmed;
    url = attachmentUrl;
  } else {
    const match = trimmed.match(/^(.*\S)\s+(\S+)$/);
    if (!match) return { error: USAGE };
    keyword = match[1].trim();
    url = match[2];
  }

  if (!keyword) return { error: USAGE };
  if (keyword.length > MAX_KEYWORD)
    return { error: `❌ 키워드는 ${MAX_KEYWORD}자 이하여야 합니다.` };
  if (/[\r\n]/.test(keyword)) return { error: "❌ 키워드에 줄바꿈은 쓸 수 없습니다." };
  if (keyword.startsWith("!"))
    return { error: "❌ `!`로 시작하는 키워드는 명령어와 겹쳐서 쓸 수 없습니다." };
  if (!/^https:\/\//i.test(url))
    return { error: "❌ `https://`로 시작하는 주소만 등록할 수 있습니다." };

  return { keyword, url };
}

function say(message: Message, content: string): Promise<unknown> {
  return message.reply({ content, allowedMentions: { parse: [] } });
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
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  if (addr.startsWith("::ffff:")) return isBlockedIp(addr.slice(7)); // IPv4-mapped
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

async function download(
  url: string,
): Promise<{ data: Buffer; contentType: string } | { error: string }> {
  const res = await safeFetch(url);
  if ("error" in res) return res;
  if (!res.ok)
    return { error: `❌ 파일을 받지 못했습니다. (HTTP ${res.status}) 링크가 만료됐을 수 있어요.` };

  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!contentType.startsWith("image/")) {
    return {
      error:
        "❌ 이미지가 아닙니다. Tenor/Imgur **페이지 주소** 말고 이미지 직링크(.gif)를 넣거나 파일을 첨부해주세요.",
    };
  }

  const declared = Number(res.headers.get("content-length"));
  if (declared > MAX_BYTES) return { error: "❌ 파일이 너무 큽니다. (최대 8MB)" };

  const data = Buffer.from(await res.arrayBuffer());
  if (data.byteLength === 0) return { error: "❌ 빈 파일입니다." };
  // content-length가 없는 응답도 있어서 실제로 받은 크기로 한 번 더 본다
  if (data.byteLength > MAX_BYTES) return { error: "❌ 파일이 너무 큽니다. (최대 8MB)" };

  return { data, contentType };
}

async function handleAdd(message: Message, guildId: string, content: string): Promise<void> {
  const parsed = parseAdd(content.slice(CMD_ADD.length), message.attachments.first()?.url);
  if ("error" in parsed) {
    await say(message, parsed.error);
    return;
  }

  const file = await download(parsed.url);
  if ("error" in file) {
    await say(message, file.error);
    return;
  }

  const replaced = await addGifTrigger(
    guildId,
    parsed.keyword,
    file.data,
    file.contentType,
    message.author.id,
  );

  const set = keywords.get(guildId) ?? new Set<string>();
  set.add(parsed.keyword);
  keywords.set(guildId, set);

  const kb = Math.round(file.data.byteLength / 1024);
  await say(
    message,
    replaced
      ? `♻️ \`${parsed.keyword}\` GIF를 교체했습니다. (${kb}KB)`
      : `✅ \`${parsed.keyword}\` 입력하면 이 GIF를 보낼게요. (${kb}KB)`,
  );
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
      const list = await getGifKeywords(guildId);
      await say(
        message,
        list.length === 0
          ? `📭 등록된 GIF가 없습니다. \`${CMD_ADD} 키워드 URL\`로 등록하세요.`
          : `🖼️ **등록된 GIF 키워드**\n${list.map((k) => `• \`${k}\``).join("\n")}`,
      );
      return true;
    }

    if (content.startsWith(CMD_DEL)) {
      const keyword = content.slice(CMD_DEL.length).trim();
      if (!keyword) {
        await say(message, `❌ 사용법: \`${CMD_DEL} 키워드\``);
        return true;
      }
      const deleted = await deleteGifTrigger(guildId, keyword);
      if (deleted) keywords.get(guildId)?.delete(keyword);
      await say(
        message,
        deleted
          ? `✅ \`${keyword}\` GIF를 삭제했습니다.`
          : `❌ \`${keyword}\` 키워드를 찾을 수 없습니다.`,
      );
      return true;
    }

    if (content.startsWith(CMD_ADD)) {
      await handleAdd(message, guildId, content);
      return true;
    }

    if (!keywords.get(guildId)?.has(content)) return false;
    return await sendGif(message, guildId, content);
  } catch (err) {
    console.error("[Gif]", err);
    await say(message, "❌ GIF 처리 중 오류가 발생했습니다.").catch(() => {});
    return true;
  }
}
