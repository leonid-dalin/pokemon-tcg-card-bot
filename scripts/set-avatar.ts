import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { REST, Routes } from "discord.js";
import { loadConfig } from "../src/config.js";

/**
 * Set the bot's profile picture.
 *
 *   yarn avatar "assets/avatar.jpg"
 *
 * Discord takes the image as a data URL on PATCH /users/@me, so the file is
 * inlined and base64 encoded here. It must be under 8 MB and one of png, jpg,
 * jpeg, webp or gif; a square image is best because Discord masks avatars to a
 * circle.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const MAX_BYTES = 8 * 1024 * 1024;

const path = process.argv[2] ?? "assets/avatar.jpg";
const extension = extname(path).toLowerCase();
const mime = MIME_BY_EXTENSION[extension];
if (!mime) {
  console.error(`unsupported file type ${extension || "(none)"}; use png, jpg, jpeg, webp or gif`);
  process.exit(1);
}

const bytes = statSync(path).size;
if (bytes > MAX_BYTES) {
  console.error(`${path} is ${(bytes / 1024 / 1024).toFixed(1)} MB; Discord accepts up to 8 MB`);
  process.exit(1);
}

const config = loadConfig(process.env);
const avatar = `data:${mime};base64,${readFileSync(path).toString("base64")}`;
const rest = new REST().setToken(config.token);

const me = (await rest.patch(Routes.user(), { body: { avatar } })) as {
  username: string;
  avatar: string | null;
};

console.log(`avatar updated for ${me.username}: ${me.avatar ?? "none"}`);
