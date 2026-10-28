import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { REST, Routes } from "discord.js";
import { loadConfig } from "../src/config.js";
import { loadDotEnv } from "../src/env.js";

// Upload a local image to the bot profile as a base64 data URL.
// Check the extension and file size before making the request.
// Usage: npm run avatar "assets/avatar.jpg"
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

loadDotEnv();

const config = loadConfig(process.env);
const avatar = `data:${mime};base64,${readFileSync(path).toString("base64")}`;
const rest = new REST().setToken(config.token);

const me = (await rest.patch(Routes.user(), { body: { avatar } })) as {
  username: string;
  avatar: string | null;
};

console.log(`avatar updated for ${me.username}: ${me.avatar ?? "none"}`);
