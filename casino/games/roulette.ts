import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Message,
  ButtonInteraction,
} from "discord.js";
import { getUser, updateBalance } from "../../db.js";
import { sleep, parseBet, fmt, activeGamblers } from "./shared.js";

const RED_NUMS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

const ROULETTE_GIFS = [
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481972772111650930/202603132003.gif?ex=69b54232&is=69b3f0b2&hm=37b2d8ab6beafaa5a6f2d33089a4e841f5831605a1d2f269830c9ae1645d2f0b&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481973086520741908/202603132003_1.gif?ex=69b5427d&is=69b3f0fd&hm=aa35c593c6e9b329125ce5d7b1bd90db813625dc7aa62ddf1837bd1f1fc9c1d7&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481973579259187381/202603132003_2.gif?ex=69b542f3&is=69b3f173&hm=2dd76ef13f77757a8f08006b2d3594f2e0b50ec02d0c779b23ccf782129a9628&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481978496048955459/0313_1.gif?ex=69b54787&is=69b3f607&hm=2d49d5f057e8ae9208733a8e7609d12aa2e779ba20b24617e4b04506b05b8b24&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481979229712416868/0313_11.gif?ex=69b54836&is=69b3f6b6&hm=30d424e449f5713591996fde24355b1a7072fcd3c352750120800f875b2cfaf0&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481979461829136415/0313_12.gif?ex=69b5486d&is=69b3f6ed&hm=89c5527cd61c4b6d3b46c4f92a62a3208c8e4fa852c3714a6d3c32b39509cc01&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481979764406354011/0313_13.gif?ex=69b548b5&is=69b3f735&hm=630fb82c89b1a25f3131497dfea6cd435c8bbbaa9431a7286b94bd720cf361b5&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481979998305779803/0313_14.gif?ex=69b548ed&is=69b3f76d&hm=17f5174c6e3f8ee53ae0e62a39ecb2474db23527ae38300522089aaab47e4b0d&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481980290820866229/0313_15.gif?ex=69b54933&is=69b3f7b3&hm=6a940828898c93a30054483a06067af616023f8e93834e26620b70776708ba4c&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481980504285909104/0313_16.gif?ex=69b54966&is=69b3f7e6&hm=57f933d655a9be72fd6aa8af6f0b60e9babdda68931d1fc0c62681a44732fc6a&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481980802224095335/0313_17.gif?ex=69b549ad&is=69b3f82d&hm=dadf48e46f5b203b303685f553c76a5023eaec667cf3d5ce00254fb63f19d728&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481981323315777567/0313_18.gif?ex=69b54a29&is=69b3f8a9&hm=0cec8213d3095692fcfaf575c4c883d91b7a1b6a29ba9bed1ed8fe76a2e88ff0&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481981830935613521/0313_19.gif?ex=69b54aa2&is=69b3f922&hm=ba49f3f2c3d264ea1999cc323d8fca27e655640d9628ae8ddd026697aa0840bd&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481982207324196885/0313_110.gif?ex=69b54afc&is=69b3f97c&hm=ff63b9d827ba1b6fef63b9d827ba1b6fef63b9d827ba1b6fe3b955f3cc131fc0c62681a44732fc6a&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481982513210724473/0313_111.gif?ex=69b54b45&is=69b3f9c5&hm=0cec8213d3095692fcfaf575c4c883d91b7a1b6a29ba9bed1ed8fe76a2e88ff0&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481982835790319757/0313_112.gif?ex=69b54b91&is=69b3fa11&hm=23826f73f1d18b86c931b10caf4574cc7c5cd7deb33ba917c8ef608c4966e513&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481983190724771847/0313_113.gif?ex=69b54be6&is=69b3fa66&hm=2a608d21b5b9b5c3368fda6992e870d535c95c678d84e66c3c8f7411d5bb9295&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481983400024870973/0313_114.gif?ex=69b54c18&is=69b3fa98&hm=d1c799a308b30a50bce41eb4519c701a5cb981f5d3da13c0390cddff951a9c0b&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481983607580004462/0313_115.gif?ex=69b54c49&is=69b3fac9&hm=ff7e3761505535c4a845c3f1d3564890f7ff41dc4fb30c08e2d04433cf6f64cd&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481983930524766310/0313_116.gif?ex=69b54c96&is=69b3fb16&hm=3b955f3cc131fc0ddf73006953314de5d574b2fb2910c6a1c86889c1d34480b3&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481984223412883477/0313_117.gif?ex=69b54cdc&is=69b3fb5c&hm=c4933999244a760d57e1a66305690f4782fd996183cd610edc3d1f7171944e74&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481984480200622120/0313_118.gif?ex=69b54d1a&is=69b3fb9a&hm=21683e2013b08dd08f2d9c722ae9ab14ed076bf9bfaa28f69196456b099cd8ff&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481984648249737389/0313_119.gif?ex=69b54d42&is=69b3fbc2&hm=0f82442be925eb8e8e74a585ed0c08bbb2edea9243341967ba8e8f4723eca812&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481984911211757628/0313_120.gif?ex=69b54d80&is=69b3fc00&hm=02aceef0c0ae002395569e01ccf154dea8e7ab61b7ae395edf8787ca8cf34457&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481985172990595242/0313_121.gif?ex=69b54dbf&is=69b3fc3f&hm=835e13de8b68a9372b8e9818907905f45e2125e6e95593f92ce279bc6da1c3b2&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481985329346117674/0313_122.gif?ex=69b54de4&is=69b3fc64&hm=625646eb91b609facba5cce29f32dfd64b573e81d3359a7a0885d24aea17409b&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481985578433118318/0313_123.gif?ex=69b54e1f&is=69b3fc9f&hm=3b955f3cc131fc0ddf73006953314de5d574b2fb2910c6a1c86889c1d34480b3&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481985754602274866/0313_124.gif?ex=69b54e49&is=69b3fcc9&hm=378c4497f65e3779b6708fa2706ce4ae644c26b1b69bbe907ff60e5afa3db02d&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481985897464463420/0313_125.gif?ex=69b54e6b&is=69b3fceb&hm=f23ecb33e334e7d89f8896f6c0ff16679c9d66d95a3fb479dc0472ff69345e47&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481986082911424675/0313_126.gif?ex=69b54e98&is=69b3fd18&hm=4c57b0cc6cd2051252ec09ac7389bb866a60c7249089b7461400ca5b9210edc8&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481986286343557331/0313_127.gif?ex=69b54ec8&is=69b3fd48&hm=1abaf09a3ea6ceee33aedde9ff43bd29462f2c8231c62a70b8cec735d7cfd7cb&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481986510055145503/0313_128.gif?ex=69b54efd&is=69b3fd7d&hm=ddf1b25045c3b473709d4a841ee1bf3b1a70ccd8c55f832193bb98d085c76004&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481986724878880918/0313_129.gif?ex=69b54f31&is=69b3fdb1&hm=667b0199ce06aef12c20b9fbb5acdbba9b161a6fdfb02f2d90208349b0567cd1&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481986918504730624/0313_130.gif?ex=69b54f5f&is=69b3fddf&hm=05e82738ff1be63109228ade6b9025e1771d72786afe3f2ca8c58493011809c6&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481987100789313546/0313_131.gif?ex=69b54f8a&is=69b3fe0a&hm=00343b2ad617716a408e2f229c37166e1b9d5f164cd5e32ca8a16d055159412a&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481987256918212608/0313_132.gif?ex=69b54fb0&is=69b3fe30&hm=6a940828898c93a30054483a06067af616023f8e93834e26620b70776708ba4c&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481987493384687726/0313_133.gif?ex=69b54fe8&is=69b3fe68&hm=efe6cd1d76afe749e1893352c6cf3a441cb5c0ce7d4764538876ec8cf254e4c9&",
];

export async function handleRoulette(message: Message, args: string[]): Promise<void> {
  const user = await getUser(message.guild!.id, message.author.id, message.author.username);
  const { error, amount } = parseBet(args[0], user.balance);
  if (error) {
    message.reply(error);
    return;
  }

  const uid = message.author.id;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`rl_odd_${uid}_${amount}`)
      .setLabel("홀")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`rl_even_${uid}_${amount}`)
      .setLabel("짝")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`rl_black_${uid}_${amount}`)
      .setLabel("검")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`rl_red_${uid}_${amount}`)
      .setLabel("빨")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`rl_zero_${uid}_${amount}`)
      .setLabel("0")
      .setStyle(ButtonStyle.Success),
  );

  activeGamblers.add(uid);
  message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle("룰렛")
        .setDescription(
          `베팅 금액: **${amount!.toLocaleString()}원**\n홀 / 짝 / 검 / 빨 / **0** (35배) 중 선택하세요.`,
        ),
    ],
    components: [row],
  });
}

export async function handleRouletteButton(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split("_");
  const betType = parts[1];
  const userId = parts[2];
  const amount = parseInt(parts[3]);

  if (interaction.user.id !== userId) {
    interaction.reply({ content: "❌ 이 게임은 당신의 게임이 아닙니다.", ephemeral: true });
    return;
  }

  const user = await getUser(interaction.guildId!, userId, interaction.user.username);
  if (user.balance < amount) {
    activeGamblers.delete(userId);
    interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("🎡 룰렛")
          .setDescription("❌ 잔액이 부족합니다."),
      ],
      components: [],
    });
    return;
  }

  await updateBalance(interaction.guildId!, userId, -amount);

  const result = Math.floor(Math.random() * 37);
  const colorEmoji = result === 0 ? "🟢" : RED_NUMS.has(result) ? "🔴" : "⚫";

  const win =
    betType === "zero"
      ? result === 0
      : betType === "odd"
        ? result !== 0 && result % 2 === 1
        : betType === "even"
          ? result !== 0 && result % 2 === 0
          : betType === "red"
            ? RED_NUMS.has(result)
            : betType === "black"
              ? result !== 0 && !RED_NUMS.has(result)
              : false;

  let delta: number;
  if (betType === "zero" && win) {
    delta = amount * 35;
    await updateBalance(interaction.guildId!, userId, amount * 36);
  } else if (win) {
    delta = amount;
    await updateBalance(interaction.guildId!, userId, amount * 2);
  } else {
    delta = -amount;
  }

  const updated = await getUser(interaction.guildId!, userId, interaction.user.username);
  const betLabel: Record<string, string> = {
    odd: "홀",
    even: "짝",
    black: "⚫ 검",
    red: "🔴 빨",
    zero: "🟢 0",
  };

  await interaction.deferUpdate();
  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle("룰렛")
        .setImage(ROULETTE_GIFS[result])
        .setFooter({ text: "룰렛이 돌아가고 있습니다..." }),
    ],
    components: [],
  });
  await sleep(9000);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(win ? 0x22c55e : 0xef4444)
        .setTitle("🎡 룰렛")
        .setDescription(`> ${colorEmoji} **${result}** ${colorEmoji}`)
        .addFields(
          { name: "베팅", value: betLabel[betType] ?? betType, inline: true },
          { name: "판정", value: win ? "🎉 승리!" : "😔 패배", inline: true },
          { name: "손익", value: fmt(delta), inline: true },
          { name: "현재 잔액", value: `${updated.balance.toLocaleString()}원`, inline: true },
        ),
    ],
  });
  activeGamblers.delete(userId);
}
