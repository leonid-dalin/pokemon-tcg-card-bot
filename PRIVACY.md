# Privacy Policy

Crustlebot reads as little as possible and stores almost nothing. This policy explains what touches your data. Last updated: 28 October 2026

## What the bot stores

- **Server settings on the host machine, when the host sets a data directory.** With `DATA_DIR` configured, the bot keeps each server's reply choices, selected channel ids and cooldown in a small local database. That database holds only server and channel ids plus the choices themselves, never anything about individual members. Without it, those choices live only in memory and reset on restart
- **Invocation log on the host machine, when the host turns it on.** The host can enable a local log of what the bot was asked and how it answered. When enabled, it keeps the triggering message and the bot's own reply in a file on the machine that hosts the bot, and records whether the invoker is a server administrator or not, the channel id and, where Discord reports it, the server id. It never records a Discord user id, username or account name. Entries are deleted automatically after at most 60 days. When the host has not enabled it, the bot keeps no invocation data on disk at all
- **Nothing else on disk.** Beyond the invocation log and the settings database, the bot writes no user data to storage. Everything else it remembers lives in memory: recent search and printing lists (so page and filter buttons work), the Discord id of whoever asked for a reply (so only they can press its buttons), and short-lived interaction state. All of it expires within minutes
- **Where the log lives.** The host controls this file, it is not copied anywhere, and it is not part of any published repository or backup the maintainers ship. The bot is hosted from a machine in the European Union
- **Configuration lives with you.** Servers choose whether deck checking is on. That choice sits in the server's own environment, not in any profile we keep

## What leaves Discord

When the bot answers, it asks public card databases for card facts: TCGdex for physical cards and the Pocket TCG Pocket package for Pocket cards. These requests carry no information about you, only the card being looked up. Pressing the Limitless or Cardmarket button opens that site in your browser under its own privacy terms

## Who can see what

The person running the bot (the server host) controls its configuration, the invocation log and the console output. Runtime console output contains no message content, usernames or user ids; it reports the operation and a short error category. Discord itself handles all message transport under Discord's own privacy policy

## Fair use

The bot is a free service. Do not use it to attempt anything unlawful, to probe or attack the service (including injection attempts), or to send profanity or hate speech through it. The host can revoke access from any server or account at any time, and accepts no liability for damage caused by misuse of the service

## Contact

The easiest way to reach the maintainers is the repository's issue tracker: [open a question](https://github.com/leonid-dalin/pokemon-tcg-card-bot/issues/new?template=question.yml) and it lands as a template with everything needed to answer it. If you use the bot in someone else's server, that server's host can also answer configuration questions
