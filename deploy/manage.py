#!/usr/bin/python3
"""Install tested ARM64 releases without changing persistent configuration."""

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import pwd
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

REPO = "leonid-dalin/pokemon-tcg-card-bot"
SERVICE = "pokemon-card-bot.service"
ROOT = Path("/opt/pokemon-card-bot")
DATA = Path("/var/lib/pokemon-card-bot/data")
ENV = Path("/etc/pokemon-card-bot/bot.env")
STATUS = Path("/run/pokemon-card-bot/status.json")
SHA = re.compile(r"[0-9a-f]{40}")
MAX_DOWNLOAD = 200 * 1024 * 1024
MAX_UNPACKED = 800 * 1024 * 1024


def progress(message):
    print(message, flush=True)


def run(*args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs).stdout.strip()


def preflight(unpacked):
    """Run the bundle smoke test as the service user without operator secrets."""
    # The executable must be resolved from a trusted search path that includes the
    # administrative directories; a bare PATH would miss /sbin runuser on Bookworm.
    runuser = shutil.which("runuser", path="/usr/sbin:/sbin:/usr/bin:/bin")
    if not runuser:
        raise RuntimeError("runuser is required for the service-user preflight")
    progress("Checking bundled runtime, card data and SQLite as the service user")
    run(runuser, "-u", "pokemon-card-bot", "--", str(unpacked / "bin/node"),
        "--max-old-space-size=192", str(unpacked / "deploy/smoke.mjs"), cwd="/tmp", timeout=120,
        env={"PATH": "/usr/bin:/bin"})


def systemctl(*args):
    return run("systemctl", *args)


def active():
    return subprocess.run(["systemctl", "is-active", "--quiet", SERVICE], check=False).returncode == 0


def request(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={
        "User-Agent": "pokemon-card-bot-updater", "Accept": "application/vnd.github+json",
    }), timeout=30)


def api(path):
    with request(f"https://api.github.com/repos/{REPO}/{path}") as response:
        return json.loads(response.read(2 * 1024 * 1024))


def valid_sha(value):
    if not isinstance(value, str) or not SHA.fullmatch(value):
        raise ValueError("invalid release revision")
    return value


def published_head():
    sha = valid_sha(api("commits/master")["sha"])
    try:
        release = api(f"releases/tags/pi-{sha}")
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise
    if release.get("draft"):
        return None
    names = {asset["name"] for asset in release.get("assets", [])}
    name = f"pokemon-card-bot-linux-arm64-{sha}.tar.gz"
    return sha if {name, name + ".sha256"} <= names else None


def download(url, destination, limit):
    size = 0
    with request(url) as response, destination.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > limit:
                raise ValueError("release download exceeds size limit")
            output.write(chunk)


def extract(archive, destination):
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        size = 0
        for member in members:
            path = PurePosixPath(member.name)
            size += member.size
            if (path.is_absolute() or ".." in path.parts or "\\" in member.name
                    or not (member.isfile() or member.isdir()) or size > MAX_UNPACKED):
                raise ValueError("unsafe release archive")
            member.mode &= 0o755
            member.uid = member.gid = 0
            member.uname = member.gname = "root"
        bundle.extractall(destination, members=members)


def manifest(release, expected=None):
    info = json.loads((release / "BUILD.json").read_text())
    valid_sha(info["sha"])
    if (info.get("platform") != "linux" or info.get("arch") != "arm64"
            or expected is not None and info["sha"] != expected):
        raise ValueError("release manifest does not match Linux ARM64 revision")
    for required in ("bin/node", "dist/src/index.js", "src/data/text-index.json", "deploy/smoke.mjs"):
        if not (release / required).is_file():
            raise ValueError("incomplete release bundle")
    return info


def current():
    link = ROOT / "current"
    if not link.is_symlink():
        return None
    release = link.resolve(strict=True)
    if release.parent != (ROOT / "releases").resolve():
        raise ValueError("current release is outside the release directory")
    manifest(release, release.name)
    return release


def point_to(release):
    next_link = ROOT / "current.next"
    next_link.unlink(missing_ok=True)
    next_link.symlink_to(release)
    next_link.replace(ROOT / "current")


def atomic_json(path, payload):
    descriptor, temporary = tempfile.mkstemp(prefix=path.name + "-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as output:
            json.dump(payload, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    except Exception:
        Path(temporary).unlink(missing_ok=True)
        raise


def atomic_text(path, text):
    descriptor, temporary = tempfile.mkstemp(prefix=path.name + "-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as output:
            output.write(text)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    except Exception:
        Path(temporary).unlink(missing_ok=True)
        raise


STATE = ROOT / "update-state.json"


def begin_activation(release, previous, backup):
    atomic_json(STATE, {"phase": "checkpointed", "release": release.name,
                        "previous": previous.name, "backup": backup.name})


def recover():
    """Finish or undo an activation interrupted by cancellation or power loss."""
    if not STATE.exists():
        return
    try:
        state = json.loads(STATE.read_text())
        phase = state["phase"]
        release = ROOT / "releases" / valid_sha(state["release"])
        previous = ROOT / "releases" / valid_sha(state["previous"])
        backup = ROOT / "backups" / state["backup"]
    except (OSError, ValueError, KeyError, TypeError):
        print("Unreadable update state; see docs/deployment.md for manual recovery", file=sys.stderr)
        raise SystemExit(1)
    progress("Recovering an interrupted update")
    selected = current()
    # The selected release decides the actual phase when the link and the
    # recorded intent disagree after a crash.
    if phase in ("prepared", "checkpointed") and selected == release:
        phase = "switched"
    if phase == "ready":
        # The new release reached readiness; always refresh the success record so a
        # stale checkpoint from an older update can never be rolled back into.
        atomic_json(ROOT / "rollback.json", {"backup": state["backup"], "from": release.name})
        STATE.unlink()
        if not active():
            systemctl("start", SERVICE)
        return
    if phase == "switched" and selected == release:
        # Readiness was never confirmed, so restore the previous code and settings.
        try:
            restorable = backup.is_dir() and bool(manifest(previous, previous.name))
        except (ValueError, OSError):
            restorable = False
        if not restorable:
            progress("Rollback prerequisites are missing or invalid; keeping the switched release")
        else:
            was_running = active()
            if was_running:
                systemctl("stop", SERVICE)
            restore(backup)
            point_to(previous)
            atomic_text(ROOT / "failed-revision", release.name)
            progress(f"Interrupted before readiness; restored {previous.name}")
    else:
        # Switch intent was persisted but the new release was never selected, or
        # activation never got past preparation/checkpointing: the previous release
        # is live and may have accepted settings since the reboot, so its live
        # database stays in place instead of the pre-reboot checkpoint.
        progress("Previous release is still selected; keeping its live settings")
    STATE.unlink()
    # The service must not stay down because recovery happened while it was failed.
    systemctl("start", SERVICE)


def activate(release):
    previous = current()
    if previous == release:
        print("Already running the published revision")
        return
    if previous is None or not ENV.exists():
        raise RuntimeError("fetch a release and import the environment before starting the bot")
    if not active():
        print("Bot is stopped; update skipped")
        return
    backup = ROOT / "backups" / f"{int(time.time_ns())}-{previous.name}"
    # Persist the stop intent before touching the service, so a killed updater can
    # be recovered instead of leaving a stopped bot with no record of why.
    atomic_json(STATE, {"phase": "prepared", "release": release.name,
                        "previous": previous.name, "backup": backup.name})
    try:
        # Stop first so the checkpoint captures every setting the old process
        # acknowledged; downloads and the preflight already ran before this point.
        progress("Stopping the bot and taking the authoritative settings checkpoint")
        systemctl("stop", SERVICE)
        snapshot(backup)
        (backup / "previous").write_text(previous.name)
        atomic_json(STATE, {"phase": "checkpointed", "release": release.name,
                            "previous": previous.name, "backup": backup.name})
        # Persist the switch intent before replacing the link, so a crash in the
        # gap is recovered as a switch rather than left on the old phase.
        atomic_json(STATE, {"phase": "switched", "release": release.name,
                            "previous": previous.name, "backup": backup.name})
        point_to(release)
        progress(f"Starting {release.name} and waiting for Discord readiness")
        systemctl("start", SERVICE)
        wait_ready()
        atomic_json(STATE, {"phase": "ready", "release": release.name,
                            "previous": previous.name, "backup": backup.name})
    except BaseException:
        progress("Startup failed or interrupted; restoring previous code and settings")
        with contextlib.suppress(Exception):
            systemctl("stop", SERVICE)
        if current() == previous:
            # No selection happened; the old release and its live settings are
            # intact, so restart it and drop the pending transaction.
            with contextlib.suppress(Exception):
                STATE.unlink()
            systemctl("start", SERVICE)
            raise
        try:
            # Record the failed release before attempting recovery, so a failed
            # restoration cannot lead to immediate re-attempts of the same revision.
            atomic_text(ROOT / "failed-revision", release.name)
            if backup.is_dir():
                restore(backup)
            point_to(previous)
            STATE.unlink()
        except Exception:
            # Restoration failed: keep the pending state so a later recovery retries
            # it, and never start the release that just failed its readiness check.
            progress("Automatic restoration failed; the new release stays selected and recovery is pending")
            raise
        systemctl("start", SERVICE)
        raise
    atomic_json(ROOT / "rollback.json", {"backup": backup.name, "from": release.name})
    STATE.unlink()
    print(f"Running {release.name}; settings snapshot {backup.name}")
    prune()


def fetch(sha):
    valid_sha(sha)
    target = ROOT / "releases" / sha
    if target.exists():
        manifest(target, sha)
        return target
    with tempfile.TemporaryDirectory(prefix=".download-", dir=ROOT) as temporary:
        progress(f"Downloading tested revision {sha}")
        stage = Path(temporary)
        name = f"pokemon-card-bot-linux-arm64-{sha}.tar.gz"
        url = f"https://github.com/{REPO}/releases/download/pi-{sha}/{name}"
        archive, checksum = stage / name, stage / "checksum"
        download(url + ".sha256", checksum, 1024)
        expected = checksum.read_text().split()[0]
        if not re.fullmatch(r"[0-9a-f]{64}", expected):
            raise ValueError("invalid release checksum")
        download(url, archive, MAX_DOWNLOAD)
        digest = hashlib.sha256()
        with archive.open("rb") as data:
            while chunk := data.read(1024 * 1024):
                digest.update(chunk)
        if digest.hexdigest() != expected:
            raise ValueError("release checksum mismatch")
        unpacked = stage / "release"
        unpacked.mkdir()
        extract(archive, unpacked)
        os.chmod(unpacked, 0o755)
        manifest(unpacked, sha)
        # Run without credentials and as the service user before stopping the live bot.
        os.chmod(stage, 0o755)
        preflight(unpacked)
        unpacked.rename(target)
    return target


def ready(status, pid, now=None):
    now = time.time() if now is None else now
    try:
        value = json.loads(status.read_text())
        age = now - value["updatedAt"] / 1000
        return value["pid"] == pid and value["ready"] is True and 0 <= age < 20
    except (OSError, ValueError, KeyError, TypeError):
        return False


def wait_ready(timeout=180):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        pid = int(systemctl("show", SERVICE, "--property=MainPID", "--value") or "0")
        if pid > 0 and ready(STATUS, pid):
            return
        time.sleep(2)
    raise RuntimeError("the new release did not become ready on Discord within 180 seconds")


def snapshot(destination):
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    database = DATA / "settings.db"
    if database.exists():
        with contextlib.closing(sqlite3.connect(f"file:{database}?mode=ro", uri=True)) as source:
            with contextlib.closing(sqlite3.connect(destination / "settings.db")) as backup:
                source.backup(backup)
    (destination / "snapshot.json").write_text(json.dumps({"settingsExisted": database.exists()}))


def restore(source):
    info = json.loads((source / "snapshot.json").read_text())
    database = DATA / "settings.db"
    replacement = None
    if info["settingsExisted"]:
        descriptor, temporary = tempfile.mkstemp(prefix=".settings-restore-", dir=DATA)
        replacement = Path(temporary)
        try:
            with os.fdopen(descriptor, "wb") as output, (source / "settings.db").open("rb") as snapshot_file:
                shutil.copyfileobj(snapshot_file, output)
                output.flush()
                os.fsync(output.fileno())
            user = pwd.getpwnam("pokemon-card-bot")
            os.chown(replacement, user.pw_uid, user.pw_gid)
        except Exception:
            replacement.unlink(missing_ok=True)
            raise
    for suffix in ("-wal", "-shm", "-journal"):
        Path(str(database) + suffix).unlink(missing_ok=True)
    if replacement is None:
        database.unlink(missing_ok=True)
    else:
        replacement.replace(database)


def prune():
    keep = {current()}
    rollback = ROOT / "rollback.json"
    keep_backups = set()
    if rollback.exists():
        info = json.loads(rollback.read_text())
        keep_backups.add(info["backup"])
        previous = (ROOT / "backups" / info["backup"] / "previous").read_text().strip()
        keep.add(ROOT / "releases" / valid_sha(previous))
    for release in (ROOT / "releases").iterdir():
        if SHA.fullmatch(release.name) and release not in keep and not release.is_symlink():
            shutil.rmtree(release)
    # Manual operator backups are never pruned; only upgrade checkpoints expire.
    checkpoints = [path for path in (ROOT / "backups").iterdir()
                   if path.is_dir() and not path.name.endswith("-manual")]
    for backup in sorted(checkpoints, key=lambda path: path.name, reverse=True)[3:]:
        if backup.name not in keep_backups and backup.is_dir() and not backup.is_symlink():
            shutil.rmtree(backup)


def rollback():
    info = json.loads((ROOT / "rollback.json").read_text())
    installed = current()
    if installed is None or installed.name != info["from"]:
        raise RuntimeError("rollback checkpoint does not match the current release")
    backup = ROOT / "backups" / info["backup"]
    if not backup.is_dir():
        raise RuntimeError("rollback checkpoint is missing; the current release stays in place")
    previous_name = valid_sha((backup / "previous").read_text().strip())
    target = ROOT / "releases" / previous_name
    manifest(target, previous_name)
    # Validate every checkpoint component before touching the running bot; an
    # incomplete checkpoint must never leave the service stopped.
    try:
        snapshot_info = json.loads((backup / "snapshot.json").read_text())
        if snapshot_info["settingsExisted"] and not (backup / "settings.db").is_file():
            raise ValueError("checkpoint database is missing")
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise RuntimeError(f"rollback checkpoint is unusable ({type(error).__name__})") from error
    # Record the failed release before attempting recovery: a failed restoration
    # must not allow immediate re-attempts of the same revision.
    atomic_text(ROOT / "failed-revision", info["from"])
    systemctl("stop", SERVICE)
    try:
        restore(backup)
        point_to(target)
        systemctl("start", SERVICE)
        wait_ready()
    except Exception:
        # restore() only replaces the live database after a complete copy, so the
        # installed release and its database are unchanged and can keep running.
        progress("Rollback did not reach readiness; restarting the installed release")
        with contextlib.suppress(Exception):
            systemctl("start", SERVICE)
        raise
    (ROOT / "rollback.json").unlink()
    print(f"Restored {previous_name} and its settings checkpoint")


def import_env(source):
    release = current()
    if release is None:
        raise RuntimeError("fetch a release first")
    values = json.loads(run(str(release / "bin/node"), str(release / "deploy/import-env.mjs"),
                            str(source.resolve()), env={"PATH": "/usr/bin:/bin"}))
    values["DATA_DIR"] = str(DATA)
    values["BOT_STATUS_FILE"] = str(STATUS)
    if values.get("INVOCATION_LOG_DIR", "").strip():
        values["INVOCATION_LOG_DIR"] = str(DATA.parent / "invocations")
    def quote(value):
        return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'
    temporary = ENV.with_suffix(".next")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as output:
        for key, value in values.items():
            output.write(f"{key}={quote(value)}\n")
    temporary.replace(ENV)
    print("Imported environment; existing settings require a separate data migration")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("fetch", help="install the tested master bundle without starting the bot")
    update_parser = commands.add_parser("update", help="update a running bot, restoring code and settings on failure")
    update_parser.add_argument("--retry", action="store_true", help="retry a revision that previously failed")
    commands.add_parser("status", help="show revision and Discord readiness without secrets")
    commands.add_parser("backup", help="take an online settings snapshot")
    rollback_parser = commands.add_parser("rollback", help="restore the previous release and pre-update settings")
    rollback_parser.add_argument("--restore-settings", action="store_true", required=True)
    env_parser = commands.add_parser("import-env", help="convert a dotenv file into the private systemd environment")
    env_parser.add_argument("source", type=Path)
    args = parser.parse_args()
    if os.geteuid() != 0 or platform.machine() != "aarch64":
        parser.error("run as root on Linux ARM64")
    os.umask(0o077)
    with (ROOT / "manage.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.command == "import-env":
            import_env(args.source)
        elif args.command == "rollback":
            rollback()
        elif args.command == "backup":
            destination = ROOT / "backups" / f"{time.time_ns()}-manual"
            snapshot(destination)
            print(destination)
        elif args.command == "status":
            release = current()
            pid = int(systemctl("show", SERVICE, "--property=MainPID", "--value") or "0")
            print(json.dumps({"revision": release.name if release else None,
                              "pid": pid, "discordReady": pid > 0 and ready(STATUS, pid)}))
        else:
            recover()
            if args.command == "update" and not active():
                print("Bot is stopped; update skipped")
                return
            sha = published_head()
            if sha is None:
                print("No tested bundle published for master yet; keeping the installed release")
                return
            failed = ROOT / "failed-revision"
            if (args.command == "update" and failed.exists() and failed.read_text().strip() == sha
                    and not args.retry):
                print("This revision previously failed; use update --retry after investigating")
                return
            release = fetch(sha)
            if args.command == "update":
                activate(release)
            elif current() is None:
                point_to(release)
                print(f"Installed {sha}; import the environment before enabling the service")
            else:
                print(f"Staged {sha}; use update to activate it")


if __name__ == "__main__":
    def interrupted(signum, frame):
        raise RuntimeError("deployment interrupted")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        main()
    except Exception as error:
        # Subprocess output may contain credentials; report only the failure category.
        print(f"Deployment failed ({type(error).__name__}); the update service journal has the last completed step", file=__import__("sys").stderr)
        raise SystemExit(1)
