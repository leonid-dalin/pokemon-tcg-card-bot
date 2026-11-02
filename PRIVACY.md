# Privacy Policy

Crustlebot reads as little as possible and stores almost nothing. This policy explains what touches your data. Last updated: 2 November 2026

## What the bot stores

- **Server settings on the host machine, when the host sets a data directory.** With `DATA_DIR` configured, the bot keeps each server's reply choices, selected channel ids, cooldown, allowed card games, default card game and preferred price currency in a small local database. Without it, those choices live only in memory and reset on restart
- **Personal preferences on the host machine, when the host sets a data directory.** A member who chooses a price currency or turns automatic replies off for themselves gets a row keyed by their Discord user id, holding the currency, the reply choice and when it changed. Nothing else is stored about them: no message content, username or account name. Both choices are set through the private settings panel (the 'For me' section) and each can be reset to follow the server there. Resetting a preference clears its field, and the row is deleted once both are cleared. Without a data directory these choices live only in memory
- **Invocation log on the host machine, when the host turns it on.** The host can enable a local log of what the bot was asked and how it answered. When enabled, it keeps the triggering message and the bot's own reply in a file on the machine that hosts the bot, and records whether the invoker is a server administrator or not, the channel id and, where Discord reports it, the server id. It never records a Discord user id, username or account name. Entries are deleted automatically after at most 60 days. When the host has not enabled it, the bot keeps no invocation data on disk at all
- **No other user data on disk.** Beyond the invocation log, the server settings and the personal preferences described above, the bot writes no other user data to storage. It also keeps a `cleanup_jobs` table in that same database, holding the channel and message ids of temporary settings and version replies (and the messages that triggered them) for deletion after 90 seconds, plus unmatched-card replies for deletion after 60 seconds. Unmatched-card jobs store only the bot reply's channel and message ids. A message that triggered a reply in a direct message is the member's own, so the bot does not ask Discord to delete it. Neither message is guaranteed to be gone at its scheduled time: a deletion that fails, for example for a missing permission, is retried a few times with a growing delay and then given up, so the message can stay. Everything else it remembers lives in memory: recent search and printing lists (so page and filter buttons work), the Discord id of whoever asked for a reply (so only they can press its buttons), and short-lived interaction state. All of it expires within minutes
- **Where the log lives.** The host controls this file, it is not copied anywhere, and it is not part of any published repository or backup the maintainers ship. The bot is hosted from a machine in the European Union
- **Configuration lives with you.** A member with the Manage Server permission decides whether decklist replies are on, through that server's settings panel. The `DECKLIST_ENABLED` environment variable sets the deployment-wide default for servers that have not changed it. The bot keeps no profile of these choices

## What leaves Discord

When the bot answers, it asks public card databases for card facts: TCGdex for physical cards and the Pocket TCG Pocket package for Pocket cards. These requests carry no information about you, only the card being looked up. Pressing the Limitless or Cardmarket button opens that site in your browser under its own privacy terms

## Who can see what

The person running the bot (the server host) controls its configuration, the invocation log and the console output. Runtime console output contains no message content, usernames or user ids; it reports the operation and a short error category. Discord itself handles all message transport under Discord's own privacy policy

## Fair use

The bot is a free service. Do not use it to attempt anything unlawful, to probe or attack the service (including injection attempts), or to send profanity or hate speech through it. The host can revoke access from any server or account at any time, and accepts no liability for damage caused by misuse of the service

## Contact

The easiest way to reach the maintainers is the repository's issue tracker: [open a question](https://github.com/leonid-dalin/pokemon-tcg-card-bot/issues/new?template=question.yml) and it lands as a template with everything needed to answer it. If you use the bot in someone else's server, that server's host can also answer configuration questions
