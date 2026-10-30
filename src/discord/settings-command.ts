import { InteractionContextType, SlashCommandBuilder } from "discord.js";

export const settingsCommand = new SlashCommandBuilder()
  .setName("settings")
  .setDescription("Configure how the bot replies in this server")
  .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM);
