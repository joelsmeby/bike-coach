#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"
runtime="../.local/desktop-venv/bin/python"
if [[ ! -x "$runtime" ]]; then
  echo "Run Setup Bike Coach.command once to install the desktop dependencies."
  read -r "reply?Press Return to close. "
  exit 1
fi
exec "$runtime" -m bike_workbench "$@"
