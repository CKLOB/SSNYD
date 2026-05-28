import {
  GuildMember,
  Guild,
  BaseMessageOptions,
  GuildTextBasedChannel,
  VoiceBasedChannel,
  Message,
  ChatInputCommandInteraction,
  InteractionReplyOptions,
} from "discord.js";

export interface Ctx {
  reply(opts: string | BaseMessageOptions): Promise<unknown>;
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
  return {
    reply: (opts) => {
      if (typeof opts === "string") return interaction.reply({ content: opts });
      return interaction.reply(opts as InteractionReplyOptions);
    },
    guildId: interaction.guildId,
    guild: interaction.guild,
    authorId: interaction.user.id,
    username: interaction.user.username,
    member,
    channel: interaction.channel as GuildTextBasedChannel | null,
    voiceChannel: member?.voice?.channel ?? null,
  };
}
