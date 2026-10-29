<h1 align="center">Pokémon TCG card bot</h1>

<p align="center">A Discord bot that looks up Pokémon TCG and Pokémon TCG Pocket cards</p>

<p align="center">
<a href="https://github.com/leonid-dalin/pokemon-tcg-card-bot/actions/workflows/ci.yml"><img src="https://github.com/leonid-dalin/pokemon-tcg-card-bot/actions/workflows/ci.yml/badge.svg?branch=master" alt="CI on master"></a>
</p>

<p align="center">
<a href="https://discord.com/oauth2/authorize?client_id=1564749707740192818&scope=bot+applications.commands&permissions=4503876652887104"><strong>Add to Discord</strong></a> · <a href="docs/usage.md">Use the bot</a> · <a href="docs/setup.md">Host your own</a> · <a href="docs/development.md">Develop</a>
</p>

## Card lookup

In a server with the bot installed, send:

```text
[[Dragapult ex]]
```

The reply shows the card scan and rules text, including attacks, abilities and energy costs. Printing buttons switch between versions; `Details` opens set information, legality and available prices in a private reply

Use `/card name:Dragapult ex` for the same lookup through a slash command. Add `|pocket` inside the brackets to select Pokémon TCG Pocket, for example `[[Charizard ex|pocket]]`

## Find the card you need

| Task | Start with |
| --- | --- |
| Compare versions of a card | `/printings name:Dragapult ex` |
| Browse a set | `/set id:sv08.5 checklist:true` |
| Find cards with a phrase in their wording | `/search text:"search your deck"` |
| Choose reply channels or a preferred card game | `/settings` with Manage Server permission |

Pasted decklists can show card counts, Standard legality and available Cardmarket prices when a server administrator enables decklist replies. The [usage guide](docs/usage.md) explains the commands, printing hints and reply controls

## Host your own

You can host a separate instance with your own Discord application. The source checkout needs Node.js 24 or newer. Automatic replies to ordinary messages need Discord's Message Content Intent; slash-command-only operation is supported

Follow [setup](docs/setup.md) for the first login and command registration. For a host that should run continuously, use the [deployment guide](docs/deployment.md): native systemd is the main route, with Docker and Compose also available. Published bundles target Linux ARM64 on Debian 12

## Documentation

| You want to... | Guide |
| --- | --- |
| Use card lookups, wording search and lists | [Using the bot](docs/usage.md) |
| Change replies for your Discord server | [Server settings](docs/server-settings.md) |
| Set up a bot application and run from source | [Setup](docs/setup.md) |
| Configure persistence, logging or deployment defaults | [Configuration](docs/configuration.md) |
| Develop, test or maintain card data | [Developer documentation](docs/README.md) |

Physical card records come from [TCGdex](https://tcgdex.dev); Pocket records come from [pokemon-tcg-pocket-cards](https://github.com/chase-mew/pokemon-tcg-pocket-cards). Prices depend on the source, and the local wording index can lag new card releases

Project code is [Apache-2.0](LICENSE). The Pocket dependency uses AGPL-3.0-or-later; card data and images have separate terms. Read the [third-party notices](docs/THIRD_PARTY_NOTICES.md) before redistributing a build

[Contribute](CONTRIBUTING.md) · [Security](SECURITY.md) · [Privacy](PRIVACY.md) · [Terms](TERMS.md) · [Acknowledgements](docs/ACKNOWLEDGEMENTS.md)
