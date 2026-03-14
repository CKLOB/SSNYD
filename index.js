const { Client, Events, GatewayIntentBits } = require("discord.js");
const { handleCasino, handleButtonInteraction } = require("./casino/handler");
const { handleMeal } = require("./meal/handler");
const { handleScheduler, initScheduler } = require("./scheduler/handler");
const { handleTimetable } = require("./timetable/handler");
const { init: initDb } = require("./casino/db");
const { handleRandom } = require("./random/handler");

const token = process.env.DISCORD_TOKEN;
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
  await initDb();
  initScheduler(readyClient);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  await handleButtonInteraction(interaction);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (await handleCasino(message)) return;
  if (await handleRandom(message)) return;
  if (await handleScheduler(message)) return;
  if (await handleTimetable(message)) return;
  await handleMeal(message);
});

client.login(token);
