# pokemon-card-bot

A Discord bot that shows a Pokémon TCG card. Two ways in:

- `/card name:Dragapult ex` for a slash command with autocomplete.
- `[[Dragapult ex]]` anywhere in a message, and the bot replies with the card. Pin a printing with `[[Dragapult ex|sv08.5]]`.

The reply carries the card art, set and number, regulation mark, rarity, attacks and abilities, weakness and retreat, format legality, Cardmarket and TCGplayer prices where the source has them, and the illustrator.

## Why this exists

Card Buddy is a well known Pokémon card bot, and its behaviour is the reference point: art first, then set and number, rules text, legality and both price sources, with a name that can be narrowed to one printing. This project rebuilds that information contract from its public command list and the open TCGdex API. No code, assets or data from Card Buddy are involved. See NOTICE.

The one thing added on top is the inline mention. Card Buddy needs a command, so a card mentioned mid-sentence gets no reply. `[[...]]` fixes that, which is what the Hearthstone bot d0nkeybot does with `[[card mentions]]`.

## Data source

[TCGdex](https://tcgdex.dev) serves the catalogue with no API key and no quota to manage. The bot reads:

- `GET /v2/en/cards?name=` for name search.
- `GET /v2/en/cards/{id}` for the card, its pricing and its legality.
- `GET /v2/en/sets/{id}` for the set, including `releaseDate`, which is how the newest printing wins when a name matches several.

Responses are cached in memory, ten minutes for cards and an hour for sets, so a busy channel does not hammer the API. Retries cover 429 and 5xx with exponential backoff, and every request carries a timeout.

## Setup

1. Create an application at <https://discord.com/developers/applications> (New Application, name it, Create).
2. **Application ID:** on **General Information**, the first page after creating the app, copy the field labelled **Application ID**.
3. **Bot token:** in the left sidebar open **Bot**, find the **Token** section and press **Reset Token**, then **Copy**. It is shown once; if you navigate away you have to reset it again.
4. Under **Bot → Privileged Gateway Intents**, enable **Message Content**. Without it the bot sees slash commands but never the `[[...]]` mentions. Leave it off and set `MENTION_ENABLED=false` if you only want the slash command.
5. Copy `.env.example` to `.env` and paste the two values into `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`. Set `DISCORD_GUILD_ID` while developing so commands appear instantly instead of within the hour.
6. Check the credentials before running anything:

```bash
yarn install
yarn doctor       # prints the bot name, or Discord's error if the token is wrong
```

7. Invite the bot with the `bot` and `applications.commands` scopes and this permissions integer:

```
277025475584
```

That is View Channels, Send Messages, Embed Links, Read Message History, Use Application Commands and Send Messages in Threads. The thread permission is easy to miss: without it a `[[card]]` mentioned inside a thread gets no reply, because the bot cannot post there.

8. Register the commands and run:

```bash
yarn register     # publish /card and /set
yarn dev          # run from source
```

If your npm config blocks install scripts, `esbuild` arrives without its platform binary. Approve it once with `npm approve-scripts esbuild` and reinstall.

The bot refuses to start twice: it writes `.bot.pid` and exits if that pid is still alive. Two instances sharing one token both answer every mention, which looks like one bot replying twice and leaves no error in either log. A pid file left by a hard kill is ignored, because the process behind it is gone.

`yarn dev` runs through `tsx`, which needs a real terminal. In a service manager, container or anything without a tty it exits with `stdin is not a tty`, so use `yarn build` then `yarn start` there.

For production, `yarn build` then `yarn start`.

## Profile picture

`assets/avatar.jpg` is a 512 by 512 crop of the image this instance asked for. Set it with:

```bash
yarn avatar assets/avatar.jpg
```

The script validates the file type and the 8 MB ceiling before it calls `PATCH /users/@me`, so a bad path fails locally instead of halfway through an upload.

## Checking a card without Discord

```bash
yarn preview "Dragapult ex" "Charizard|sv03.5" "Mega Kangaskhan ex"
```

That runs the real lookup and render path against the live API, prints the embed payload as JSON and writes a Discord-styled HTML preview to `preview/`. It is the fastest way to confirm a card, a set hint or the mention format before deploying.

## Tests

```bash
yarn test        # 47 tests over mention parsing, name resolution, rendering and the API client
yarn typecheck
```

The suite runs offline. The API client tests stub `fetch`, and the render tests use two recorded cards in `tests/fixtures/`, so a TCGdex outage or a reprint does not break CI.

## Behaviour worth knowing

- **Printings with art win.** When a name matches several printings, the bot prefers one that has a scan, then keeps the source order. A few printings have no scan in TCGdex, and an embed without art is a poor answer. A card with other printings carries an **Other printings** field listing them, with the `[[name|setId]]` syntax to reach an exact one, because the source order does not always start with the printing you want. It stays one embed per mention, since two embeds read as two answers to one question.
- **Names are folded.** Case, accents, curly apostrophes and spacing are normalised, so `pokemon catcher`, `Pokémon Catcher` and `Boss’s Orders` all resolve.
- **Code is ignored.** `[[...]]` inside backticks or a fenced block does not trigger a reply, so you can document the syntax in the same channel.
- **One reply per message.** Up to three mentions per message and five embeds per reply, with a 30 second cooldown per member per channel by default (`MENTION_COOLDOWN_SECONDS`). The cooldown is keyed per member on purpose: a channel-wide budget lets one person's mention swallow everyone else's for the rest of the window.
- **Missing scans are labelled.** A few promos have no scan in the source; the embed says so instead of posting a bare embed with no art.

## Limits

- TCGplayer pricing is sparse in TCGdex. Cardmarket is populated for nearly everything, so most embeds show one price source rather than two.
- A name that matches nothing stays silent rather than posting an error, which keeps typos from turning into noise. The slash command does answer with a miss message.

## Licence

Apache License 2.0, see LICENSE. The avatar images are excluded, see NOTICE.
