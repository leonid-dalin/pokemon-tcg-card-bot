import { REST, Routes } from "discord.js";
import { loadConfig } from "../config.js";
import { commandDefinitions } from "./commands.js";

const config = loadConfig(process.env);
const rest = new REST().setToken(config.token);
const body = commandDefinitions.map((command) => command.toJSON());

if (config.guildId) {
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
  console.log(`registered ${body.length} guild commands in ${config.guildId}`);
} else {
  await rest.put(Routes.applicationCommands(config.clientId), { body });
  console.log(`registered ${body.length} global commands`);
}
