# Development checklist

## Before changing code

- Confirm the working directory, Git branch, current commit and existing local changes.
- Fetch GitHub before starting a new branch; do not overwrite unrelated local work.
- Read the current Notion hub and relevant backlog item. Use its current databases, not the historical duplicate hub.
- Keep the current product behavior as a baseline. Run relevant checks before and after changes.

## Before ending a task

- Review the diff and ensure only intended files are staged.
- Commit a coherent change with a message describing the result. Push it to a branch; use a pull request for review.
- Record the commit/PR, test evidence, limitations and next step in the related Notion record.
- Separate local implementation, GitHub publication, website deployment, device upload and physical validation. Do not report one as proof of another.
- Explain the result to Joel using ordinary words. Introduce a technical term only with a short explanation.

## Current source and data boundaries

- Current sketch: `firmware/OpenLog_Artemis_BikeCoach/`.
- The original v0.2.6 sketch is historical and lives under `archive/firmware/`. The separate locally modified experiment is preserved under `archive/local/`.
- Keep previous working copies under `archive/local/`, local backups under `.local/`, and generated packages under `dist/`. Preserve files before removing duplicates.
- The initial workspace backup is `.local/backups/before-workflow-2026-10-18.tar.gz`. This is a local recovery copy, not an off-machine backup.
- Full original ride files and video need backed-up private storage. Reference them from Notion; use small, intentional fixtures for automated tests.
- Executable protocol/file-format specifications belong in Git alongside the code. Product priorities and physical test outcomes belong in Notion.

## Physical validation

Every bench/ride result should identify the source commit, web version, firmware version, board, sensor configuration, phone/browser and original recording. Record the outcome and any uncertainty in Notion.

The current firmware targets 250 Hz and uses RTC timestamps with hundredth-second precision. Compilation does not verify actual sample rate, timing accuracy, gaps, clipping or BLE throughput.

## Deferred improvements

Candidate website deployments and higher-precision recording timestamps remain separate backlog work. Release packaging is documented in `docs/RELEASING.md`; main-branch protection requires both automated check jobs. Archiving and packaging do not change recording or analysis behavior.
