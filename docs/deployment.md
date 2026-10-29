# Deployment

Use the native systemd service on a 64-bit Debian 12 host. GitHub builds a Linux ARM64 bundle containing the pinned Node runtime, production dependencies, compiled bot and local card data. The host downloads the bundle and runs an offline check before stopping the installed bot

The service starts at boot and retries after a crash or a failed login. The bot needs outbound HTTPS and Discord Gateway access; it opens no listening port

## Prepare the migration

The host needs root access, Python 3 and systemd. Confirm `uname -m` prints `aarch64` and there is enough free disk space. Install missing prerequisites with `sudo apt-get install python3 ca-certificates git`

Wait for the deployment and application changes to merge into `master`, then check that the CI run for the current master commit has published its `pi-<commit>` prerelease. Pull requests build and test bundles but do not publish them

On the machine that currently runs the bot, locate the working `.env` and the directory named by `DATA_DIR`. If `DATA_DIR` is unset, existing server settings live in memory and cannot be copied. Stop the source bot before copying SQLite files or starting the new one. Copy `settings.db` and any `settings.db-wal` or `settings.db-shm` files together after the process exits

Transfer secrets through SSH into a private directory. In PowerShell, substitute the SSH alias and the actual local paths:

```powershell
$piTarget = 'your-host-alias'
ssh $piTarget 'umask 077; mkdir -p ~/card-bot-migration; chmod 700 ~/card-bot-migration'
scp 'C:\path\to\bot\.env' "${piTarget}:card-bot-migration/bot.env"
# Run these only when the files exist in the stopped source bot's DATA_DIR.
scp 'C:\path\to\bot\data\settings.db' "${piTarget}:card-bot-migration/settings.db"
```

Transfer any SQLite sidecar files with the same `scp` pattern if they remain. Keep the source files until the new host passes the acceptance checks. Never copy the source machine's `node_modules`, PID file or build directory

## Install on the host

Run these commands in the SSH session. The checkout contains installation tooling only; the service runs a tested release under `/opt`

```bash
git clone https://github.com/leonid-dalin/pokemon-tcg-card-bot.git
cd pokemon-tcg-card-bot
sudo bash deploy/install.sh
sudo pokemon-card-bot fetch
sudo pokemon-card-bot import-env "$HOME/card-bot-migration/bot.env"
```

If `fetch` reports that no bundle exists yet, wait for CI and run it again. Do not enable the service until a release exists at `/opt/pokemon-card-bot/current`

`import-env` parses the source file with the bundled Node runtime, validates the required configuration and writes `/etc/pokemon-card-bot/bot.env` with mode `0600`. It keeps the supplied token, application ID and reply options. It sets the data and status paths for the service, and maps an enabled invocation log to persistent storage. Running it again replaces the environment file; restart the service to apply changes

If you have an existing settings database, install it while both bot instances are stopped:

```bash
sudo install -o pokemon-card-bot -g pokemon-card-bot -m 0600 \
  "$HOME/card-bot-migration/settings.db" /var/lib/pokemon-card-bot/data/settings.db
# Repeat for settings.db-wal and settings.db-shm if transferred.
```

Register the slash commands on the host. The bundle ships the compiled registration script and its own Node runtime, so this needs no npm or source checkout. It reads the imported environment file, registers guild commands when the file sets a guild ID and global commands otherwise, and is safe to re-run after the definitions change:

```bash
sudo bash -c 'set -a; . /etc/pokemon-card-bot/bot.env; set +a;
  cd /opt/pokemon-card-bot/current && ./bin/node dist/src/discord/register.js'
```

Enable the service and check it. Registration works whether the bot is running or not:

```bash
sudo systemctl enable --now pokemon-card-bot.service
sudo pokemon-card-bot status
sudo journalctl -u pokemon-card-bot.service -n 30 --no-pager
```

For a new installation without a database, skip the `install` command and enable the service directly. Deployment never registers commands automatically

Once the acceptance checks pass, delete the temporary secret copy from the migration directory and keep an independent backup of the private environment file. Restrict any retained copy to the account that owns it

## Acceptance checks

- Confirm `systemctl is-enabled pokemon-card-bot.service` returns `enabled`
- Confirm `sudo pokemon-card-bot status` reports the expected revision and `discordReady: true`
- Try `/card`, `/search` and an enabled message reply in a test server; these need the registration step above to have run first
- Check that migrated per-server settings survive `sudo systemctl restart pokemon-card-bot.service`
- Reboot during a maintenance window and repeat the readiness and command checks
- Confirm other services on the host still work, then inspect `systemctl show pokemon-card-bot.service -p MemoryCurrent -p MemoryPeak -p NRestarts` and the hardware's temperature and throttling status

The service allows one CPU core, sets V8's old-space limit to 192 MiB and applies systemd memory thresholds of 256 MiB and 384 MiB. These defaults need observation on the actual hardware under its usual traffic. Inspect the journal for memory pressure before changing limits with `sudo systemctl edit pokemon-card-bot.service`

## Updates and rollback

Enable automatic checks only after the first deployment passes:

```bash
sudo systemctl enable --now pokemon-card-bot-update.timer
systemctl list-timers pokemon-card-bot-update.timer
# Or check and update immediately:
sudo pokemon-card-bot update
```

The timer checks about every 30-35 minutes, starting 10-15 minutes after boot. It reads the exact `master` commit through the public GitHub API and requires the matching published bundle and checksum. A missing bundle, failed download or checksum mismatch leaves the installed code running. No GitHub token is needed on the host

Before activation, the updater stops the bot and then takes the authoritative settings checkpoint, so every setting the old process acknowledged is included; downloads and the bundle preflight already ran by that point. It switches the release link and waits up to 180 seconds for a fresh status file from the new process confirming Discord readiness. Failed startup restores the previous code and settings snapshot, then restarts the previous release. Network outages during activation can therefore cause a rollback

Activation is recorded in `/opt/pokemon-card-bot/update-state.json` before the bot stops, with a phase written as the updater reaches each step: `prepared` before the stop, `checkpointed` after the settings snapshot, `switched` before the release link changes, and `ready` after Discord readiness. Every update command starts by recovering an interrupted activation, whether or not the service is currently running. Recovery reconciles the recorded phase with the release actually selected: a crash before the switch restarts the previous release, a crash after a switch that never selected the new release keeps the previous release's live settings (they may have changed after the post-reboot start), a crash after the switch but before readiness restores the checkpoint and starts the service, and a crash after readiness completes the success record. A power loss between phases therefore resolves on the first update run; the bot service also restarts independently through systemd. Recovery stops the unit outright before restoring settings or code, so a pending automatic restart cannot launch the new release mid-restore

The updater keeps the current and previous release, plus the three most recent upgrade checkpoints. Snapshots you create with `backup` are never pruned automatically. Automatic updates respect a manually stopped bot. To pause updates while investigating a problem:

```bash
sudo systemctl disable --now pokemon-card-bot-update.timer
sudo systemctl stop pokemon-card-bot-update.service
sudo journalctl -u pokemon-card-bot-update.service -n 50 --no-pager
sudo pokemon-card-bot backup
sudo pokemon-card-bot rollback --restore-settings
```

Manual rollback restores the settings checkpoint taken before the last successful update. Rollback validates the checkpoint and previous release before stopping the bot, so a missing checkpoint leaves the current release running. An interrupted rollback records its phase, and the next update finishes it; if the previous release was already selected before the interruption, recovery restarts it and keeps any settings it has accepted since. If automatic restoration after a failed startup cannot complete, the updater keeps the pending recovery state and does not start the unconfirmed release; the next update retries the restoration. The restart intent stays on disk until the restored service actually starts, so a failed start remains retryable and the bot is never left stopped without a record. Settings changed after that checkpoint are lost; take a backup first. A rollback restores code and SQLite settings only. The environment file and invocation logs stay in place. The updater remembers a failed or rolled-back revision and skips it until master changes. Use `sudo pokemon-card-bot update --retry` to retry it after investigating, then re-enable the timer

The bundle builder downloads the pinned Node runtime and its licence from the official `nodejs.org/dist` archive, verifies the archive against the published SHA-256 checksum and bundles both with the release

SHA-256 checks detect transfer corruption. The release and checksum share GitHub's trust boundary; they are not an independent signature

## Files and recovery

| Path | Purpose |
| --- | --- |
| `/etc/pokemon-card-bot/bot.env` | Private configuration, owned by root |
| `/var/lib/pokemon-card-bot/data/settings.db` | Persistent per-server settings |
| `/var/lib/pokemon-card-bot/invocations/` | Optional full invocation logs, enabled only by configuration |
| `/run/pokemon-card-bot/` | PID lock and readiness file, recreated at boot |
| `/opt/pokemon-card-bot/releases/` | Installed release bundles |
| `/opt/pokemon-card-bot/backups/` | Settings snapshots, owned by root |
| `/opt/pokemon-card-bot/rollback.json` | Previous release and settings checkpoint |
| `/opt/pokemon-card-bot/update-state.json` | In-progress update or rollback phase, used to recover an interrupted operation |

Use `sudo pokemon-card-bot backup` for an online SQLite snapshot. Copy that snapshot and the environment file to secure storage off the SD card. Back up invocation logs separately if enabled. The updater's snapshots protect upgrades; they share the same SD card as the live database

The service logs to journald and leaves the host's global journal policy unchanged. Invocation logs can contain complete messages and replies, so enable them only when needed and monitor their disk usage

For a failed boot, check `systemctl status pokemon-card-bot.service`, the service journal, DNS and outbound connectivity. `status` distinguishes an active process from a Discord connection. systemd keeps retrying startup every 30 seconds, including when the network comes up late after a reboot

The installer can be rerun to update the management script and unit files. Stop the update timer first, review changes in `deploy/`, run `sudo bash deploy/install.sh`, then restart the bot. The bundle updater changes application releases only

## Optional Docker deployment

The native service suits a small single-board computer that also runs DNS or gateway services. The Dockerfile and Compose file support installations that already use Docker. [Docker supports Debian Bookworm and ARM64](https://docs.docker.com/engine/install/debian/); installing its daemon and network rules needs a separate decision on a shared gateway

Place a private `.env` beside `compose.yaml`, set `INVOCATION_LOG_DIR=/data/invocations` if logging is wanted, then run:

```bash
docker compose build
docker compose up -d
docker compose ps
docker compose logs --tail=30
```

Build on another ARM64 machine and transfer the image with `docker save` and `docker load` if the host cannot spare the build resources. Use the same image tag as the Compose file. The build context excludes `.env`, databases and local logs. The runtime uses a persistent named volume, a read-only filesystem and the same memory limit as the native service

Keep Docker enabled at boot. Compose restarts an exited container after a crash or reboot through `unless-stopped`; an unhealthy status alone does not restart it. Check the status and logs when Discord is unavailable. Docker updates and volume backups are manual; the systemd updater manages native bundles only. Run one deployment at a time

## Build and test the tooling

CI runs the application tests on x64 and ARM64, exercises updater failure and rollback cases, checks shell and systemd syntax, and tests both the native bundle and Docker image on ARM64. The bundle's offline smoke test also runs inside Debian 12 with a 384 MiB memory limit. [GitHub's public ARM64 runner](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) performs the build

To run the Python checks on Linux without target hardware:

```bash
python3 -m unittest discover -s deploy/tests -v
shellcheck deploy/*.sh
```

Offline checks cannot verify the real bot token, the host's reboot policy or its workload. Complete the acceptance checks on the target machine before relying on unattended operation
