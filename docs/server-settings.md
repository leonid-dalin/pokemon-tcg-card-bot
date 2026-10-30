# Server settings

`/settings` opens a private panel. Members with Manage Server permission start on the server overview and can change every server choice there. Members without that permission open their personal preferences and see only their own choices. These choices affect that server; the host supplies the defaults through [configuration](configuration.md)

The panel has a scope switch, For me and This server, and a section menu: Overview, Replies, Channels, Card games and Currency

## Overview

The overview shows the reply switches, channel coverage, reply cooldown, card game preference and server currency. Reset server settings restores the deployment defaults for the server and asks for confirmation first. Personal preferences are untouched by a reset. The operator must configure a persistent `DATA_DIR` to retain changes after restart

## Replies

Message replies cover card mentions, wording searches and help requests. Decklist replies have their own switch and are off by default. The cooldown allows a burst of automatic replies per member and channel, then replenishes one reply per interval; zero disables it. Slash commands do not use this budget

The host's `MENTION_ENABLED=false` disables all ordinary-message handling, including decklists. The panel says so when it applies, and nothing in the panel can turn it back on

## Channels

Choose Everywhere or Selected channels. In selected mode the panel adds channels with a picker and removes them from a list of saved channels; the changes stay in a draft until you save them. A picker adds at most 25 channels at a time, so long lists are added in batches. Saving an empty selection stops automatic replies everywhere, and the panel asks before that happens

Threads use their parent channel's selection. These restrictions apply to automatic replies; slash commands use Discord's command permissions

## Card games

Card games accepts Physical, Pocket or Both. When both are allowed, a second choice picks which game wins an ambiguous card name. New servers allow both and prefer the physical game

These preferences apply to `/card` and card-name mentions. An explicit game or set hint, or an exact card ID, takes precedence

## Currency

The server currency sets the fallback price currency: EUR, USD, GBP, JPY or CNY. Members can set their own currency on the For me screen, and that choice applies everywhere they use the bot

## Your own preferences

The For me screen holds the two member choices: automatic replies (follow each server, on or off) and price currency (follow each server or a code). These are personal across servers. In a direct message the server currency fallback is the bot default, currently EUR

## What others see

A server change is announced once in the channel where it happened, naming the setting, the old value and the new value. Personal changes, refreshes and repeated presses are not announced. The announcement names the server default, because members may keep their own choice

For command syntax and printing hints, read [Using the bot](usage.md)
