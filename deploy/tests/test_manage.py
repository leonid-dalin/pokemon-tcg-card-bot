import importlib.util
import json
from pathlib import Path
import shutil
import sqlite3
import tarfile
import tempfile
import unittest
from types import SimpleNamespace
from subprocess import CalledProcessError
from time import time_ns
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
                        patch.object(m, "wait_ready", return_value=None),
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

    def test_failed_snapshot_restarts_the_previous_release(self):
        previous, release = self.release(OLD), self.release(NEW)
        m.point_to(previous)
        with patch.object(m, "active", return_value=True), patch.object(m, "systemctl") as control, \
                patch.object(m, "snapshot", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                m.activate(release)
            self.assertEqual(m.current(), previous)
            self.assertEqual(control.call_args_list[-1].args, ("start", m.SERVICE))
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

    def test_prepared_phase_recovery_restarts_the_previous_release(self):
        previous, release = self.release(OLD), self.release(NEW)
        m.point_to(previous)
        self.database("live")
        m.atomic_json(m.STATE, {"phase": "prepared", "release": release.name,
                                "previous": previous.name, "backup": "planned"})
        with patch.object(m, "active", return_value=False), patch.object(m, "systemctl") as control:
            m.recover()
        self.assertEqual(m.current(), previous)
        self.assertEqual(self.value(), "live")
        self.assertEqual(control.call_args_list[-1].args, ("start", m.SERVICE))
        self.assertFalse(m.STATE.exists())

    def test_ready_recovery_does_not_restore_over_the_new_release(self):
        previous, release = self.release(OLD), self.release(NEW)
        m.point_to(release)
        self.database("new-settings")
        backup = self.root / "backups" / "ready"
        m.snapshot(backup)
        (backup / "previous").write_text(previous.name)
        self.database("accepted-by-new-release")
        m.atomic_json(m.STATE, {"phase": "ready", "release": release.name,
                                "previous": previous.name, "backup": backup.name})
        with patch.object(m, "active", return_value=False), patch.object(m, "systemctl") as control, \
                patch.object(m.os, "chown"):
            m.recover()
        self.assertEqual([call.args for call in control.call_args_list], [("start", m.SERVICE)])
        self.assertEqual(m.current(), release)
        self.assertEqual(self.value(), "accepted-by-new-release")
        self.assertFalse(m.STATE.exists())

    def test_recovery_rejects_an_unusable_checkpoint_before_stopping(self):
        release = self.release(NEW)
        previous = self.release(OLD)
        m.point_to(release)
        for prepare in (lambda b: (b / "snapshot.json").write_text("not json"),
                       lambda b: (b / "snapshot.json").write_text('{"settingsExisted": true}'),
                       lambda b: (b / "snapshot.json").write_text("[]")):
            backup = self.root / "backups" / f"bad-{time_ns()}"
            m.snapshot(backup)
            (backup / "previous").write_text(OLD)
            prepare(backup)
            (backup / "settings.db").unlink(missing_ok=True)
            m.atomic_json(m.STATE, {"phase": "switched", "release": release.name,
                                    "previous": OLD, "backup": backup.name})
            with patch.object(m, "active", return_value=True), patch.object(m, "systemctl") as control:
                with self.assertRaisesRegex(RuntimeError, "missing or invalid"):
                    m.recover()
            self.assertEqual(control.call_args_list, [])

    def test_activation_failure_keeps_the_original_error_when_recovery_start_fails(self):
        previous, release = self.release(OLD), self.release(NEW)
        m.point_to(previous)
        self.database("original")
        def fail():
            raise RuntimeError("readiness timeout")
        with patch.object(m, "active", return_value=True), patch.object(m.os, "chown"), \
                patch.object(m, "wait_ready", side_effect=fail), \
                patch.object(m, "finish_recovery", side_effect=CalledProcessError(1, "start")), \
                patch.object(m, "systemctl"):
            with self.assertRaisesRegex(RuntimeError, "readiness timeout"):
                m.activate(release)
        self.assertTrue(m.STATE.exists())

    def test_recovery_keeps_settings_accepted_after_the_rollback_switched(self):
        previous, release = self.release(OLD), self.release(NEW)
        m.point_to(previous)
        self.database("before-upgrade")
        with patch.object(m, "active", return_value=True), patch.object(m, "systemctl"), \
                patch.object(m, "wait_ready"), patch.object(m.os, "chown"):
            m.activate(release)
        self.database("newer")
        with patch.object(m, "active", return_value=True), patch.object(m, "systemctl"), \
                patch.object(m, "finish_recovery", side_effect=RuntimeError("power loss")), \
                patch.object(m.os, "chown"):
            with self.assertRaises(RuntimeError):
                m.rollback()
        self.assertEqual(m.current(), previous)
        self.assertEqual(json.loads(m.STATE.read_text())["phase"], "manual")
        self.database("acknowledged-by-restored-bot-after-reboot")
        with patch.object(m, "active", return_value=False), patch.object(m, "systemctl") as control, \
                patch.object(m.os, "chown"):
            m.recover()
        self.assertEqual(self.value(), "acknowledged-by-restored-bot-after-reboot")
        self.assertEqual(m.current(), previous)
        self.assertFalse(m.STATE.exists())
        self.assertEqual([call.args for call in control.call_args_list], [("start", m.SERVICE)])

    def test_interrupted_rollback_without_prerequisites_keeps_the_service_running(self):
        previous, release = self.release(OLD), self.release(NEW)
        m.point_to(release)
        self.database("newer")
        m.atomic_json(m.STATE, {"phase": "manual", "release": release.name,
                                "previous": previous.name, "backup": "gone"})
        with patch.object(m, "active", return_value=True), patch.object(m, "systemctl") as control:
            with self.assertRaises(RuntimeError):
                m.recover()
        self.assertEqual(control.call_args_list, [])
        self.assertTrue(m.STATE.exists())
        self.assertEqual(self.value(), "newer")

    def test_recovery_stops_an_auto_restart_unit_before_restoring(self):
        previous, release = self.release(OLD), self.release(NEW)
        m.point_to(release)
        self.database("original")
        backup = self.root / "backups" / "activating"
        m.snapshot(backup)
        (backup / "previous").write_text(previous.name)
        m.atomic_json(m.STATE, {"phase": "switched", "release": release.name,
                                "previous": previous.name, "backup": backup.name})
        with patch.object(m, "active", return_value=False), patch.object(m, "systemctl") as control, \
                patch.object(m.os, "chown"):
            m.recover()
        self.assertEqual(control.call_args_list[0].args, ("stop", m.SERVICE))
        self.assertEqual(control.call_args_list[-1].args, ("start", m.SERVICE))
        self.assertEqual(m.current(), previous)

    def test_failed_recovery_start_keeps_transaction_for_retry(self):
        previous, release = self.release(OLD), self.release(NEW)
        m.point_to(release)
        self.database("original")
        backup = self.root / "backups" / "pending"
        m.snapshot(backup)
        (backup / "previous").write_text(previous.name)
        m.atomic_json(m.STATE, {"phase": "switched", "release": release.name,
                                "previous": previous.name, "backup": backup.name})
        with patch.object(m, "active", return_value=False), patch.object(m.os, "chown"), \
                patch.object(m, "systemctl", side_effect=[None, CalledProcessError(1, "start")]):
            with self.assertRaises(CalledProcessError):
                m.recover()
        self.assertTrue(m.STATE.exists())
        self.assertEqual(m.current(), previous)
        with patch.object(m, "active", return_value=False), patch.object(m, "systemctl") as control, \
                patch.object(m.os, "chown"):
            m.recover()
        self.assertEqual(control.call_args_list[-1].args, ("start", m.SERVICE))
        self.assertFalse(m.STATE.exists())
        self.assertEqual(self.value(), "original")

    def test_interrupted_manual_rollback_completes_on_the_next_run(self):
        previous, release = self.release(OLD), self.release(NEW)
        m.point_to(previous)
        self.database("original")
        with patch.object(m, "active", return_value=True), patch.object(m, "systemctl"), \
                patch.object(m, "wait_ready"), patch.object(m.os, "chown"):
            m.activate(release)
        self.database("newer")
        with patch.object(m, "active", return_value=True), patch.object(m, "systemctl"), \
                patch.object(m, "finish_recovery", side_effect=RuntimeError("killed")), \
                patch.object(m.os, "chown"):
            with self.assertRaises(RuntimeError):
                m.rollback()
        self.assertTrue(m.STATE.exists())
        self.assertEqual(json.loads(m.STATE.read_text())["phase"], "manual")
        self.assertEqual(m.current(), previous)
        with patch.object(m, "active", return_value=False), patch.object(m, "systemctl") as control, \
                patch.object(m.os, "chown"):
            m.recover()
        self.assertEqual(control.call_args_list[-1].args, ("start", m.SERVICE))
        self.assertFalse(m.STATE.exists())
        self.assertEqual(m.current(), previous)
        self.assertEqual(self.value(), "original")

    def test_recovery_with_missing_previous_never_stops_the_service(self):
        release = self.release(NEW)
        m.point_to(release)
        backup = self.root / "backups" / "missing-previous"
        m.snapshot(backup)
        m.atomic_json(m.STATE, {"phase": "switched", "release": release.name,
                                "previous": OLD, "backup": backup.name})
        with patch.object(m, "active", return_value=True), patch.object(m, "systemctl") as control:
            with self.assertRaises(RuntimeError):
                m.recover()
        self.assertEqual(control.call_args_list, [])
        self.assertTrue(m.STATE.exists())
        self.assertEqual(m.current(), release)

    def test_switch_intent_with_previous_selected_keeps_live_settings(self):
        previous, release = self.release(OLD), self.release(NEW)
        m.point_to(previous)
        self.database("acknowledged-after-boot")
        backup = self.root / "backups" / "stale"
        m.snapshot(backup)
        (backup / "previous").write_text(previous.name)
        m.atomic_json(m.STATE, {"phase": "switched", "release": release.name,
                                "previous": previous.name, "backup": backup.name})
        with patch.object(m, "active", return_value=True), patch.object(m, "systemctl") as control:
            m.recover()
        self.assertEqual(m.current(), previous)
        self.assertEqual(self.value(), "acknowledged-after-boot")
        self.assertFalse((self.root / "failed-revision").exists())
        self.assertEqual(control.call_args_list[-1].args, ("start", m.SERVICE))
        self.assertFalse(m.STATE.exists())

    def test_failed_activation_restore_keeps_pending_state_and_new_release(self):
        previous, release = self.release(OLD), self.release(NEW)
        m.point_to(previous)
        self.database("original")
        def fail_neediness(*args):
            raise RuntimeError("readiness timeout")
        with patch.object(m, "active", return_value=True), patch.object(m, "systemctl") as control, \
                patch.object(m, "wait_ready", side_effect=fail_neediness), \
                patch.object(m.shutil, "copyfileobj", side_effect=OSError("disk full")), \
                patch.object(m.os, "chown"):
            with self.assertRaises(OSError):
                m.activate(release)
        self.assertEqual(m.current(), release)
        self.assertEqual(control.call_args_list[-1].args, ("stop", m.SERVICE))
        self.assertTrue(m.STATE.exists())
        self.assertEqual((self.root / "failed-revision").read_text(), NEW)

    def test_acknowledged_settings_survive_a_failed_activation(self):
        previous, release = self.release(OLD), self.release(NEW)
        m.point_to(previous)
        self.database("before-snapshot")
        def stop_writes_final_setting(*args):
            if args == ("stop", m.SERVICE):
                self.database("acknowledged-before-stop")
        with patch.object(m, "active", return_value=True), \
                patch.object(m, "systemctl", side_effect=stop_writes_final_setting), \
                patch.object(m, "wait_ready", side_effect=RuntimeError("readiness timeout")), \
                patch.object(m.os, "chown"):
            with self.assertRaisesRegex(RuntimeError, "readiness"):
                m.activate(release)
            self.assertEqual(self.value(), "acknowledged-before-stop")

    def test_recovery_reconciles_a_checkpointed_phase_with_a_switched_link(self):
        previous, release = self.release(OLD), self.release(NEW)
        m.point_to(previous)
        backup = self.root / "backups" / "gap"
        self.database("original")
        m.snapshot(backup)
        m.begin_activation(release, previous, backup)
        (backup / "previous").write_text(previous.name)
        m.point_to(release)
        with patch.object(m, "active", return_value=True), patch.object(m, "systemctl"), \
                patch.object(m.os, "chown"):
            m.recover()
        self.assertEqual(m.current(), previous)
        self.assertEqual(self.value(), "original")
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

    def test_rollback_with_missing_checkpoint_database_never_stops_the_bot(self):
        previous, release = self.release(OLD), self.release(NEW)
        m.point_to(previous)
        self.database("original")
        with patch.object(m, "active", return_value=True), patch.object(m, "systemctl"), \
                patch.object(m, "wait_ready"), patch.object(m.os, "chown"):
            m.activate(release)
        backup = next((self.root / "backups").iterdir())
        (backup / "settings.db").unlink()
        with patch.object(m, "systemctl") as control:
            with self.assertRaisesRegex(RuntimeError, "unusable"):
                m.rollback()
            control.assert_not_called()
        self.assertEqual(m.current(), release)
        self.assertEqual(self.value(), "original")

    def test_failed_restore_restarts_the_unchanged_installed_release(self):
        previous, release = self.release(OLD), self.release(NEW)
        m.point_to(previous)
        self.database("original")
        with patch.object(m, "active", return_value=True), patch.object(m, "systemctl"), \
                patch.object(m, "wait_ready"), patch.object(m.os, "chown"):
            m.activate(release)
        self.database("newer")
        with patch.object(m.shutil, "copyfileobj", side_effect=OSError("disk full")), \
                patch.object(m, "systemctl") as control:
            with self.assertRaises(OSError):
                m.rollback()
            self.assertNotIn(("start", m.SERVICE), control.call_args_list)
        self.assertEqual(m.current(), release)
        self.assertEqual(self.value(), "newer")
        self.assertTrue(m.STATE.exists())

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
        complete = [{"name": f"pokemon-card-bot-linux-arm64-{NEW}.tar.gz"},
                    {"name": f"pokemon-card-bot-linux-arm64-{NEW}.tar.gz.sha256"}]
        for assets in [[], complete[:1]]:
            with patch.object(m, "api", side_effect=[{"sha": NEW}, [
                {"tag_name": "t", "assets": assets, "draft": False},
            ]]):
                self.assertIsNone(m.published_head())

    def test_published_tag_finds_a_release_by_its_assets(self):
        assets = [{"name": f"pokemon-card-bot-linux-arm64-{NEW}.tar.gz"},
                  {"name": f"pokemon-card-bot-linux-arm64-{NEW}.tar.gz.sha256"}]
        with patch.object(m, "api", side_effect=[[
            {"tag_name": "ptcg-discord-bot-0.1.0.20261029.2210-linux-arm64", "assets": assets, "draft": False},
        ]]):
            self.assertEqual(m.published_tag(NEW), "ptcg-discord-bot-0.1.0.20261029.2210-linux-arm64")

    def test_published_tag_reads_releases_in_the_old_schemes_too(self):
        assets = [{"name": f"pokemon-card-bot-linux-arm64-{OLD}.tar.gz"},
                  {"name": f"pokemon-card-bot-linux-arm64-{OLD}.tar.gz.sha256"}]
        with patch.object(m, "api", side_effect=[[
            {"tag_name": f"ptcg-discord-bot-0.1.0.20261029.2210-linux-arm64", "assets": [], "draft": False},
            {"tag_name": f"linux-arm64-{OLD[:7]}", "assets": assets, "draft": False},
        ]]):
            self.assertEqual(m.published_tag(OLD), f"linux-arm64-{OLD[:7]}")

    def test_published_tag_skips_drafts_and_incomplete_releases(self):
        complete = [{"name": f"pokemon-card-bot-linux-arm64-{NEW}.tar.gz"},
                    {"name": f"pokemon-card-bot-linux-arm64-{NEW}.tar.gz.sha256"}]
        with patch.object(m, "api", side_effect=[[
            {"tag_name": "draft-tag", "assets": complete, "draft": True},
            {"tag_name": "partial-tag", "assets": complete[:1], "draft": False},
        ]]):
            self.assertIsNone(m.published_tag(NEW))

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
