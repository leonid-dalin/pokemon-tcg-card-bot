# pokemon-card-bot

A Discord bot that shows a Pokémon TCG card. Two ways in:

- `/card name:Dragapult ex` for a slash command with autocomplete.
- `[[Dragapult ex]]` anywhere in a message, and the bot replies with the card. Pin a printing with `[[Dragapult ex|sv08.5]]`.

The reply carries the card art, set and number, regulation mark, rarity, attacks and abilities, weakness and retreat, format legality, Cardmarket and TCGplayer prices where the source has them, and the illustrator

## Commands

| Command | What it does |
| --- | --- |
| `/card name:<text> [set:<hint>]` | Shows a card with autocomplete on the name and an optional set hint |
| `/set id:<setId>` | Shows a set with its card count, series and release date |
| `/search text:<wording>` | Finds cards whose abilities or attacks contain that wording |
| `[[Card name]]` | Replies with the card from any message |
| `[[Card name\|hint]]` | Same, with a set id, printed code or set name pinning one printing |
| `[[Card name\|pocket]]` | Restricts the lookup to Pokémon TCG Pocket |
| `[[Card name\|sv08.5-073]]` | Pins one exact printing by card id |
| a pasted decklist | Replies with the list formatted and the count checked against 60 |

## Why this exists

Card Buddy is a well known Pokémon card bot, and its behaviour is the reference point: art first, then set and number, rules text, legality and both price sources, with a name that can be narrowed to one printing. This project rebuilds that information contract from its public command list and open card data. No code, assets or data from Card Buddy are involved. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

The one thing added on top is the inline mention. Card Buddy needs a command, so a card mentioned mid-sentence gets no reply. `[[...]]` fixes that, which is what the Hearthstone bot d0nkeybot does with `[[card mentions]]`

## Data sources

Physical cards come from [TCGdex](https://tcgdex.dev), which needs no API key and has no quota to manage

Pokémon TCG Pocket cards come from the PocketDecks [`pokemon-tcg-pocket-cards`](https://github.com/chase-mew/pokemon-tcg-pocket-cards) package: 4,317 cards across 23 expansions. It is a dependency, so the data arrives with `npm ci` and needs no network at runtime. TCGdex's Pocket catalogue stops before Deluxe Pack: Mega, which is why a card like Crustle ex is missing there entirely; the package has it, including its alternate printings. That package is AGPL-3.0, so read [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before you redistribute anything

A lookup tries TCGdex first and falls back to Pocket data when nothing matches, so `[[Crustle ex]]` and `[[Crustle ex|ptcgp]]` both resolve to `b4b-133`. The bot reads:

- `GET /v2/en/cards?name=` for name search.
- `GET /v2/en/cards/{id}` for the card, its pricing and its legality.
- `GET /v2/en/sets/{id}` for the set, including `releaseDate`, which is how the newest printing wins when a name matches several.

Responses are cached in memory, ten minutes for cards and an hour for sets, so a busy channel does not hammer the API. Retries cover 429 and 5xx with exponential backoff, and every request carries a timeout

## Setup

1. Create an application at <https://discord.com/developers/applications> (New Application, name it, Create).
2. **Application ID:** on **General Information**, the first page after creating the app, copy the field labelled **Application ID**.
3. **Bot token:** in the left sidebar open **Bot**, find the **Token** section and press **Reset Token**, then **Copy**. It is shown once; if you navigate away you have to reset it again.
4. Under **Bot → Privileged Gateway Intents**, enable **Message Content**. Without it the bot sees slash commands but never the `[[...]]` mentions. Leave it off and set `MENTION_ENABLED=false` if you only want the slash command.
5. Copy `.env.example` to `.env` and paste the two values into `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`. Set `DISCORD_GUILD_ID` while developing; guild commands appear at once, global ones take up to an hour.
6. Check the credentials before running anything:

```bash
npm ci
npm run doctor       # prints the bot name, or Discord's error if the token is wrong
```

7. Invite the bot with the `bot` and `applications.commands` scopes and this permissions integer:

```
277025475584
```

That is View Channels, Send Messages, Embed Links, Read Message History, Use Application Commands and Send Messages in Threads. The thread permission is easy to miss: without it a `[[card]]` mentioned inside a thread gets no reply, because the bot cannot post there

8. Register the commands and run:

```bash
npm run register     # publish /card and /set
npm run dev          # run from source
```

If your npm config blocks install scripts, `esbuild` arrives without its platform binary. Approve it once with `npm approve-scripts esbuild` and reinstall

The bot refuses to start twice: it writes `.bot.pid` and exits if that pid is still alive. Two instances sharing one token both answer every mention, which looks like one bot replying twice and leaves no error in either log. A pid file left by a hard kill is ignored, because the process behind it is gone

`npm run dev` runs through `tsx`, which needs a real terminal. In a service manager, container or anything without a tty it exits with `stdin is not a tty`, so use `npm run build` then `npm start` there

For production, `npm run build` then `npm start`

## Profile picture

`assets/avatar.jpg` is a 512 by 512 crop of the image this instance asked for. Set it with:

```bash
npm run avatar assets/avatar.jpg
```

The script validates the file type and the 8 MB ceiling before it calls `PATCH /users/@me`, so a bad path fails on your machine before any upload starts

## Checking a card without Discord

```bash
npm run preview "Dragapult ex" "Charizard|sv03.5" "Mega Kangaskhan ex"
```

That runs the real lookup and render path against the live API, prints the embed payload as JSON and writes a Discord-styled HTML preview to `preview/`. It is the fastest way to confirm a card, a set hint or the mention format before deploying

## Tests

```bash
npm test        # 85 tests over mention and decklist parsing, name resolution, set indexing, buttons, rendering and both data sources
npm run typecheck
```

CI runs the typecheck, the suite and a build on every push and pull request, on the Node version in `.nvmrc`. The suite runs offline. The API client tests stub `fetch`, and the render tests use two recorded cards in `tests/fixtures/`, so a TCGdex outage or a reprint does not break CI. Pocket lookups read the bundled package, so they need no network either

## Behaviour worth knowing

- Name score decides the printing first, then artwork, then the newest set by real release date. A plain `[[Lapras]]` gives the newest Lapras, not whichever one the API lists first. Release dates and codes live in `src/data/set-index.ts`, built by `npm run index:sets`; rerun it when a set releases. A card with other printings carries an Other printings field listing them, with the `[[name|setId]]` syntax to reach an exact one. It stays one embed per mention, since two embeds read as two answers to one question.
- Case, accents, apostrophes and spacing are normalised, so `pokemon catcher`, `Pokémon Catcher` and `Boss's Orders` all resolve.
- `[[...]]` inside backticks or a fenced block does not trigger a reply, so you can document the syntax in the same channel.
- Card ids work as hints, so the ids shown in the Other printings field can be pasted straight back.
- Printings appear as buttons under the card. Pressing one swaps the embed for that printing.
- Prices come from English listings first. When the English record carries none, the bot tries the other languages TCGdex serves, in order, and uses the first with a figure. TCGdex has no Japanese route, so the chain skips from English to the rest. Cardmarket's one, seven and thirty day averages appear as a trend line when the source reports them.
- One reply covers up to three mentions per message and five embeds, with the throttle off by default (`MENTION_COOLDOWN_SECONDS=0`). Set it to a number of seconds to turn on a per-member token bucket: a burst of three mentions, then one more per interval. It is keyed per member, so one person can never swallow another's mention, and a burst matters because testing several cards in a row is normal.
- A few promos have no scan in the source, and the embed says so, so a card with no art never looks broken.

## Limits

- TCGplayer pricing is sparse in TCGdex. Cardmarket covers nearly everything, so most embeds carry one price source.
- A name that matches nothing gets a short `No card matched` reply with the closest names, because a mention is an explicit request and silence reads as a broken bot. Plain text without brackets is still ignored, which keeps ordinary conversation quiet.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report vulnerabilities by email as described in [SECURITY.md](SECURITY.md), never in a public issue. Participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md)

## Licence

This project's own code is licensed under the Apache License 2.0, see [LICENSE](LICENSE). Card data, the Pocket package and the avatar image keep their own terms, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
