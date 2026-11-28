import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
MANAGE = ROOT / "deploy" / "manage.py"


class UnknownRecoveryPhase(unittest.TestCase):
    def test_unknown_phase_keeps_state_and_does_not_start_service(self):
        spec = importlib.util.spec_from_file_location("manage_under_test", MANAGE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory(prefix="qa-p3-recovery-") as tmp:
            root = Path(tmp)
            (root / "releases").mkdir()
            (root / "backups").mkdir()
            state = root / "update-state.json"
            release = root / "releases" / ("a" * 40)
            previous = root / "releases" / ("b" * 40)
            release.mkdir()
            previous.mkdir()
            payload = {"phase": "unrecognised", "release": release.name, "previous": previous.name, "backup": "checkpoint"}
            state.write_text(json.dumps(payload))
            events = []
            with (
                patch.object(module, "ROOT", root),
                patch.object(module, "STATE", state),
                patch.object(module, "current", return_value=release),
                patch.object(module, "systemctl", side_effect=lambda *args: events.append(list(args))),
                patch.object(module, "restore", side_effect=lambda *args: events.append(["restore"])),
                patch.object(module, "point_to", side_effect=lambda *args: events.append(["point_to"])),
            ):
                with self.assertRaises(SystemExit):
                    module.recover()
            self.assertEqual(json.loads(state.read_text()), payload)
            self.assertEqual(events, [])


if __name__ == "__main__":
    unittest.main()
