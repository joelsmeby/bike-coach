# Bike Coach

Bike Coach records bike motion on an OpenLog Artemis and uses a phone webpage to download and analyze rides.

## The three places we use

- **This folder is the workbench.** Edit and build code here.
- **[GitHub](https://github.com/joelsmeby/bike-coach) is the save history.** A commit is a named save point. A branch keeps a proposed change separate. A pull request is the place to inspect that change before accepting it.
- **[Notion](https://app.notion.com/p/3efee7b8cda381faa796c34ea717c6b7) is the project notebook.** Keep the backlog, priorities, decisions and physical test results there.

## Which files are official?

The webpage starts at `index.html` and currently loads `app-v4.js`. The analyzer starts at `analyzer.html`. Upload firmware from **`firmware/OpenLog_Artemis_BikeCoach/OpenLog_Artemis_BikeCoach.ino`**.

Older sketches and application versions are under `archive/`. Local ZIPs and extracted copies are retained under `archive/local/` and excluded from Git. Do not use those copies as the source of a new change. The source versions are web 5.2.4 and firmware 0.2.12; build and physical validation are separate facts. Consult GitHub and Notion for the status of a particular release.

Download installation packages from [GitHub Releases](https://github.com/joelsmeby/bike-coach/releases). Each package identifies its web version, firmware version and source commit. See [release instructions](docs/RELEASING.md) for generation, verification and recovery.

## Automatic checks

These instructions are for setting up development. Joel does not need to run these commands for normal riding.

Use Node.js from `.node-version` and pnpm from `package.json`. Install pnpm with `npm install --global pnpm@11.25.0` if needed, then:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm test
pnpm test:browser
pnpm test:firmware
pnpm firmware:build
pnpm package
pnpm package:verify
```

- `test`: fast checks of GPS association, file naming and Bluetooth messages.
- `test:browser`: opens an automated browser and simulates recording/download/export and chart use. It does not connect to the bike.
- `test:firmware`: checks firmware commands using a desktop C++ compiler (`g++`). macOS needs Command Line Tools; Ubuntu CI provides the compiler.
- `firmware:build`: checks that the current sketch can be compiled with the versions in `sketch.yaml`. Requires Arduino CLI 1.5.1 (bundled with the installed Arduino IDE). The first build downloads its pinned dependencies. It does not upload firmware.
- `package` and `package:verify`: create installation ZIPs from a saved commit, check their file fingerprints and exercise the extracted webpage in an automated browser.

The same checks run on GitHub pull requests. The main branch requires passing software/browser checks and the Artemis build before merging. A second person's approval is not required for this solo project. A successful website deployment is a separate check; it does not prove that the bike hardware works.

## How we make a change

1. Pick a Notion backlog item and describe what success looks like.
2. Start a branch from the current GitHub `main` and change one thing at a time.
3. Run the relevant checks and inspect the changed files.
4. Push the branch and open a pull request linked to Notion.
5. Merge after the checks pass and the change has been reviewed. The existing Pages setup may deploy a merge; do not merge a setup change casually.
6. Record device tests separately. Firmware compilation cannot prove battery startup, sample timing, transfer speed or real riding accuracy.

The assistant should perform the bookkeeping and explain progress in everyday language. Joel supplies product decisions and physical device/phone/ride tests when requested.

See [the development checklist](docs/DEVELOPMENT.md) for the handoff details.
