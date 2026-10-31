import { REST } from "discord.js";
import { loadConfig } from "../src/config.js";
import { loadDotEnv } from "../src/env.js";
import { DEFAULT_BURST } from "../src/cooldown.js";

// The reply cooldown takes MentionBudget's default burst (cooldown.ts), which is
// independent of MEMBER_LOOKUP_BURST, the upstream request cap.

// Check the configured token and list guilds and registered commands through REST.
// Usage: npm run doctor
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
// The reply cooldown uses MentionBudget's default burst, not MEMBER_LOOKUP_BURST,
// which caps upstream requests.
console.log(
    config.mentionCooldownSeconds > 0
      ? `throttle: burst of ${DEFAULT_BURST}, then one per ${config.mentionCooldownSeconds}s per member`
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
  // Allow pending REST cleanup to finish before exiting with a failure status.
  process.exitCode = 1;
}
