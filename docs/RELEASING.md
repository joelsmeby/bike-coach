# Installation packages and releases

## In everyday terms

A release is a labeled set of downloads tied to an exact saved version of the project. Keep the label with the files so we can identify, reinstall or investigate that version later.

Each set includes a webpage ZIP, an Arduino firmware-source ZIP, installation instructions, a file list and file fingerprints (SHA-256). The label includes the web version, firmware version and source commit. The firmware ZIP is source for Arduino IDE, not an automatically uploaded device image.

## Generate and check packages

```sh
pnpm package
pnpm package:verify
```

The first command reads files from the saved Git commit, not unsaved working-folder edits, and writes `dist/web-VERSION-fw-VERSION-COMMIT/`. Existing output is not overwritten. To package another saved version or choose a new output directory:

```sh
pnpm package --ref COMMIT_OR_TAG --out NEW_DIRECTORY
pnpm package:verify NEW_DIRECTORY
```

Set `BIKECOACH_GIT` to a working Git executable if the system `git` is unavailable. Package verification checks file fingerprints and runs the browser workflow against the extracted webpage ZIP.

## Publish a candidate

After this workflow is merged, open GitHub Actions → Packages and release → Run workflow. Select `main`. With Publish unchecked, this generates checked downloads under the run's artifacts. With Publish checked, it runs all checks and creates a candidate GitHub Release. The assistant can handle these steps when requested.

Publication waits for both software and Artemis checks. It uses a commit-specific tag and refuses an existing release instead of replacing its downloads. It does not deploy a new webpage or upload firmware. Normal merges may still trigger the existing Pages deployment.

## Physical evidence and recovery

Keep the candidate label until the intended board/phone/ride tests are documented in Notion. Do not interpret a successful compile as a physical validation result. Publish future versions separately so older downloads remain available.

For rollback, identify the previous recorded release first. Website rollback must preserve the site's address and consider stored-data compatibility. Firmware rollback requires an intentional upload of that version's sketch. The assistant should explain and verify the selected version before carrying out either action.
