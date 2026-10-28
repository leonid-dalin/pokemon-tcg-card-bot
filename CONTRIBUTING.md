# Contributing

## Before you start

Read the [Code of Conduct](CODE_OF_CONDUCT.md), the [Security Policy](SECURITY.md) and the [third-party notices](docs/THIRD_PARTY_NOTICES.md). The [contributor documentation](docs/README.md) covers the code structure, development workflow and data updates. Report vulnerabilities by email, never in a public issue

## Development setup

CI runs the Node version in `.nvmrc`. The bot needs a Discord application to run, but the test suite does not, so you can work on most of the code without one

```bash
npm ci
npm test        # offline
npm run typecheck
```

To run it against a real server, copy `.env.example` to `.env`, fill in the token and client id as described in the [README](README.md), then:

```bash
npm run doctor      # validates the token before anything touches the gateway
npm run register    # publishes /card, /printings, /set, /search and /help
npm run dev         # runs from source
```

In a service manager or a container, use `npm run build` then `npm start`

Two tools help when you change lookup behaviour. `npm run preview "Card name"` runs the real lookup and render path against the live APIs, prints the embed payload and writes a Discord-styled HTML page to `preview/`. `npm run index:sets` writes a JSON snapshot for review; follow [data maintenance](docs/data-maintenance.md#add-or-update-a-set) to update the runtime TypeScript index after a new set releases

## Changes

Keep a change focused, and keep the existing contracts: the lookup order of name score, then artwork, then release date; the footer credit that names the source which actually served the card; the set index as the only offline source of set codes and release dates

Add or update tests for anything behavioural. The suite runs offline by design, so a test that needs the network needs a stubbed `fetch` instead

Do not commit a token, `.env`, a local database, `node_modules`, `dist`, or anything under `preview`

## Pull requests

Open against `master` with a short summary, the checks you ran, relevant issue links, and any limitation or follow-up you know about. Keep commits small enough to review, and separate behaviour changes from documentation changes when a task contains both

Commit subjects follow Conventional Commits, for example `fix: pin a resolved set exactly`. Write them in EN-UK, imperative present tense, with no trailing period

## Review

Changes need review from the owners in [CODEOWNERS](.github/CODEOWNERS). Answer findings with a follow-up commit, so the reviewer can see what changed

## Licence

Contributions to this project's own code are accepted under the [Apache License 2.0](LICENSE). Third-party libraries, card data and images keep their own terms; check [THIRD_PARTY_NOTICES.md](docs/THIRD_PARTY_NOTICES.md) before adding a dependency or a data source
