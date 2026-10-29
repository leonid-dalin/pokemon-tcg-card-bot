# Data maintenance

The bot uses three local datasets with different update paths. Run maintenance commands from the repository root after `npm ci`

| Data | Runtime reader | Update path |
| --- | --- | --- |
| [src/data/set-index.ts](../src/data/set-index.ts) | Set hints, ranking and printed labels | `npm run index:sets` |
| [src/data/text-index.json](../src/data/text-index.json) | Wording search and printing comparisons | `npm run index:text` |
| Installed Pocket package data | [src/api/pocket.ts](../src/api/pocket.ts) | Update the package and lockfile |

Both generators are also available as the operator-triggered `Refresh card data` workflow. It generates the datasets and opens a pull request with the result, leaving the merge to a reviewer. Review the counts and hashes in `src/data/data-manifest.json` before merging

## Add or update a set

```sh
npm run index:sets
```

[scripts/build-set-index.ts](../scripts/build-set-index.ts) fetches TCGdex set summaries and details and rewrites [src/data/set-index.ts](../src/data/set-index.ts), which is the file the bot imports. Upstream supplies `abbreviation`; the runtime field is `code`, and the generator maps between them

- Entries are sorted by release date and then by id, so regenerating an unchanged source produces identical bytes
- A code or release date already in the file survives a detail response that omits it, and the run prints every field it changed
- A failed detail request or an empty upstream list leaves the runtime file untouched and exits unsuccessfully
- The write goes through a temporary file and a rename, so an interrupted run cannot truncate the dataset

Review the printed changes before committing. Build and restart the bot after a successful run, because the index is compiled into `dist/`

## Refresh searchable wording

```sh
npm run index:text
```

[scripts/build-text-index.ts](../scripts/build-text-index.ts) lists English TCGdex cards and fetches details in batches of six. It stores cards with non-empty effects, abilities or attacks, including named parts for excerpts and categories for filters

- A 404 skips that card
- A card with no indexed wording is omitted
- Any other card-fetch failure leaves the previous file unchanged and exits unsuccessfully
- A successful run replaces the file atomically with entries sorted by card ID

Review the changed IDs and wording before committing. This index comes from TCGdex, so updating the Pocket dependency does not add package-only cards to wording search

The file also controls printing-button wording comparisons. Run the search and printing tests when refreshing it, then restart the running bot so it loads the new index

## Check the generated data manifest

`src/data/data-manifest.json` records the source, the record count, the SHA-256 of the generated file and when it was produced, for every dataset a generator writes. Confirm that each entry's count and hash match the file it names; a mismatch means the generator and the committed dataset disagree

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

Generators run against the live TCGdex API, so tests never call it. [data-pipeline.test.ts](../tests/data-pipeline.test.ts) covers the merge, ordering, atomic write and manifest behaviour with fixtures, and [generator-pipeline.test.ts](../tests/generator-pipeline.test.ts) covers the generator decisions: empty and all-404 runs refuse to publish, one 404 skips a single card, and the changed-field report names only fields that moved. Use [the preview command](development.md#preview-a-card) for a live card check when upstream access is available. Include the dataset changes and check results in the pull request
