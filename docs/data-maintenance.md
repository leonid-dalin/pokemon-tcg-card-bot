# Data maintenance

The bot uses three local datasets with different update paths. Run maintenance commands from the repository root after `npm ci`

| Data | Runtime reader | Update path |
| --- | --- | --- |
| [src/data/set-index.ts](../src/data/set-index.ts) | Set hints, ranking and printed labels | Review a fetched snapshot and edit the TypeScript entries |
| [src/data/text-index.json](../src/data/text-index.json) | Wording search and printing comparisons | `npm run index:text` |
| Installed Pocket package data | [src/api/pocket.ts](../src/api/pocket.ts) | Update the package and lockfile |

## Add or update a set

```sh
npm run index:sets
```

[scripts/build-set-index.ts](../scripts/build-set-index.ts) fetches TCGdex set summaries and details, then writes `src/data/set-index.json`. The bot imports `set-index.ts`; it does not read this JSON snapshot

The snapshot stores an upstream `abbreviation` field. Runtime entries use `code`, so replacing the TypeScript file with the JSON output would also lose that field mapping

1. Read the script's final counts and its number of failed detail requests. Failed details leave only an ID and name in the snapshot
2. Compare the snapshot with `src/data/set-index.ts`. Add or update the relevant `id`, `name`, `releaseDate` and `code` fields, mapping a verified `abbreviation` to `code`
3. Review removals and missing metadata individually. Preserve existing metadata when a failed fetch supplies no replacement
4. Check the changed set hint, printed label and ordering in [set-index.test.ts](../tests/set-index.test.ts) and [printed.test.ts](../tests/printed.test.ts)
5. Remove the temporary `src/data/set-index.json` after review and check `git status` before committing

The generator does not edit the runtime TypeScript index. A successful script run alone will not make a new physical set hint or printed code available to the bot. Build and restart the bot after changing the runtime entries

## Refresh searchable wording

```sh
npm run index:text
```

[scripts/build-text-index.ts](../scripts/build-text-index.ts) lists English TCGdex cards and fetches details in batches of six. It stores cards with non-empty effects, abilities or attacks, including named parts for excerpts and categories for filters

- A 404 skips that card
- A card with no indexed wording is omitted
- Any other card-fetch failure leaves the previous file unchanged and exits unsuccessfully
- A successful run replaces the file with entries sorted by card ID

Review the changed IDs and wording before committing. This index comes from TCGdex, so updating the Pocket dependency does not add package-only cards to wording search

The file also controls printing-button wording comparisons. Run the search and printing tests when refreshing it, then restart the running bot so it loads the new index

## Update Pocket cards

Update `pokemon-tcg-pocket-cards` to the intended version with npm, then commit both `package.json` and `package-lock.json`. Review the dependency's terms in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) if its version or distribution terms change

The adapter reads the package's `data/v5` layout and translates its records into the shared card types. Check that layout when upgrading. [pocket.test.ts](../tests/pocket.test.ts) covers package lookups; [card-id.test.ts](../tests/card-id.test.ts) covers recognition of exact IDs, including package sets absent from the set index

Check a new exact ID and a name lookup with the `pocket` hint. Package-only IDs can resolve without an entry in `set-index.ts`; printed physical set codes still depend on that index

Restart the bot after installing the updated package, because it caches the loaded records for the life of the process

## Validate an update

```sh
npm run typecheck
npm test
npm run build
git diff --check
```

Use [the preview command](development.md#preview-a-card) for a live card check when upstream access is available. Include the dataset changes and check results in the pull request
