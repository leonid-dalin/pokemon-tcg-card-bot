import { REST, Routes } from "discord.js";
import { loadConfig } from "../src/config.js";
import { loadDotEnv } from "../src/env.js";

/**
 * Rename the bot user.
 *
 *   npm run rename Crustlebot
 *
 * PATCH /users/@me accepts a username for bot accounts only. Discord allows two
 * username changes per hour, so a rejected name costs one of them.
 */
const name = (process.argv[2] ?? "").trim();

if (!name) {
  console.error('usage: npm run rename "Crustlebot"');
  process.exit(1);
}
if (name.length < 2 || name.length > 32) {
  console.error(`"${name}" is ${name.length} characters; Discord allows 2 to 32`);
  process.exit(1);
}

loadDotEnv();
const config = loadConfig(process.env);
const rest = new REST().setToken(config.token);

try {
  const me = (await rest.patch(Routes.user(), { body: { username: name } })) as {
    id: string;
    username: string;
    discriminator: string;
  };
  console.log(`renamed to ${me.username}${me.discriminator && me.discriminator !== "0" ? `#${me.discriminator}` : ""} (${me.id})`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`rename rejected: ${message}`);
  console.error("A name already in use returns 400; pick another spelling.");
  process.exitCode = 1;
}
