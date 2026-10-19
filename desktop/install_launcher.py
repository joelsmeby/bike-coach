"""Make a local macOS app launcher; source and isolated environment remain editable."""
import os
import plistlib
import shlex
import sys
from pathlib import Path


def install():
    desktop = Path(__file__).resolve().parent
    root = desktop.parent
    app = root / ".local" / "Bike Coach Workbench.app"
    macos = app / "Contents" / "MacOS"
    macos.mkdir(parents=True, exist_ok=True)
    launcher = macos / "BikeCoachWorkbench"
    runtime = str(Path(sys.executable).absolute())
    log = root / ".local" / "desktop-workbench.log"
    launcher.write_text("#!/bin/zsh\n" + "cd -- " + shlex.quote(str(desktop)) + "\n" +
                        "exec " + shlex.quote(runtime) + " -m bike_workbench \"$@\" >> " + shlex.quote(str(log)) + " 2>&1\n")
    os.chmod(launcher, 0o755)
    info = {"CFBundleExecutable": "BikeCoachWorkbench", "CFBundleIdentifier": "local.bikecoach.workbench",
            "CFBundleName": "Bike Coach Workbench", "CFBundleDisplayName": "Bike Coach Workbench",
            "CFBundlePackageType": "APPL", "CFBundleShortVersionString": "0.1.0",
            "NSHighResolutionCapable": True, "LSMinimumSystemVersion": "14.0"}
    with (app / "Contents" / "Info.plist").open("wb") as handle:
        plistlib.dump(info, handle)
    print(app)


if __name__ == "__main__":
    install()
