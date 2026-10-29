# Pokémon TCG card bot

A Discord bot that looks up Pokémon TCG and Pokémon TCG Pocket cards from slash commands and card names in chat

[![CI on master](https://github.com/leonid-dalin/pokemon-tcg-card-bot/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/leonid-dalin/pokemon-tcg-card-bot/actions/workflows/ci.yml)

[Commands](#commands) · [Quick start](#quick-start) · [Server settings](#server-settings) · [Deployment](#deployment)

```text
[[Dragapult ex]]
[[Charizard ex|pocket]]
@bot search "search your deck"
```

Card replies show the scan, stats and rules text. Printing buttons change the card in place; `Details` opens set information, legality and available prices in a private reply. Only the person who requested a card or list can change its printing or page

## Commands

| Command | Result |
| --- | --- |
| `/card name:<name> [set:<hint>]` | One card, with name autocomplete and an optional set or printing hint |
| `/printings name:<name>` | Same-name printings, newest first |
| `/set id:<set id>` | Set summary; add `checklist:true` for its card list |
| `/search text:<words>` | Search indexed card names and rules text; quote a phrase to match adjacent words |
| `/help` | Command and message examples |
| `/settings` | Server reply preferences, channels, cooldown and card game choices |

In chat, use `[[Card name]]`, with up to three distinct names per message. Add a set ID, printed set code or set name after `|` to choose a printing, such as `[[Charizard ex|sv03]]`. An exact card ID also works: `[[Dragapult ex|sv08.5-073]]`

Use `pocket`, `ptcgp` or `tcgp` as the hint for Pocket cards, or `[[!Card name]]` for the scan alone. Names tolerate differences in case, accents and apostrophes. Card mentions inside inline code or code blocks are ignored

Mention the bot's actual account for the `@bot` examples. A bare mention or `@bot help` opens help; `@bot search <words>` runs wording search. Pasted decklists can show card counts, Standard legality and available Cardmarket prices when decklist replies are enabled

## Quick start

You need Git, Node.js 24 or newer, and a Discord application with a bot user. Use the Node version in [.nvmrc](.nvmrc) to match CI

### Get the code

```sh
git clone https://github.com/leonid-dalin/pokemon-tcg-card-bot.git
cd pokemon-tcg-card-bot
npm ci
cp .env.example .env
```

In PowerShell, use `Copy-Item .env.example .env` for the last command

### Configure Discord

Create an application in the [Discord Developer Portal](https://discord.com/developers/applications). Copy its Application ID and bot token into `.env`. Set a test server ID to register commands there while developing:

```dotenv
DISCORD_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-application-id
DISCORD_GUILD_ID=your-test-server-id
DATA_DIR=./data
```

On the application's Bot page, enable **Message Content Intent** for ordinary-message replies. For a slash-command-only instance, set `MENTION_ENABLED=false` in `.env`; the bot then omits that intent

Create a server invite with the `bot` and `applications.commands` scopes. Grant View Channels, Send Messages, Send Messages in Threads, Embed Links, Read Message History and Use Application Commands. Use permissions integer `277025475584` for that combination

### Register and run

```sh
npm run doctor
npm run register
npm run dev
```

`doctor` checks the credentials and lists servers and registered commands. `register` publishes all six commands, replacing the application's command definitions in the test server. Leave `DISCORD_GUILD_ID` unset for global registration. Register again after changing command definitions

Try `/card name:Dragapult ex` in the server. With message replies enabled, `[[Dragapult ex]]` should also answer

> [!NOTE]
> Keep `.env` private. Set `DATA_DIR` to retain server settings after restart; without it, those choices live only in memory

## Server settings

Members with Manage Server permission can use `/settings` to choose reply types, allowed channels, cooldown and card game preferences. For example:

```text
/settings view
/settings decklists enabled:true
/settings channels add channel:#cards
/settings channels mode mode:selected
/settings games allowed games:both
/settings games default game:pocket
```

Message replies and decklist replies have separate server switches. Selected-channel mode applies to automatic replies; threads use their parent channel's selection. Game preferences apply to card-name lookups, with explicit hints and exact IDs taking precedence

`/settings reset` returns the server to deployment defaults. A server setting cannot enable ordinary-message replies while the host has `MENTION_ENABLED=false`

## Configuration

The bot reads process environment variables and a local `.env`. The user-facing options are listed in [.env.example](.env.example)

| Variable | Purpose and default |
| --- | --- |
| `DISCORD_TOKEN` | Required bot token |
| `DISCORD_CLIENT_ID` | Required Discord Application ID |
| `DISCORD_GUILD_ID` | Optional server ID for command registration; unset means global |
| `DATA_DIR` | Settings database directory; unset means settings reset on restart |
| `MENTION_ENABLED` | Enables ordinary-message handling and its gateway intent; `true` |
| `DECKLIST_ENABLED` | Initial server default for pasted decklists; `false` |
| `MENTION_COOLDOWN_SECONDS` | Initial reply cooldown; `0` in code, `30` in the example file |
| `ATTRIBUTION` | Physical-card footer; `Card data from TCGdex` |
| `ENERGY_EMOJI` | JSON mapping of energy types to Discord emoji markup; `{}` |
| `INVOCATION_LOG_DIR` | Optional directory for full triggering-message and reply logs; disabled when unset |
| `INVOCATION_LOG_RETENTION_DAYS` | Log retention setting; defaults to `60`, capped at `60` |

The cooldown allows a burst of three automatic replies per member and channel, then replenishes one reply per configured interval. Zero disables it. Slash commands do not use that budget

Invocation logging is optional and can retain message content. Read the [privacy policy](PRIVACY.md) before enabling it. Pocket replies use their own source credit regardless of `ATTRIBUTION`

## Deployment

For unattended operation on an ARM64 Debian 12 host, follow the [deployment guide](docs/deployment.md). It covers systemd startup, versioned bundles, configuration transfer, persistent settings, updates, backups and rollback. Docker and Compose are an optional route in the same guide. Complete its acceptance checks on the target host

To run compiled code from a source checkout:

```sh
npm run build
npm start
```

Run from the repository root and keep the installed dependencies and `src/data/text-index.json` alongside `dist/`. The compiler does not copy that search index. Run one instance per bot token across all machines; the local `.bot.pid` check cannot detect a second host

## Development

The application checks run without Discord credentials:

```sh
npm run typecheck
npm test
npm run build
```

Use `npm run preview -- "Dragapult ex" "Charizard|sv03.5"` to inspect real card lookups without connecting to Discord. It writes embed JSON to the terminal and an HTML preview under `preview/`; live TCGdex lookups need network access

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and [docs/README.md](docs/README.md) for architecture, development tools and data maintenance. Report vulnerabilities through [SECURITY.md](SECURITY.md). The [Code of Conduct](CODE_OF_CONDUCT.md) applies to participation

## Data and limits

Physical card records, legality and prices come from [TCGdex](https://tcgdex.dev). Pocket records come from the installed [pokemon-tcg-pocket-cards](https://github.com/chase-mew/pokemon-tcg-pocket-cards) package. Wording search uses a checked-in index, which can lag new releases; [data maintenance](docs/data-maintenance.md) explains how to refresh it

Prices appear only when the source provides them. Paged lists expire after fifteen minutes and are cleared on restart. Default reply settings allow both card games and prefer the physical game for an ambiguous card name

## Troubleshooting

- No ordinary-message replies: check Message Content Intent, `MENTION_ENABLED`, server reply settings and the selected-channel list
- No replies in threads: grant Send Messages in Threads and check the parent channel's selection
- Missing or outdated slash commands: run `npm run register` with the intended guild or global scope
- Settings disappear after restart: configure a persistent `DATA_DIR` and check its write permissions
- A list has expired: run the command again to create a new one
- Another instance is already running: stop the existing copy before starting a replacement

Project code is [Apache-2.0](LICENSE). The Pocket dependency uses AGPL-3.0-or-later; card data and images have separate terms. Read the [third-party notices](docs/THIRD_PARTY_NOTICES.md) before redistributing a bundle or image

[Acknowledgements](docs/ACKNOWLEDGEMENTS.md) · [Terms of service](TERMS.md)
