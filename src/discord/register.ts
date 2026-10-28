import { REST, Routes } from "discord.js";
import { loadConfig } from "../config.js";
import { loadDotEnv } from "../env.js";
import { commandDefinitions } from "./commands.js";

loadDotEnv();

const config = loadConfig(process.env);
const rest = new REST().setToken(config.token);
const body = commandDefinitions.map((command) => command.toJSON());
// Guild-scoped commands already apply to one server, so the contexts field is not accepted there.
const guildBody = body.map(({ contexts: _contexts, ...command }) => command);

if (config.guildId) {
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: guildBody });
  console.log(`registered ${body.length} guild commands in ${config.guildId}`);
} else {
  await rest.put(Routes.applicationCommands(config.clientId), { body });
  console.log(`registered ${body.length} global commands`);
}
