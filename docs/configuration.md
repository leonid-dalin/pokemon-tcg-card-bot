# Configuration

The bot reads process environment variables and a local `.env`. The user-facing options are listed in [.env.example](../.env.example)

| Variable | Purpose and default |
| --- | --- |
| `DISCORD_TOKEN` | Required bot token |
| `DISCORD_CLIENT_ID` | Required Discord Application ID |
| `DISCORD_GUILD_ID` | Optional server ID for command registration; unset means global |
| `DATA_DIR` | Settings database directory; unset means settings reset on restart |
| `MENTION_ENABLED` | Enables ordinary-message handling and its gateway intent; `true` |
| `DECKLIST_ENABLED` | Initial server default for pasted decklists; `false` |
| `MENTION_COOLDOWN_SECONDS` | Initial reply cooldown; `0` in code, `30` in the example file |
| `UPSTREAM_CONCURRENCY` | Card-service requests allowed at once; `8` |
| `UPSTREAM_QUEUE_LIMIT` | Requests allowed to wait for a free slot; `32` |
| `UPSTREAM_QUEUE_WAIT_MS` | Longest a request may wait for a slot; `5000` |
| `MEMBER_LOOKUP_BURST` | Lookups one member may spend at once; `5` |
| `MEMBER_LOOKUP_REFILL_SECONDS` | Seconds to refill one member lookup; `2` |
| `ATTRIBUTION` | Physical-card footer; `Card data from TCGdex` |
| `ENERGY_EMOJI` | JSON mapping of energy types to Discord emoji markup; `{}` |
| `INVOCATION_LOG_DIR` | Optional directory for full triggering-message and reply logs; disabled when unset |
| `INVOCATION_LOG_RETENTION_DAYS` | Log retention setting; defaults to `60`, capped at `60` |

The cooldown allows a burst of three automatic replies per member and channel, then replenishes one reply per configured interval. Zero disables it. Slash commands do not use that budget

Invocation logging is optional and can retain message content. Read the [privacy policy](../PRIVACY.md) before enabling it. Pocket replies use their own source credit regardless of `ATTRIBUTION`


## Preserve server settings

Set `DATA_DIR` to a writable directory. The bot stores server choices in `settings.db` there; without a directory, it uses an in-memory database and resets choices on restart. Keep the database with the deployment's persistent data

The source checkout resolves relative paths from its working directory. The native deployment supplies its paths through the service configuration; follow the [deployment guide](deployment.md) for backups and migration

## Deployment defaults and server choices

`MENTION_ENABLED`, `DECKLIST_ENABLED` and `MENTION_COOLDOWN_SECONDS` supply defaults for servers that have not chosen their own settings. Server administrators use [/settings](server-settings.md) to save overrides

`MENTION_ENABLED=false` also disables message handling and omits Message Content Intent for the whole process. A server override cannot enable that handler

[Setup](setup.md) explains credentials, the invite permissions and command registration
