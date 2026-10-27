# Third-party notices

This project's own code is licensed under the Apache License 2.0, see [LICENSE](LICENSE). The material below keeps its own terms, and those terms govern that material

## Runtime dependencies

discord.js is licensed under Apache-2.0 and is used for the gateway connection, slash commands and embeds

pokemon-tcg-pocket-cards by PocketDecks is licensed under AGPL-3.0-or-later. It supplies every Pokémon TCG Pocket card. The bot reads its data files at runtime, so no card data is copied into this repository. Worth knowing before you redistribute anything:

- The package ships data, not code: 424 JSON files and type declarations, with no runtime JavaScript. This repository depends on it through `package.json` and `yarn.lock`, so anyone installing the project fetches it themselves and this repository distributes none of it.
- The package stays a separate work with its own licence. This repository's Apache 2.0 grant does not extend to it, and cannot. Depend on it and your own code stays Apache 2.0.
- Do not vendor the JSON into this repository. Copying the files in would make this repository a distributor of AGPL material, and that is the case where the copyleft obligations attach to the copy.
- If you ship a container or an archive that includes `node_modules`, that artefact redistributes the package. Include its licence and a pointer to its source alongside your own.
- If you need a distribution with no copyleft obligation at all, remove the dependency and the Pocket path in `src/api/pocket.ts`.

Card data served by that package, including images, remains the property of its rights holders

## Card data

TCGdex supplies the physical card catalogue: names, sets, numbers, rules text, legality and prices, along with the set release dates and codes that `src/data/set-index.ts` is built from. TCGdex publishes its own terms, and its data is redistributed here under them

Cardmarket and TCGplayer prices reach the bot through TCGdex. They are third-party marketplace figures and are shown with the source and date the API reports

## The profile picture

`assets/avatar.jpg` and `assets/avatar-source.jpg` are a Pokémon Center product photograph of the Crustle plush. They are not covered by Apache 2.0 and should be replaced before redistributing this project. The image was supplied by the operator of this instance for use as the bot's avatar

## Code of Conduct

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) is adapted from the Contributor Covenant, version 3.0, which is licensed under CC BY-SA 4.0. That file keeps its own licence and its attribution section

## Development dependencies

TypeScript is licensed under Apache-2.0. Vitest and tsx are licensed under MIT. None of them ship in the built output

## Trademarks

Pokémon and Pokémon TCG are trademarks of Nintendo, Creatures Inc. and GAME FREAK inc. Pokémon TCG Pocket is published by The Pokémon Company. Discord is a trademark of Discord Inc

This project is not affiliated with, endorsed by or sponsored by any of those companies. It reads public card data and posts images that its data sources serve
