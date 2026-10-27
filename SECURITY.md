# Security policy

## Reporting a vulnerability

Email **infoleonid@protonmail.com** with the details. Do not open a public issue for a vulnerability, and do not post the steps to reproduce in a Discord server while a fix is pending

A useful report says what an attacker can do, which version is affected, and the shortest sequence that shows it. A proof of concept helps and so does a suggested fix

You will get an acknowledgement within a few days. If the report holds up, expect a fix and a coordinated disclosure date; if it does not, expect a short explanation of why

## Supported versions

Only the current `main` branch receives fixes. There are no maintained release branches, so a fix lands on `main` and you redeploy

## What counts as a vulnerability

The bot holds one credential, the Discord bot token, and it talks to two data sources. Reports in these areas are in scope:

- A path that leaks the token, the contents of `.env`, or the bot's pid file into a log, an error message, an embed or a command reply.
- A way for a Discord user to make the bot read or write files outside the project directory, or to exhaust memory by sending crafted mention text.
- A crash or hang reachable from a normal message, including a pathological `[[...]]` payload.
- A dependency with a known vulnerability that the bot actually reaches.

Out of scope: the accuracy of card data, rate limiting of the data sources, and anything that requires the attacker to already control the host or the Discord application

## Handling the token

The bot reads `DISCORD_TOKEN` from the environment or from `.env`, which is gitignored. If a token is exposed, reset it in the Discord Developer Portal under Bot, then Token, then Reset Token. A reset invalidates the old value immediately and the bot will fail its next connection until the new one is in place

## Dependencies

`npm audit` covers the tree. Dependabot alerts on the repository cover the same ground and are worth enabling alongside it
