import {
  GuildMember,
  Guild,
  BaseMessageOptions,
  GuildTextBasedChannel,
  VoiceBasedChannel,
  Message,
  MessageFlags,
  PermissionFlagsBits,
  ChatInputCommandInteraction,
  InteractionReplyOptions,
} from "discord.js";

// 텍스트 명령은 디스코드 API상 "나만 보기(ephemeral)"가 불가능해서, 잠깐 보여준 뒤 지운다
const PRIVATE_REPLY_TTL_MS = 5_000;

export interface Ctx {
  reply(opts: string | BaseMessageOptions): Promise<unknown>;
  // 슬래시 명령: 본인에게만 보이는 ephemeral 응답 / 텍스트 명령: 몇 초 뒤 자동 삭제되는 답장
  replyPrivate(content: string): Promise<unknown>;
  // 외부 API처럼 오래 걸릴 수 있는 작업 전에 호출 — 슬래시는 3초 응답 제한을 피하고, 텍스트는 입력 중 표시
  defer(): Promise<void>;
  isInteraction: boolean;
  isAdmin: boolean;
  guildId: string | null;
  guild: Guild | null;
  authorId: string;
  username: string;
  member: GuildMember | null;
  channel: GuildTextBasedChannel | null;
  voiceChannel: VoiceBasedChannel | null;
}

export function ctxFromMessage(message: Message): Ctx {
  const member = message.member as GuildMember | null;
  return {
    reply: (opts) => message.reply(opts as any),
    replyPrivate: async (content) => {
      const sent = await message.reply({ content, allowedMentions: { repliedUser: false } });
      setTimeout(() => void sent.delete().catch(() => {}), PRIVATE_REPLY_TTL_MS).unref();
      return sent;
    },
    defer: async () => {
      // 입력 중 표시는 부가 효과라 기다리지 않는다 (응답 지연을 늘리지 않도록)
      if ("sendTyping" in message.channel) void message.channel.sendTyping().catch(() => {});
    },
    isInteraction: false,
    isAdmin: member?.permissions.has(PermissionFlagsBits.Administrator) ?? false,
    guildId: message.guild?.id ?? null,
    guild: message.guild,
    authorId: message.author.id,
    username: message.author.username,
    member,
    channel: message.channel as GuildTextBasedChannel | null,
    voiceChannel: member?.voice?.channel ?? null,
  };
}

export function ctxFromInteraction(interaction: ChatInputCommandInteraction): Ctx {
  const member = interaction.member instanceof GuildMember ? interaction.member : null;
  // defer 후 첫 응답은 "생각 중..." 메시지를 채우고(editReply), 그 뒤 응답은 새 메시지(followUp)로 보낸다
  let answered = false;
  return {
    reply: (opts) => {
      const o = typeof opts === "string" ? { content: opts } : opts;
      if (interaction.deferred && !answered) {
        answered = true;
        return interaction.editReply(o);
      }
      if (interaction.deferred || interaction.replied) return interaction.followUp(o);
      answered = true;
      return interaction.reply(o as InteractionReplyOptions);
    },
    replyPrivate: (content) => {
      const o = { content, flags: MessageFlags.Ephemeral } as const;
      if (interaction.deferred || interaction.replied) return interaction.followUp(o);
      answered = true;
      return interaction.reply(o);
    },
    defer: async () => {
      if (!interaction.deferred && !interaction.replied) await interaction.deferReply();
    },
    isInteraction: true,
    // interaction.member는 캐시 상태에 따라 GuildMember가 아닐 수 있어서 memberPermissions로 판정한다
    isAdmin: interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false,
    guildId: interaction.guildId,
    guild: interaction.guild,
    authorId: interaction.user.id,
    username: interaction.user.username,
    member,
    channel: interaction.channel as GuildTextBasedChannel | null,
    voiceChannel: member?.voice?.channel ?? null,
  };
}

// 서버 관리자 전용 기능 on/off 공통 처리 (급식, 도박)
export async function handleAdminToggle(
  ctx: Ctx,
  enable: boolean,
  featureName: string,
  save: (guildId: string, enabled: boolean) => Promise<void>,
): Promise<void> {
  if (!ctx.guildId) {
    await ctx.replyPrivate("❌ 이 명령어는 서버에서만 사용할 수 있습니다.");
    return;
  }
  if (!ctx.isAdmin) {
    await ctx.replyPrivate("❌ 서버 관리자 권한이 필요합니다.");
    return;
  }
  await save(ctx.guildId, enable);
  await ctx.reply(
    enable
      ? `✅ ${featureName} 기능이 **활성화**되었습니다.`
      : `🔒 ${featureName} 기능이 **비활성화**되었습니다.`,
  );
}
