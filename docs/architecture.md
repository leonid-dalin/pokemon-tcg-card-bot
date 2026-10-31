# Architecture

The bot runs as one Node.js process. [src/index.ts](../src/index.ts) loads configuration, creates the API client and page store, then connects the Discord client

## Request routing

Slash commands and component interactions enter through [src/discord/commands.ts](../src/discord/commands.ts). Command definitions live there too; [register.ts](../src/discord/register.ts) publishes them to Discord

[src/discord/messages.ts](../src/discord/messages.ts) handles ordinary messages when `MENTION_ENABLED` is on. It ignores bots, webhooks and system messages, then checks for a decklist, help, search or card mentions in that order. Decklists also require `DECKLIST_ENABLED`. [src/mentions.ts](../src/mentions.ts) parses the message syntax and excludes card mentions inside code

Message replies share a [MentionBudget](../src/cooldown.ts) per member and channel when the cooldown is enabled. Slash commands do not use that budget

## Card resolution

[src/lookup.ts](../src/lookup.ts) returns a `CardLookup` containing the selected card, alternate printings and source credit. The Discord handlers turn that result into a reply

For a name lookup:

1. An exact card ID in the set hint goes straight to `lookupById`
2. A Pocket alias selects the local Pocket package
3. Other set hints resolve through [src/set-index.ts](../src/set-index.ts). An unknown hint returns no match
4. The bot searches TCGdex by name, trying supported accent substitutions if the literal search is empty
5. Candidates rank by name score, image availability, then set recency. A resolved set hint restricts the candidates to that exact set
6. If no candidates remain, the bot tries the Pocket package
7. The selected TCGdex card loads with pricing fallback through French, German, Spanish, Italian and Portuguese records. The first record with displayable prices replaces the card response, including its other fields

`lookupById` tries TCGdex first, then the Pocket package. An unknown ID returns `undefined`; an upstream failure propagates when neither source supplies the card. A failed name-search request also propagates, so Pocket fallback does not cover every TCGdex outage

[src/resolve.ts](../src/resolve.ts) handles name comparison and scoring. Release-date ranking and set-hint resolution use [src/data/set-index.ts](../src/data/set-index.ts). [src/printed.ts](../src/printed.ts) formats IDs as printed set codes and card numbers

## Data sources

| Source | Adapter | Used for |
| --- | --- | --- |
| TCGdex HTTP API | [src/api/tcgdex.ts](../src/api/tcgdex.ts) | Card records, name searches, sets, legality and prices |
| Installed `pokemon-tcg-pocket-cards` data | [src/api/pocket.ts](../src/api/pocket.ts) | Local Pocket lookups and printings |
| Checked-in set metadata | [src/set-index.ts](../src/set-index.ts) | Set hints, release-date ranks and printed labels |
| Checked-in wording index | [src/text-search.ts](../src/text-search.ts) | Wording search, excerpts and printing-button comparisons |

[src/printings.ts](../src/printings.ts) combines same-name TCGdex and package printings. This is a separate path from selecting one card in `lookupCard`

## Search and rendering

Wording search reads [src/data/text-index.json](../src/data/text-index.json) locally. Unquoted queries use whole-word matching; an outer pair of supported quotes requests adjacent words. Card-name matches also qualify. Results group by normalised card name and use the newest matching printing as the representative

[src/discord/replies.ts](../src/discord/replies.ts) keeps results for the overall search and each category, then [src/discord/pages.ts](../src/discord/pages.ts) caps each displayed search view at 250 entries. Filter counts use the complete matching result set

[src/render.ts](../src/render.ts) builds embed descriptions independently of Discord builders. [src/discord/embeds.ts](../src/discord/embeds.ts) converts them to Discord embeds; the reply and page modules add buttons and menus

Printing buttons use alternates with the same normalised indexed wording. If the selected card has no wording-index entry, the comparison keeps all supplied alternates. This check uses the local index, so refreshing that file can change which buttons appear

## Interaction state

Page and filter controls change the original reply only for its owner. Opening a card from a list creates a new reply for the person who selects it. Details replies are ephemeral. Printing buttons check the owner ID when one is present in their custom ID

Handlers that fetch card records defer their interaction before the lookup. [src/discord/interaction-failure.ts](../src/discord/interaction-failure.ts) chooses an error response based on whether the interaction has already been acknowledged

## Caches and process lifetime

| Store | Default lifetime | Capacity |
| --- | --- | --- |
| TCGdex card records and name searches | 10 minutes | Shared API cache, 1,000 entries |
| TCGdex sets and card/set listings | 1 hour | Same API cache |
| Paged lists | 15 minutes from creation | 500 lists |
| Loaded Pocket data and wording index | Process lifetime | Loaded dataset |

TCGdex 404 responses use the same expiry as the requested endpoint. The client makes up to three attempts by default, with a ten-second timeout per attempt. It retries transport and JSON errors, HTTP 429 and server errors

All these stores are in memory. A restart clears paged lists and reloads data on demand. Reads do not extend page expiry, and capacity eviction can remove a list earlier

[src/single-instance.ts](../src/single-instance.ts) checks a `.bot.pid` file, kept in `DATA_DIR` when that is configured and in the working directory otherwise, against the local process table. Run one instance per bot token, including across separate checkouts or hosts
