# Bike Coach working agreement

## Project records and source

- Work in this Git checkout. Read `README.md` and `docs/DEVELOPMENT.md` before changing the development workflow.
- GitHub source: https://github.com/joelsmeby/bike-coach
- Current Notion hub: https://app.notion.com/p/3efee7b8cda381faa796c34ea717c6b7
- Current backlog: https://app.notion.com/p/39694b8fc0474877b589a43caef4dbc3
- Use Notion for backlog, priorities, decisions and physical validation records. Do not create another Markdown backlog or use the duplicate historical Notion hub for new records.
- Current firmware lives in `firmware/OpenLog_Artemis_BikeCoach/`. Check callers before assuming another app/sketch copy is active.

## Changes and verification

- Inspect branch, current commit and existing local modifications before editing. Preserve unrelated work.
- Make focused changes on a branch and prepare a pull request. Review the diff and stage only intended files.
- Run checks appropriate to the change; use the commands in `package.json`. Report failures or unavailable tools explicitly.
- Record commit/PR, evidence and remaining work in the related Notion item before closing a task.
- Distinguish compiled code, simulated behavior, deployed website, uploaded firmware and physical validation.
- Keep original ride data intact; do not commit full personal rides or videos as incidental development artifacts.

## Explain the work

- Joel wants to learn through short, plain-language progress updates.
- Explain what is being done, why it helps, and what Joel needs to do, if anything.
- Define technical terms briefly when first used. Avoid assuming familiarity with engineering terminology.
- The assistant handles routine development and recordkeeping; Joel handles physical device, phone and ride checks when needed.
