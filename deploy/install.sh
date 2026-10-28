#!/bin/bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo' >&2; exit 1; }
[[ $(uname -m) == aarch64 ]] || { echo 'A 64-bit ARM operating system is required' >&2; exit 1; }
command -v python3 >/dev/null
python3 -c "import sqlite3" || { echo 'Python 3 with the sqlite3 module is required' >&2; exit 1; }
command -v systemctl >/dev/null
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
getent passwd pokemon-card-bot >/dev/null || useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin pokemon-card-bot
install -d -m 0755 /opt/pokemon-card-bot/releases /usr/local/lib/pokemon-card-bot
install -d -m 0700 /etc/pokemon-card-bot /opt/pokemon-card-bot/backups
install -d -m 0700 -o pokemon-card-bot -g pokemon-card-bot /var/lib/pokemon-card-bot /var/lib/pokemon-card-bot/data
install -m 0755 "$source_dir/manage.py" /usr/local/sbin/pokemon-card-bot
install -m 0644 "$source_dir"/systemd/* /etc/systemd/system/
systemctl daemon-reload
echo 'Installed tooling. Fetch a release, import the environment, then enable the bot as described in docs/deployment.md.'
