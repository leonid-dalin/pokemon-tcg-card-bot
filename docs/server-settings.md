# Server settings

Members with Manage Server permission can use `/settings` inside a Discord server. These choices affect that server. The host supplies the defaults through [configuration](configuration.md)

## View and reset

```text
/settings view
/settings reset
```

`view` shows the current choices and host-wide switches. `reset` restores deployment defaults. The operator must configure a persistent `DATA_DIR` to retain changes after restart

## Choose automatic replies

```text
/settings messages enabled:true
/settings decklists enabled:true
```

The message switch controls card mentions, wording searches and help requests. Decklists have a separate switch and are off by default. Slash commands remain available when a server turns message replies off

The host's `MENTION_ENABLED=false` disables all ordinary-message handling, including decklists. Ask the operator to enable it if `/settings view` reports that switch

## Limit replies to selected channels

Add a channel, then select the restricted mode:

```text
/settings channels add channel:#cards
/settings channels mode mode:selected
```

Use `/settings channels remove channel:#cards` to remove one channel, or `/settings channels clear` to empty the list. Selected mode with an empty list stops automatic replies everywhere. Choose `/settings channels mode mode:all` to allow every channel

The selector accepts server text and announcement channels. Threads use their parent channel's selection. These restrictions apply to automatic replies; slash commands use Discord's command permissions

## Choose a card game

```text
/settings games allowed games:both
/settings games default game:pocket
```

`games allowed` accepts `ptcg`, `pocket` or `both`. When both are allowed, `games default` chooses which game wins an ambiguous card name. New servers allow both and prefer `ptcg`, the physical game

These preferences apply to `/card` and card-name mentions. An explicit game or set hint, or an exact card ID, takes precedence. Set `games allowed` to `both` before changing the default

## Set the reply cooldown

```text
/settings cooldown seconds:30
```

The cooldown allows a burst of three automatic replies per member and channel, then replenishes one reply per interval. Set `seconds:0` to disable it. Slash commands do not use this budget

For command syntax and printing hints, read [Using the bot](usage.md)
