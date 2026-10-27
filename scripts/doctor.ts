import { REST } from "discord.js";
import { loadConfig } from "../src/config.js";
import { loadDotEnv } from "../src/env.js";

/**
 * Preflight check for the credentials in .env.
 *
 *   npm run doctor
 *
 * It reads the token, calls GET /users/@me and prints which bot it belongs to,
 * then lists the servers the bot has been invited to. A wrong or expired token
 * fails here with Discord's own error instead of failing inside the gateway.
 */
loadDotEnv();

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(`.env is incomplete: ${(error as Error).message}`);
  console.error("");
  console.error("Fill in both values in .env:");
  console.error("  DISCORD_TOKEN      developers/applications -> your app -> Bot -> Token -> Reset Token");
  console.error("  DISCORD_CLIENT_ID  developers/applications -> your app -> General Information -> Application ID");
  process.exit(1);
}

console.log(`client id: ${config.clientId}`);
console.log(`mention replies: ${config.mentionEnabled ? "on" : "off (set MENTION_ENABLED=true)"}`);
console.log(
    config.mentionCooldownSeconds > 0
      ? `throttle: burst of 3, then one per ${config.mentionCooldownSeconds}s per member`
      : "throttle: off",
  );
console.log("");

const rest = new REST().setToken(config.token);

try {
  const me = (await rest.get("/users/@me")) as { id: string; username: string; bot?: boolean };
  if (me.id !== config.clientId) {
    console.warn(`warning: token belongs to ${me.id} but DISCORD_CLIENT_ID is ${config.clientId}`);
  }
  console.log(`token valid, authenticated as ${me.username} (${me.id})${me.bot ? "" : " [not a bot user]"}`);

  const guilds = (await rest.get("/users/@me/guilds")) as { id: string; name: string }[];
  if (guilds.length === 0) {
    console.log("not in any server yet: invite it with the OAuth2 URL from the Developer Portal");
  } else {
    console.log(
      `in ${guilds.length} server(s): ${guilds.map((guild) => `${guild.name} (${guild.id})`).join(", ")}`,
    );
  }

  type Command = { name: string; description: string };
  const global = (await rest.get(`/applications/${config.clientId}/commands`)) as Command[];
  const guild = config.guildId
    ? ((await rest.get(
        `/applications/${config.clientId}/guilds/${config.guildId}/commands`,
      )) as Command[])
    : [];

  const describe = (label: string, list: Command[]) =>
    list.length === 0 ? `${label}: none` : `${label}: ${list.map((command) => `/${command.name}`).join(", ")}`;

  console.log(describe("global commands", global));
  if (config.guildId) console.log(describe("guild commands", guild));
  if (global.length === 0 && guild.length === 0) {
    console.log("no slash commands registered yet: run npm run register");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`token rejected: ${message}`);
  // Set the exit code instead of calling process.exit, which trips a libuv
  // handle assertion while undici is still closing its sockets.
  process.exitCode = 1;
}
