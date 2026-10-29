# Development

Use the Node.js version in [.nvmrc](../.nvmrc) to match CI. Run commands from the repository root

## Work without Discord credentials

Install the locked dependencies and run the same checks as [.github/workflows/ci.yml](../.github/workflows/ci.yml):

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Installation needs access to npm. The checks run offline and do not need a bot token

To run one test file:

```sh
npm test -- tests/lookup.test.ts
```

The source uses TypeScript with `.js` import specifiers. Keep that convention so the same imports work after compilation

## Choose a test for the change

| Change | Starting points |
| --- | --- |
| API caching, retries or card resolution | [lookup.test.ts](../tests/lookup.test.ts), [card-id.test.ts](../tests/card-id.test.ts), [accents.test.ts](../tests/accents.test.ts) |
| Names, set hints or printed numbers | [resolve.test.ts](../tests/resolve.test.ts), [set-index.test.ts](../tests/set-index.test.ts), [printed.test.ts](../tests/printed.test.ts) |
| Wording matching or excerpts | [text-search.test.ts](../tests/text-search.test.ts), [whole-word.test.ts](../tests/whole-word.test.ts), [phrase-search.test.ts](../tests/phrase-search.test.ts) |
| Card embeds or pricing | [render.test.ts](../tests/render.test.ts), [render-pricing.test.ts](../tests/render-pricing.test.ts) |
| Menus, buttons or acknowledgement order | [page-handlers.test.ts](../tests/page-handlers.test.ts), [printing-swap.test.ts](../tests/printing-swap.test.ts), [interaction-defer.test.ts](../tests/interaction-defer.test.ts) |
| Message routing or pasted decks | [messages.test.ts](../tests/messages.test.ts), [deck-resolve.test.ts](../tests/deck-resolve.test.ts) |

Use fixtures or stub `fetch` for API cases; [lookup.test.ts](../tests/lookup.test.ts) has examples. Check the externally visible result or request sequence, including failure paths. Tests that replace globals must restore them after the case

## Preview a card

```sh
npm run preview -- "Dragapult ex" "Charizard|sv03.5"
```

The [preview script](../scripts/preview.ts) prints embed JSON and writes HTML under `preview/`. It runs the lookup and embed-rendering path without connecting to Discord. TCGdex lookups need network access; the HTML shows card embeds but does not exercise interactive controls

Keep preview output out of commits. Use the Discord development bot to check buttons, menus and permissions

## Run a development bot

Follow the [setup guide](setup.md) to create and invite a Discord application. Copy `.env.example` to `.env`, set the token and client ID, and set `DISCORD_GUILD_ID` to your test server

```sh
npm run doctor
npm run register
npm run dev
```

`register` replaces this application's command definitions in the configured guild, or globally when `DISCORD_GUILD_ID` is unset. Run it again after changing slash-command names or options. It publishes `/card`, `/printings`, `/set`, `/search`, `/help` and `/settings`

`/settings` is guild-only and restricted to members with the Manage Server permission, both in the command definition and in the handler. Its `view` subcommand also reports deployment-wide switches such as `MENTION_ENABLED=false`. The environment values remain the defaults for servers that have not changed anything

Enable Message Content in the developer portal for ordinary-message replies. See the [configuration reference](configuration.md) for the switches that control mentions, decklists and throttling

## Run the compiled bot

```sh
npm run build
npm start
```

`npm start` runs `dist/src/index.js`. Keep `src/data/text-index.json` in the deployment alongside `dist/`, the installed dependencies and runtime configuration. The compiler does not copy that JSON file; compiled search code falls back to the source path

Use the repository root as the working directory so `.env` and `.bot.pid` resolve as expected. Stop the current instance before starting another with the same token. A restart also clears existing paged lists

See [data maintenance](data-maintenance.md) when a change needs refreshed set metadata or card wording
