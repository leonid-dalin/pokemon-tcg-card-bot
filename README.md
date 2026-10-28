# Pokémon TCG card bot

A Discord bot for Pokémon TCG and Pokémon TCG Pocket cards, answered from a slash command or a `[[card]]` mention in any message

## What it answers

| You type | The bot replies with |
| --- | --- |
| `/card name:<name> [set:<hint>]` | The card front, with name autocomplete and an optional set hint |
| `/printings name:<name>` | Every printing of that name, newest first, ten to a page |
| `/set id:<set id>` | The set: card count, series and release date |
| `/set id:<set id> checklist:true` | Every card in the set, fifteen to a page |
| `/search text:<words>` | Cards whose ability, attack or Trainer text contains every word, five to a page |
| `/help` | What the bot can do |
| `@bot` or `@bot help` | The same help card from the message box |
| `@bot search <words>` | The same search from the message box, which is easier on a phone |
| `[[Card name]]` | The card, from any message. Up to three per message |
| `[[Card name\|hint]]` | One printing. The hint can be a set id (`sv07`), a printed code (`SCR`) or a set name (`Stellar Crown`) |
| `[[Card name\|sv08.5-073]]` | The exact printing with that card id |
| `[[Card name\|pocket]]` | The Pocket version. `ptcgp` and `tcgp` work as well |
| `[[!Card name]]` | The scan alone, with no fields and no buttons |
| A pasted decklist | The list, counted against 60, with cards that are not Standard legal and a Cardmarket price where the card data and prices are available. Off unless `DECKLIST_ENABLED=true` |

A card reply shows the front first: the name linked to its scan, then HP, type, stage, what it evolves from and how many prizes it gives up, then the wording of Trainers and Energy, one field per ability and per attack with the cost as energy tokens, and weakness, resistance and retreat. Everything printed on the card but not played with sits behind the `Details` button, which answers only whoever presses it: the set and release date, rarity, illustrator, format legality, prices and the other printings. Card ids are written the way players write them, so `me04-048` reads `CRI 48` and a Pocket card reads `B4B 133`.

Names match regardless of case, accents, apostrophes and spacing, so `pokemon catcher` finds Pokémon Catcher. Printing buttons swap the card in place, and only the person who asked for the reply may press them. A name that matches nothing gets `No card matched`, and in most paths a menu of the closest names: a one-word miss and `/card` resolve without suggestions. `[[...]]` inside backticks or a code block is ignored, so you can explain the syntax in the same channel

## Requirements

- Node.js 24 or newer (the settings store uses the built-in `node:sqlite`); CI runs the version in `.nvmrc`
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
   npm run register        # publishes /card, /printings, /set, /search and /help
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
| `DECKLIST_ENABLED` | `false` | Formats pasted decklists, flags cards that are not Standard legal and prices the deck |
| `MENTION_COOLDOWN_SECONDS` | `0` (`30` in `.env.example`) | Per-member throttle. Each member gets a burst of three replies, then one more every this many seconds. `0` turns it off |
| `ATTRIBUTION` | `Card data from TCGdex` | Footer credit on every embed. Pocket cards always credit their own source |
| `ENERGY_EMOJI` | `{}` | JSON object of energy type to emoji markup, used in attack costs. The owner uploads the icons as application emoji |

The throttle counts every reply to a message, whether it answers a mention, a search or a decklist. It is kept per member and per channel, so one person cannot use up anyone else's replies. The bot never pings anyone: replies carry no user, role or `@everyone` mentions

Paged lists keep their place in memory for fifteen minutes, so the age of an old reply shows up as `This list has expired. Run the command again.`

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
| `npm run index:sets` | Fetches `src/data/set-index.json` for review; update the runtime TypeScript index as described in [data maintenance](docs/data-maintenance.md#add-or-update-a-set) |
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

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. The [contributor documentation](docs/README.md) covers architecture, development and data maintenance. Report vulnerabilities by email as described in [SECURITY.md](SECURITY.md), never in a public issue. Participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md)

## Licence

This project's code is licensed under the Apache License 2.0, see [LICENSE](LICENSE). Card data, the Pocket package and the avatar image keep their own terms, see [THIRD_PARTY_NOTICES.md](docs/THIRD_PARTY_NOTICES.md). The Pocket package is AGPL-3.0-or-later, so read the notices before you redistribute a build that includes `node_modules`. Credit for the ideas this bot borrows sits in [ACKNOWLEDGEMENTS.md](docs/ACKNOWLEDGEMENTS.md), and the [privacy policy](PRIVACY.md) and [terms of service](TERMS.md) cover what using it means
