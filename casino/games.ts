import { ButtonInteraction } from "discord.js";
import { handleCoinflip, handleCoinflipButton } from "./games/coinflip.js";
import { handleBlackjack, handleBjButton } from "./games/blackjack.js";
import { handleBaccarat, handleBaccaratButton } from "./games/baccarat.js";
import { handleRoulette, handleRouletteButton } from "./games/roulette.js";
import { isGambling } from "./games/shared.js";

async function handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
  const id = interaction.customId;
  if (id.startsWith("cf_")) return handleCoinflipButton(interaction);
  if (id.startsWith("bj_")) return handleBjButton(interaction);
  if (id.startsWith("bac_")) return handleBaccaratButton(interaction);
  if (id.startsWith("rl_")) return handleRouletteButton(interaction);
}

export {
  handleCoinflip,
  handleBlackjack,
  handleBaccarat,
  handleRoulette,
  handleButtonInteraction,
  isGambling,
};
