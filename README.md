# Pokémon TCG card bot

A Discord bot for Pokémon TCG and Pokémon TCG Pocket cards, answered from a slash command or a `[[card]]` mention in any message

## What it answers

| You type | The bot replies with |
| --- | --- |
| `/card name:<name> [set:<hint>]` | The card, with name autocomplete and an optional set hint |
| `/set id:<set id>` | The set: card count, series and release date |
| `/search text:<words>` | Up to 15 cards whose ability, attack or Trainer text contains every word |
| `@bot search <words>` | The same search from the message box, which is easier on a phone |
| `[[Card name]]` | The card, from any message. Up to three per message |
| `[[Card name\|hint]]` | One printing. The hint can be a set id (`sv07`), a printed code (`SCR`) or a set name (`Stellar Crown`) |
| `[[Card name\|sv08.5-073]]` | The exact printing with that card id |
| `[[Card name\|pocket]]` | The Pocket version. `ptcgp` and `tcgp` work as well |
| A pasted decklist | The list, formatted and counted against 60. Off unless `DECKLIST_ENABLED=true` |

A card reply shows the art, set and number, regulation mark, rarity, rules text, attacks and abilities, weakness and retreat, format legality, prices and the illustrator. Names match regardless of case, accents, apostrophes and spacing, so `pokemon catcher` finds Pokémon Catcher. A card with other printings lists their ids, and you can paste one back as a hint. When the reply shows a single card, those printings also appear as buttons, and pressing one swaps the card in place. A name that matches nothing gets `No card matched` and the closest names. `[[...]]` inside backticks or a code block is ignored, so you can explain the syntax in the same channel

## Requirements

- Node.js 22.12 or newer; the test and build tooling needs at least that. CI runs the version in `.nvmrc`
- A Discord application with a bot user
- Network access to `api.tcgdex.net`. Pocket cards come from an npm package and need no network

## Quick start

1. Create an application at <https://discord.com/developers/applications>. Copy the Application ID from General Information, then open Bot and press Reset Token to get the token. Discord shows the token once
2. On the Bot page, under Privileged Gateway Intents, turn on Message Content. Without it only the slash commands work
3. Install, configure and check the credentials:

   ```bash
   npm ci
   cp .env.example .env    # then fill in DISCORD_TOKEN and DISCORD_CLIENT_ID
   npm run doctor          # prints the bot's name, its servers and its registered commands
   ```

4. Invite the bot with the `bot` and `applications.commands` scopes and permissions integer `277025475584`. That is View Channels, Send Messages, Send Messages in Threads, Embed Links, Read Message History and Use Application Commands. Without the thread permission it cannot answer inside threads
5. Register the slash commands, then start the bot:

   ```bash
   npm run register        # publishes /card, /set and /search
   npm run dev             # runs from source
   ```

Set `DISCORD_GUILD_ID` while you develop, so the commands are registered to that one server and appear there at once

## Configuration

The bot reads these from the environment or from `.env`. `.env.example` lists them all

| Variable | Default | What it does |
| --- | --- | --- |
| `DISCORD_TOKEN` | required | The bot token |
| `DISCORD_CLIENT_ID` | required | The Application ID |
| `DISCORD_GUILD_ID` | unset | Registers the slash commands in this server only. Unset, they are registered globally |
| `MENTION_ENABLED` | `true` | Answers `[[...]]` mentions, `@bot search` and decklists. Needs the Message Content intent |
| `DECKLIST_ENABLED` | `false` | Formats pasted decklists |
| `MENTION_COOLDOWN_SECONDS` | `0` (`30` in `.env.example`) | Per-member throttle. Each member gets a burst of three replies, then one more every this many seconds. `0` turns it off |
| `ATTRIBUTION` | `Card data from TCGdex` | Footer credit on every embed. Pocket cards always credit their own source |

The throttle counts every reply to a message, whether it answers a mention, a search or a decklist. It is kept per member and per channel, so one person cannot use up anyone else's replies. The bot never pings anyone: replies carry no user, role or `@everyone` mentions

## Running in production

```bash
npm ci
npm run build
npm start
```

Run one copy per token. The bot writes `.bot.pid` and refuses to start while the process named there is alive, because two copies would both answer every message

## Scripts

| Command | What it does |
| --- | --- |
| `npm run doctor` | Checks the token and lists servers and registered commands |
| `npm run register` | Publishes the slash commands |
| `npm run dev` | Runs from source with `tsx` |
| `npm run build`, `npm start` | Compiles to `dist/` and runs the compiled bot |
| `npm run preview "Dragapult ex" "Charizard\|sv03.5"` | Runs real lookups without Discord, prints the embed JSON and writes an HTML preview to `preview/` |
| `npm run avatar assets/avatar.jpg` | Sets the bot's profile picture. PNG, JPEG, WebP or GIF, under 8 MB |
| `npm run rename "Name"` | Renames the bot. Discord allows two changes an hour |
| `npm run index:sets` | Rebuilds `src/data/set-index.ts` (220 sets) after a set releases |
| `npm run index:text` | Rebuilds the search index in `src/data/text-index.json`. Several minutes of requests; it keeps the old index if any card fails to load |
| `npm test`, `npm run typecheck` | The test suite and the type check. Both run offline |

## How lookups work

Physical cards come from [TCGdex](https://tcgdex.dev), which needs no API key. The bot calls:

- `GET /v2/en/cards?name=` to find printings by name
- `GET /v2/en/cards/{id}` for the card, its prices and its legality
- `GET /v2/{fr,de,es,it,pt}/cards/{id}` when the English record has no prices. The first language with a figure wins
- `GET /v2/en/sets` and `GET /v2/en/sets/{id}` for `/set` and its autocomplete

When several printings match, the closest name wins, then a printing with a scan, then the newest set. Release dates and set codes come from `src/data/set-index.ts`, so ranking needs no extra requests. Search reads `src/data/text-index.json`, a local index of about 23,000 cards, because TCGdex only searches Trainer text itself. Prices show Cardmarket's one, seven and thirty day averages when TCGdex has them, and a promo with no scan says so in the embed

Pocket cards come from the [`pokemon-tcg-pocket-cards`](https://github.com/chase-mew/pokemon-tcg-pocket-cards) package: 4,317 printings across 24 sets. TCGdex's Pocket catalogue stops earlier, so a name TCGdex does not know falls back to the package. Both `[[Crustle ex]]` and `[[Crustle ex|pocket]]` answer with `b4b-133`

Responses are cached in memory, ten minutes for cards and an hour for sets, up to 1,000 responses. A card TCGdex does not have is remembered for the same ten minutes. Rate limits and server errors are retried with backoff, and every request has a timeout

## Troubleshooting

- The bot answers slash commands but ignores `[[...]]`: turn on the Message Content intent, then restart. The bot logs a warning when it receives a message with its text stripped
- No reply inside a thread: the invite is missing Send Messages in Threads
- `npm ci` warns about `esbuild` install scripts: run `npm approve-scripts esbuild`, then `npm ci` again
- `another instance is already running`: stop the other copy. A pid file left by a crash is ignored once its process is gone
- Prices show only Cardmarket: TCGdex has little TCGplayer data, so most cards carry one source

## Background

The reply carries what Card Buddy, a well-known Pokémon card bot, shows: art first, then set and number, rules text, legality and both price sources. No code, assets or data from Card Buddy are used. The inline `[[card]]` syntax comes from Hearthstone bots such as d0nkeybot, so a card mentioned mid-sentence gets an answer without a command

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report vulnerabilities by email as described in [SECURITY.md](SECURITY.md), never in a public issue. Participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md)

## Licence

This project's code is licensed under the Apache License 2.0, see [LICENSE](LICENSE). Card data, the Pocket package and the avatar image keep their own terms, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The Pocket package is AGPL-3.0, so read the notices before you redistribute a build that includes `node_modules`
