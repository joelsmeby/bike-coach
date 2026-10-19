"""Small native Finder entry point; execute the editable project environment."""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def clean_environment(environment):
    """Do not leak the frozen launcher's library paths into external Python."""
    clean = dict(environment)
    for key in ("PYTHONHOME", "PYTHONPATH"):
        clean.pop(key, None)
    for key in ("DYLD_LIBRARY_PATH", "LD_LIBRARY_PATH"):
        original = clean.pop(key + "_ORIG", None)
        clean.pop(key, None)
        if original:
            clean[key] = original
    for key in list(clean):
        if key.startswith("_PYI_"):
            clean.pop(key)
    clean["PYINSTALLER_RESET_ENVIRONMENT"] = "1"
    return clean


def read_configuration(directory):
    config = json.loads((Path(directory) / "workbench-launch.json").read_text())
    desktop, runtime = Path(config["desktop"]), Path(config["runtime"])
    if not (desktop / "bike_workbench" / "__main__.py").is_file():
        raise FileNotFoundError(f"Analysis source not found: {desktop}. Run Setup Bike Coach.command again if the project moved.")
    if not runtime.is_file() or not os.access(runtime, os.X_OK):
        raise FileNotFoundError(f"Python environment not found: {runtime}. Run Setup Bike Coach.command again.")
    return desktop, runtime, Path(config["log"])


def main():
    desktop, runtime, log = read_configuration(Path(os.environ.get("RESOURCEPATH", Path(__file__).parent)))
    log.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    os.dup2(fd, 1)
    os.dup2(fd, 2)
    if fd > 2:
        os.close(fd)
    os.write(2, f"\nFinder launch {datetime.now(timezone.utc).isoformat()}\n".encode())
    os.chdir(desktop)
    os.execve(str(runtime), [str(runtime), "-X", "faulthandler", "-m", "bike_workbench", *sys.argv[1:]],
              clean_environment(os.environ))


if __name__ == "__main__":
    main()
