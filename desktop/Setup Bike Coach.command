#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"
runtime="../.local/desktop-venv/bin/python"
if [[ ! -x "$runtime" ]]; then
  echo "Installing the local desktop environment (requires Python 3.12 or later)."
  python3 -c 'import sys; assert sys.version_info >= (3, 12), "Python 3.12 or later is required"'
  python3 -m venv ../.local/desktop-venv
fi
"$runtime" -m pip install -r requirements.txt
"$runtime" -m pip install -r requirements-build.txt
"$runtime" install_launcher.py
echo "Setup complete. Open desktop/dist/Bike Coach Workbench.app, or Open Bike Coach.command."
read -r "reply?Press Return to close. "
