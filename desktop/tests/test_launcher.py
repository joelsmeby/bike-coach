import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("finder_launcher", Path(__file__).resolve().parents[1] / "finder_launcher.py")
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class LauncherTests(unittest.TestCase):
    def test_external_runtime_environment_is_clean(self):
        original = {"PATH": "/usr/bin:/bin", "HOME": "/example", "PYTHONHOME": "/frozen",
                    "PYTHONPATH": "/frozen/modules", "DYLD_LIBRARY_PATH": "/frozen/lib",
                    "LD_LIBRARY_PATH": "/frozen/lib", "LD_LIBRARY_PATH_ORIG": "/user/lib", "_PYI_ARCHIVE_FILE": "old"}
        clean = launcher.clean_environment(original)
        self.assertEqual(clean["PATH"], original["PATH"])
        self.assertEqual(clean["HOME"], original["HOME"])
        self.assertEqual(clean["LD_LIBRARY_PATH"], "/user/lib")
        for key in ["PYTHONHOME", "PYTHONPATH", "DYLD_LIBRARY_PATH", "_PYI_ARCHIVE_FILE"]:
            self.assertNotIn(key, clean)
        self.assertEqual(original["PYTHONHOME"], "/frozen")

    def test_paths_with_spaces_and_missing_source(self):
        with tempfile.TemporaryDirectory(prefix="bike launcher ") as directory:
            base = Path(directory)
            desktop = base / "project with spaces" / "desktop"
            (desktop / "bike_workbench").mkdir(parents=True)
            (desktop / "bike_workbench" / "__main__.py").write_text("")
            runtime = Path(sys.executable).absolute()
            (base / "workbench-launch.json").write_text(json.dumps({"desktop": str(desktop), "runtime": str(runtime), "log": str(base / "log.txt")}))
            source, interpreter, log = launcher.read_configuration(base)
            self.assertEqual(source, desktop)
            self.assertEqual(interpreter, runtime)
            (desktop / "bike_workbench" / "__main__.py").unlink()
            with self.assertRaisesRegex(FileNotFoundError, "Setup Bike Coach"):
                launcher.read_configuration(base)
