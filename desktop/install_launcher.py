"""Build a native Finder launcher; analysis stays in the editable source tree."""
import json
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def install():
    if sys.platform != "darwin":
        raise RuntimeError("The Finder launcher must be built on macOS.")
    desktop = Path(__file__).resolve().parent
    root = desktop.parent
    build = root / ".local" / "finder-launcher-build"
    build.mkdir(parents=True, exist_ok=True)
    config = build / "workbench-launch.json"
    config.write_text(json.dumps({"desktop": str(desktop), "runtime": str(Path(sys.executable).absolute()),
                                 "log": str(root / ".local" / "desktop-workbench.log")}))
    destination = desktop / "dist"
    app = destination / "Bike Coach Workbench.app"
    legacy = root / ".local" / "Bike Coach Workbench.app"
    backup = root / ".local" / "launcher-backups" / datetime.now().strftime("%Y%m%d-%H%M%S")
    for source, name in [(app, "visible-wrapper.backup"), (legacy, "hidden-wrapper.backup")]:
        if source.is_dir() and not source.is_symlink():
            shutil.copytree(source, backup / name)
    setup = build / "setup.py"
    options = {"alias": True, "strip": False, "argv_emulation": False, "resources": [str(config)],
               "plist": {"CFBundleName": "Bike Coach Workbench", "CFBundleDisplayName": "Bike Coach Workbench",
                         "CFBundleIdentifier": "local.bikecoach.workbench.finder", "CFBundleVersion": "0.1.1",
                         "CFBundleShortVersionString": "0.1.1", "NSHighResolutionCapable": True}}
    setup.write_text("from setuptools import setup\nsetup(name='Bike Coach Workbench', app=[" +
                     repr(str(desktop / "finder_launcher.py")) + "], options={'py2app':" + repr(options) + "})\n")
    staging = build / "dist"
    subprocess.run([sys.executable, str(setup), "py2app", "--dist-dir", str(staging),
                    "--bdist-base", str(build / "work-py2app")], cwd=build, check=True)
    built = staging / "Bike Coach Workbench.app"
    if not built.is_dir():
        built = staging / "finder_launcher.app"
    if not built.is_dir():
        raise RuntimeError("App builder did not produce a launcher.")
    destination.mkdir(parents=True, exist_ok=True)
    if app.exists():
        app.rename(backup / "replaced-visible-wrapper.backup")
    shutil.move(str(built), app)
    subprocess.run(["/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
                    "-f", str(app)], check=True)
    if legacy.exists() and not legacy.is_symlink():
        legacy.rename(backup / "retired-hidden-wrapper.backup")
    if not legacy.exists():
        legacy.symlink_to(app, target_is_directory=True)
    print(f"Finder app: {app}")
    return app


if __name__ == "__main__":
    install()
