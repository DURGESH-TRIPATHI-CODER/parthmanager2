# ParthSeva Manager

Offline-first Windows desktop app for managing daily ParthSeva Excel files.

- **Electron + React + TypeScript + Vite**, packaged for Windows with **electron-builder** (NSIS installer).
- Fully local: no backend, no cloud, no telemetry. Contact data never leaves the machine.
- The app **prepares and manages the message queue only**. Actual sending is done by the *existing* Chrome extension — this app is not a WhatsApp automation system.

## Features

| Area | What it does |
| --- | --- |
| Daily file discovery | Finds today's file inside `<root>/<MonthName>/` by matching the date **anywhere in the filename** (`02-10-2026`, `02_10_2026`, `02.10.2026`, `02 October 2026`, `2 Oct 2026`, `October 02 2026`, `2026-10-02`, …). Ignores `~$` temp files. 0 matches → clear empty state; 1 match → auto-select; multiple → **always asks**, never guesses. |
| Excel/CSV import | SheetJS reads `.xlsx/.xls/.csv`. Multi-worksheet picker, intelligent header-row detection (changeable), raw data preview. |
| Column mapping | Dropdowns for Name / Phone / Action / Birthday / Message with automatic suggestions (`Full Name → Name`, `Mobile Number → Phone`, `DOB → Birthday`, …). Suggestions are pre-filled but the user confirms. Mappings are saved per header-signature and reused when the same structure appears; a changed structure triggers remapping. |
| Classification | Normalizes action values (`MESSAGE`, `WHATSAPP`, `WHATSAPP MESSAGE`, `SMS` → **message**; `CALL`, `PHONE`, `PHONE CALL` → **call**). Unknown values go to **Needs Review** — never guessed. Three queues with search, filtering, invalid/missing-row validation, and duplicate-phone highlighting. |
| Templates | User-written templates with `{name}`, `{phone}`, `{birthday}`, `{date}` variables. Multiple named templates, edit/delete, stored locally. Unknown variables are highlighted, never silently removed. **No default message is ever generated.** |
| Queue & hand-off | Explicit confirmation screen ("Messages Ready") → user must click send. Duplicate warning before hand-off. Queue is validated in the main process and stored under `userData/queue-sessions/` as the defined hand-off format (`EXTENSION_BRIDGE.md`). Statuses: pending / sending / sent / failed / skipped. |

## Development

```powershell
npm install       # once
npm run dev       # Vite dev server + Electron with hot reload
```

Other scripts:

```powershell
npm run typecheck # tsc for main + renderer
npm test          # vitest unit tests (filename date matching etc.)
npm run smoke     # boots the real Electron main process headlessly and exits
npm run build     # typecheck + compile main + build renderer into dist/
```

## Building the Windows installer

```powershell
npm run dist      # full build + NSIS installer into release/
npm run dist:dir  # unpacked app (faster, for quick checks)
```

Output: `release/ParthSeva Manager Setup <version>.exe` — a normal per-user installer with desktop and Start-menu shortcuts and an uninstaller. End users need **only this .exe**: no Node.js, no Python, no npm, no terminal.

### CI build (GitHub Actions)

`.github/workflows/build-windows.yml` builds the installer on every push to `main` (and manually via *Run workflow*). Grab the artifact:

> GitHub → **Actions** → *Build ParthSeva Manager* → latest run → **Artifacts** → `ParthSeva-Manager-Windows` → download ZIP containing the Setup .exe

The workflow runs typecheck + tests + build before packaging, so a broken commit fails loudly.

## Architecture / security model

```
React renderer (src/)          preload bridge (electron/preload)       main process (electron/main)
UI only, no Node    --IPC-->   contextBridge, typed API only  --IPC-->  fs, dialogs, xlsx parsing,
                                                                        settings/mappings/templates,
                                                                        queue sessions, hand-off probe
```

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- The renderer sees only `window.parthseva` — a small typed API; no `fs`, no shell, no raw `ipcRenderer`.
- IPC handlers validate inputs; workbook reads are restricted to the configured ParthSeva root.
- Extension hand-off: the app probes for an existing bridge (localhost API on 127.0.0.1 ports 57321-57323, then native-messaging manifests) and only ever writes the queue locally. No remote transmission, no auto-send, no arbitrary code execution from queue data.

## Where settings live

Per-user JSON files under `%APPDATA%/ParthSeva Manager/`:

| File | Purpose |
| --- | --- |
| `settings.json` | configured ParthSeva root folder |
| `column-mappings.json` | saved column mappings keyed by header signature |
| `templates.json` | user message templates |
| `queue-sessions/*.json` | handed-off queues (retained locally for the session) |
| `EXTENSION_BRIDGE.md` | the queue hand-off format for the Chrome extension author |

## Project layout

```
electron/
  main/        main.ts, ipc.ts, fileFinder.ts, excel.ts, settings.ts, store.ts, handoff.ts, bridgeDoc.ts
  preload/     index.ts (contextBridge API)
  shared/      types.ts (IPC contract), dateMatch.ts (+tests), headers.ts, normalizeAction.ts,
               phone.ts, template.ts, classify.ts
src/           App.tsx, screens/ (Setup, Dashboard, Import, Templates, Queue, Settings), components/ (arc/, spaceui/)
```
