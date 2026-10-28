# Privacy Policy

Crustlebot reads as little as possible and stores almost nothing. This policy explains what touches your data. Last updated: 28 October 2026

## What the bot stores

- **Nothing on disk.** The bot keeps no database and writes no user data to storage. Everything it remembers lives in memory: recent search and printing lists (so page and filter buttons work), the Discord id of whoever asked for a reply (so only they can press its buttons), and short-lived interaction state. All of it expires within minutes
- **No message history.** The bot reads only the messages that trigger it: `[[card]]` mentions, a search command, or a pasted deck list in servers where deck checking is switched on. It does not log, forward or retain message content
- **Configuration lives with you.** Servers choose whether deck checking is on. That choice sits in the server's own environment, not in any profile we keep

## What leaves Discord

When the bot answers, it asks public card databases for card facts: TCGdex for physical cards and the Pocket TCG Pocket package for Pocket cards. These requests carry no information about you, only the card being looked up. Pressing the Limitless or Cardmarket button opens that site in your browser under its own privacy terms

## Who can see what

The person running the bot (the server host) controls its configuration and can see its console output, which may contain errors mentioning ids. Discord itself handles all message transport under Discord's own privacy policy

## Contact

The easiest way to reach the maintainers is the repository's issue tracker: [open a question](https://github.com/leonid-dalin/pokemon-tcg-card-bot/issues/new?template=question.yml) and it lands as a template with everything needed to answer it. If you use the bot in someone else's server, that server's host can also answer configuration questions
