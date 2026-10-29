# Setup

This guide gets a bot running from a source checkout. For unattended operation and boot startup, follow [deployment](deployment.md) after creating the Discord application

## Requirements

You need Git, Node.js 24 or newer, and a Discord application with a bot user. Use the Node version in [.nvmrc](../.nvmrc) to match CI

## Get the code

```sh
git clone https://github.com/leonid-dalin/pokemon-tcg-card-bot.git
cd pokemon-tcg-card-bot
npm ci
cp .env.example .env
```

In PowerShell, use `Copy-Item .env.example .env` for the last command

## Configure Discord

Create an application in the [Discord Developer Portal](https://discord.com/developers/applications). Copy its Application ID and bot token into `.env`. Set a test server ID to register commands there while developing:

```dotenv
DISCORD_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-application-id
DISCORD_GUILD_ID=your-test-server-id
DATA_DIR=./data
```

On the application's Bot page, enable **Message Content Intent** for ordinary-message replies. For a slash-command-only instance, set `MENTION_ENABLED=false` in `.env`; the bot then omits that intent

Create a server invite with the `bot` and `applications.commands` scopes. Grant View Channels, Send Messages, Send Messages in Threads, Embed Links, Read Message History and Use Application Commands. Use permissions integer `277025475584` for that combination

## Register and run

```sh
npm run doctor
npm run register
npm run dev
```

`doctor` checks the credentials and lists servers and registered commands. `register` publishes all six commands, replacing the application's command definitions in the test server. Leave `DISCORD_GUILD_ID` unset for global registration. Register again after changing command definitions

Try `/card name:Dragapult ex` in the server. With message replies enabled, `[[Dragapult ex]]` should also answer

> [!NOTE]
> Keep `.env` private. Set `DATA_DIR` to retain server settings after restart; without it, those choices live only in memory


## Run the compiled bot

```sh
npm run build
npm start
```

Run from the repository root and keep the installed dependencies and `src/data/text-index.json` alongside `dist/`. The compiler does not copy that search index. Run one instance per bot token across all machines; the local `.bot.pid` check cannot detect a second host

## Troubleshooting

- No ordinary-message replies: check Message Content Intent, `MENTION_ENABLED`, server reply settings and the selected-channel list
- No replies in threads: grant Send Messages in Threads and check the parent channel's selection
- Missing or outdated slash commands: run `npm run register` with the intended guild or global scope
- Settings disappear after restart: configure a persistent `DATA_DIR` and check its write permissions
- A list has expired: run the command again to create a new one
- Another instance is already running: stop the existing copy before starting a replacement


See [configuration](configuration.md) for all environment variables and [server settings](server-settings.md) for per-server choices
