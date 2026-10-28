import importlib.util
import json
from pathlib import Path
import shutil
import sqlite3
import tarfile
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("manage", Path(__file__).parents[1] / "manage.py")
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)
OLD = "a" * 40
NEW = "b" * 40


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.root = self.base / "opt"
        self.data = self.base / "data"
        (self.root / "releases").mkdir(parents=True)
        (self.root / "backups").mkdir()
        self.data.mkdir()
        self.env = self.base / "bot.env"
        self.env.write_text("secret-placeholder")
        self.patches = [patch.object(m, "ROOT", self.root), patch.object(m, "DATA", self.data),
                        patch.object(m, "ENV", self.env),
                        patch.object(m, "STATE", self.root / "update-state.json"),
                        patch.object(m.pwd, "getpwnam", return_value=SimpleNamespace(pw_uid=1000, pw_gid=1000))]
        for item in self.patches:
            item.start()
        self.addCleanup(self.temporary.cleanup)
        self.addCleanup(lambda: [item.stop() for item in reversed(self.patches)])

    def release(self, sha):
        path = self.root / "releases" / sha
        path.mkdir()
        (path / "BUILD.json").write_text(json.dumps({"sha": sha, "arch": "arm64", "platform": "linux"}))
        for file in ("bin/node", "dist/src/index.js", "src/data/text-index.json", "deploy/smoke.mjs"):
            (path / file).parent.mkdir(parents=True, exist_ok=True)
            (path / file).touch()
        return path

    def database(self, value):
        with sqlite3.connect(self.data / "settings.db") as database:
            database.execute("CREATE TABLE IF NOT EXISTS settings (value TEXT)")
            database.execute("DELETE FROM settings")
            database.execute("INSERT INTO settings VALUES (?)", (value,))

    def value(self):
        with sqlite3.connect(self.data / "settings.db") as database:
            return database.execute("SELECT value FROM settings").fetchone()[0]

    def test_ready_requires_current_pid_fresh_timestamp_and_discord(self):
        status = self.base / "status"
        for pid, ready, age, expected in [(4, True, 0, True), (3, True, 0, False),
                                           (4, False, 0, False), (4, True, 21, False), (4, True, -1, False)]:
            status.write_text(json.dumps({"pid": pid, "ready": ready, "updatedAt": (100 - age) * 1000}))
            self.assertEqual(m.ready(status, 4, 100), expected)
        status.write_text("partial")
        self.assertFalse(m.ready(status, 4))

    def test_reject_archive_traversal_links_and_devices(self):
        for name, kind in [("../escape", tarfile.REGTYPE), ("/absolute", tarfile.REGTYPE),
                           ("link", tarfile.SYMTYPE), ("hardlink", tarfile.LNKTYPE),
                           ("device", tarfile.CHRTYPE), ("..\\escape", tarfile.REGTYPE)]:
            archive = self.base / "archive.tar.gz"
            with tarfile.open(archive, "w:gz") as bundle:
                entry = tarfile.TarInfo(name)
                entry.type = kind
                bundle.addfile(entry)
            with self.assertRaisesRegex(ValueError, "unsafe"):
                m.extract(archive, self.base / "unpacked")

    def test_failed_start_restores_code_and_pre_migration_database(self):
        previous, release = self.release(OLD), self.release(NEW)
        m.point_to(previous)
        self.database("original")
        def fail():
            self.database("migrated")
            raise RuntimeError("readiness timeout")
        with patch.object(m, "active", return_value=True), patch.object(m, "systemctl") as control, \
                patch.object(m, "wait_ready", side_effect=fail), patch.object(m.os, "chown"):
            with self.assertRaisesRegex(RuntimeError, "readiness"):
                m.activate(release)
            self.assertEqual(m.current(), previous)
            self.assertEqual(self.value(), "original")
            self.assertEqual(control.call_args_list[-1].args, ("start", m.SERVICE))
        self.assertEqual(self.env.read_text(), "secret-placeholder")
        self.assertEqual((self.root / "failed-revision").read_text(), NEW)

    def test_failed_snapshot_leaves_bot_untouched(self):
        previous, release = self.release(OLD), self.release(NEW)
        m.point_to(previous)
        with patch.object(m, "active", return_value=True), patch.object(m, "systemctl") as control, \
                patch.object(m, "snapshot", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                m.activate(release)
            self.assertEqual(m.current(), previous)
            control.assert_not_called()
            self.assertFalse(m.STATE.exists())

    def test_interrupted_after_switch_restores_previous_code_and_settings(self):
        previous, release = self.release(OLD), self.release(NEW)
        m.point_to(previous)
        self.database("original")
        backup = self.root / "backups" / "interrupted"
        m.snapshot(backup)
        m.begin_activation(release, previous, backup)
        m.atomic_json(m.STATE, {"phase": "switched", "release": release.name,
                                "previous": previous.name, "backup": backup.name})
        (backup / "previous").write_text(previous.name)
        m.point_to(release)
        with patch.object(m, "active", return_value=True), patch.object(m, "systemctl"), \
                patch.object(m.os, "chown"):
            m.recover()
        self.assertEqual(m.current(), previous)
        self.assertEqual(self.value(), "original")
        self.assertEqual((self.root / "failed-revision").read_text(), NEW)
        self.assertFalse(m.STATE.exists())

    def test_interrupted_before_switch_keeps_release_running(self):
        previous, release = self.release(OLD), self.release(NEW)
        m.point_to(previous)
        backup = self.root / "backups" / "checkpointed"
        m.snapshot(backup)
        m.begin_activation(release, previous, backup)
        with patch.object(m, "active", return_value=True), patch.object(m, "systemctl") as control:
            m.recover()
        self.assertEqual(m.current(), previous)
        self.assertFalse(m.STATE.exists())
        self.assertEqual(control.call_args_list[-1].args, ("start", m.SERVICE))

    def test_interrupted_after_readiness_completes_the_success_record(self):
        previous, release = self.release(OLD), self.release(NEW)
        m.point_to(release)
        backup = self.root / "backups" / "ready"
        m.snapshot(backup)
        m.begin_activation(release, previous, backup)
        m.atomic_json(m.STATE, {"phase": "ready", "release": release.name,
                                "previous": previous.name, "backup": backup.name})
        (self.root / "rollback.json").write_text(json.dumps({"backup": "stale", "from": OLD}))
        with patch.object(m, "active", return_value=True), patch.object(m, "systemctl") as control:
            m.recover()
        self.assertFalse(m.STATE.exists())
        info = json.loads((self.root / "rollback.json").read_text())
        self.assertEqual(info["from"], NEW)
        self.assertEqual(info["backup"], backup.name)
        control.assert_not_called()

    def test_recovery_starts_a_failed_service_after_restoring(self):
        previous, release = self.release(OLD), self.release(NEW)
        m.point_to(release)
        backup = self.root / "backups" / "switched"
        m.snapshot(backup)
        m.begin_activation(release, previous, backup)
        m.atomic_json(m.STATE, {"phase": "switched", "release": release.name,
                                "previous": previous.name, "backup": backup.name})
        (backup / "previous").write_text(previous.name)
        with patch.object(m, "active", return_value=False), patch.object(m, "systemctl") as control, \
                patch.object(m.os, "chown"):
            m.recover()
        self.assertEqual(m.current(), previous)
        self.assertEqual(control.call_args_list[-1].args, ("start", m.SERVICE))
        self.assertFalse(m.STATE.exists())

    def test_rollback_with_missing_checkpoint_keeps_current_release(self):
        previous, release = self.release(OLD), self.release(NEW)
        m.point_to(previous)
        self.database("original")
        with patch.object(m, "active", return_value=True), patch.object(m, "systemctl"), \
                patch.object(m, "wait_ready"), patch.object(m.os, "chown"):
            m.activate(release)
        shutil.rmtree(self.root / "backups" / next((self.root / "backups").iterdir()).name)
        with patch.object(m, "systemctl") as control:
            with self.assertRaisesRegex(RuntimeError, "missing"):
                m.rollback()
            control.assert_not_called()
        self.assertEqual(m.current(), release)
        self.assertEqual(self.value(), "original")

    def test_prune_keeps_manual_backups_and_referenced_checkpoint(self):
        previous, release = self.release(OLD), self.release(NEW)
        m.point_to(release)
        (self.root / "backups" / "1-old").mkdir()
        (self.root / "backups" / "2-old").mkdir()
        (self.root / "backups" / "3-old").mkdir()
        (self.root / "backups" / "4-old").mkdir()
        manual = self.root / "backups" / "9-manual"
        manual.mkdir()
        referenced = self.root / "backups" / "0-ref"
        referenced.mkdir()
        (referenced / "previous").write_text(OLD)
        (self.root / "rollback.json").write_text(json.dumps({"backup": "0-ref", "from": NEW}))
        m.prune()
        self.assertTrue(manual.exists())
        self.assertTrue(referenced.exists())
        self.assertTrue((self.root / "backups" / "4-old").exists())
        self.assertTrue((self.root / "backups" / "3-old").exists())
        self.assertTrue((self.root / "backups" / "2-old").exists())
        self.assertFalse((self.root / "backups" / "1-old").exists())

    def test_success_keeps_previous_release_and_rollback_restores_settings(self):
        previous, release = self.release(OLD), self.release(NEW)
        abandoned = self.release("c" * 40)
        m.point_to(previous)
        self.database("original")
        with patch.object(m, "active", return_value=True), patch.object(m, "systemctl"), \
                patch.object(m, "wait_ready"), patch.object(m.os, "chown"):
            m.activate(release)
            self.assertEqual(m.current(), release)
            self.assertTrue(previous.exists())
            self.assertFalse(abandoned.exists())
            self.database("newer")
            m.rollback()
            self.assertEqual(m.current(), previous)
            self.assertEqual(self.value(), "original")

    def test_failed_first_migration_removes_new_database(self):
        backup = self.root / "backups" / "no-settings"
        m.snapshot(backup)
        self.database("new schema")
        m.restore(backup)
        self.assertFalse((self.data / "settings.db").exists())

    def test_manual_stop_is_respected(self):
        previous, release = self.release(OLD), self.release(NEW)
        m.point_to(previous)
        with patch.object(m, "active", return_value=False), patch.object(m, "systemctl") as control:
            m.activate(release)
            control.assert_not_called()
            self.assertEqual(m.current(), previous)

    def test_missing_or_incomplete_release_keeps_installed_code(self):
        for assets in [[], [{"name": f"pokemon-card-bot-linux-arm64-{NEW}.tar.gz"}]]:
            with patch.object(m, "api", side_effect=[{"sha": NEW}, {"assets": assets}]):
                self.assertIsNone(m.published_head())

    def test_checksum_failure_does_not_switch_or_stop_bot(self):
        previous = self.release(OLD)
        m.point_to(previous)
        def download(url, destination, limit):
            destination.write_bytes(b"0" * 64 if url.endswith("sha256") else b"corrupt")
        with patch.object(m, "download", side_effect=download), patch.object(m, "systemctl") as control:
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                m.fetch(NEW)
            control.assert_not_called()
            self.assertEqual(m.current(), previous)
        self.assertFalse((self.root / "releases" / NEW).exists())

    def test_manifest_rejects_wrong_revision_and_architecture(self):
        release = self.release(NEW)
        with self.assertRaises(ValueError):
            m.manifest(release, OLD)
        (release / "BUILD.json").write_text(json.dumps({"sha": NEW, "platform": "linux", "arch": "x64"}))
        with self.assertRaises(ValueError):
            m.manifest(release, NEW)

    def test_environment_import_keeps_secrets_private_and_replaces_pc_paths(self):
        m.point_to(self.release(OLD))
        values = {"DISCORD_TOKEN": 'fake-$value-"quoted"-\\path', "DISCORD_CLIENT_ID": "123",
                  "INVOCATION_LOG_DIR": "C:\\old\\logs", "ATTRIBUTION": "line one\nline two"}
        with patch.object(m, "run", return_value=json.dumps(values)) as command:
            m.import_env(self.base / "source.env")
        text = self.env.read_text()
        self.assertIn('DISCORD_TOKEN="fake-$value-\\"quoted\\"-\\\\path"', text)
        self.assertIn(f'DATA_DIR="{self.data}"', text)
        self.assertIn(f'INVOCATION_LOG_DIR="{self.data.parent / "invocations"}"', text)
        self.assertEqual(self.env.stat().st_mode & 0o777, 0o600)
        self.assertEqual(command.call_args.kwargs["env"], {"PATH": "/usr/bin:/bin"})

    def test_failed_restore_copy_preserves_live_database(self):
        self.database("original")
        backup = self.root / "backups" / "snapshot"
        m.snapshot(backup)
        self.database("newer")
        with patch.object(m.shutil, "copyfileobj", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                m.restore(backup)
        self.assertEqual(self.value(), "newer")


if __name__ == "__main__":
    unittest.main()
