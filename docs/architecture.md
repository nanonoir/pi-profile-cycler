# Architecture — minimal direct-spawn routing

The extension manages model routes, not orchestration. Pi owns the parent conversation and session history; mavam owns agent discovery, tools, instructions, graph execution and child lifetimes.

## Boundaries

| Module | Responsibility |
|---|---|
| `config.ts` | Pure schema validation, duplicate-key detection, `parentRoute` (main, else default) and content-based legacy migration. |
| `routing.ts` | Pure atomic batch transformation; only model/thinking change. |
| `switching.ts` | Real registry and model-thinking preflight; parent switch/readback/rollback; commit only after success. |
| `state.ts` | Last valid selection on the active branch; custom-entry format/version. |
| `discovery.ts` | Read-only listing of user and trusted project agent Markdown, mirroring mavam 0.39.0 `discoverProfiles`. |
| `editing.ts` | Pure immutable profile operations (create, delete, set route, set default profile), each returning a validated config. |
| `store.ts` | Stable serialization and the only file writer: validate, `.bak`, temp file, rename. |
| `model-picker.ts` | Fuzzy-search model picker (`ctx.ui.custom` + pi-tui), plain `select` fallback. |
| `manage.ts` | `/hprofile manage` dialog flow over injected load/write/reload/activate/pick/discover. |
| `index.ts` | Pi registration, config loading, commands/status, lifecycle reconciliation and pending idle activation. |

Importing does not register or read configuration. Calling the default export registers one extension. The root file forwards to `src/index.ts`; package metadata declares only that root entrypoint. The only runtime file write is `profile-cycler.json` (and its `.bak`) through `store.ts`, triggered only by an explicit confirmation in `/hprofile manage` (Save, Delete or Set as default). Agent Markdown is never written.

## Profiles and precedence

A profile may define `default`, `main` and any `agents` roles; it must define `main` or `default`. The orchestrator uses `main`, else `default`. For each direct spawn and each field (`model`, `thinking`): explicit request value → profile role route → profile `default` → native mavam (nothing injected). An explicit `model` without explicit `thinking` gets no injected thinking, since the route's level was chosen for another model; mavam resolves it (owner decision 2026-11-10). With a `default`, every direct subagent is routed, including roles that are not configured or not discovered.

## Profile editor

First run: when `profile-cycler.json` does not exist, the extension routes nothing (direct spawns pass through untouched), the status reads `profile: none (/hprofile manage)`, and `manage` offers only **New profile**; saving it creates the file (the compare-before-write check then requires the file to still be absent) and activates that profile. Any other read or validation error still fails closed.

`/hprofile manage` edits an in-memory draft of route changes and writes them only on Save; Delete and Set as default are profile-level actions that write after an explicit confirmation. Before writing it re-reads the file and refuses if it differs from the version the menu was built from, validates the schema and preflights the changed routes against Pi's registry and supported thinking; reload preflights every profile and names the offending one. If re-activating the selected profile fails, the file is saved but reported as not applied. Saving goes through the same reload path as `/hprofile reload`; if Pi is busy the file is saved and the user is told to reload. The menu re-reads the file each pass so a saved-but-unapplied edit is not overwritten by stale state. Model choices come from `modelRegistry.getAvailable()`, thinking from `getSupportedThinkingLevels`. Formatting of a hand-edited file is not preserved after a Save.

## Activation transaction

1. Validate configuration and resolve every declared route through Pi's registry and supported thinking levels.
2. If the parent is busy, retain current selection/routes and queue the latest valid request until `agent_settled` plus `isIdle()`, or the next `before_agent_start` request boundary. Branch restoration is distinct: after preflight its existing selection routes spawns immediately and exposes a pending parent route while tree navigation is busy.
3. Capture actual parent settings; apply model and thinking; verify both effective values.
4. Append a custom selection only if that name is not already the reachable selection. Then commit the in-memory name and status.
5. On failure, attempt to restore both parent settings; explicitly report incomplete rollback. Never append selection before success.

Pi model changes themselves produce history entries. The cycler cannot erase failed attempt history and does not rewrite it. Missing current parent models are refused because rollback cannot be guaranteed.

## Direct dispatch

Only `tool_call` for exact tool name `agent_spawn` is intercepted. Compute the entire routed agents array before touching the original input. Then assign only its `agents` property in place, as required by the published SDK execution contract. Explicit request `model`/`thinking` win per field; configured roles, then the profile `default`, fill only omitted fields (owner decisions 2026-11-09 and 2026-11-10, replacing the PRD's initial `profile-wins`). Unknown `profile` never falls back to `name`; without a `default`, unknown roles use native mavam behavior. Failed preflight blocks the spawn without partial injection.

## Session identity and overrides

Each extension instance owns its selected/config/pending state. Session lifecycle events reconstruct it from the current branch; session_start loads the file while session_tree reuses the cached validated configuration. A branch without a selection pins the configured default once; a missing/corrupt selection fails closed. Busy reconciliation is tracked separately as a routed-but-pending parent change; if its later activation fails, selected routing is cleared and direct spawns are blocked. The current branch is the only persistence source. Existing reachable selections are not redundantly appended on restore.

`before_agent_start` waits for any in-flight switch before permitting the provider request. Cancellable before-switch/fork/tree events refuse navigation during activation. Tree navigation already in progress is busy before its before-event; activation queues. A lifecycle generation check prevents stale selection commits. Shutdown marks the instance closed to activations and awaits the old transaction's rollback before returning, so the SDK cannot invalidate the runner before that work finishes. Restoration waits for the old transaction to unwind. Reload preserves pending intent, or explicitly cancels removed selections. Failed pending application also reports cancellation. No timers, polling or background jobs implement this coordination.

`session_start` reconciles startup/reload/new/resume/fork; `session_tree` reconciles branch navigation. Manual `/model` is an intentional parent-only override; the selected future-spawn profile remains unchanged, and `/hprofile status` exposes the distinction. Reactivation, reload or restoration reapplies the configured parent route. Existing children remain untouched.

## Evidence and non-goals

Original v1 behavior was characterized before refactoring and preserved byte-for-byte in fixtures: global Markdown writes and shared `active`, inverted historical names, missing Gemini roles; `test-local.cjs` was absent. Runtime writes were removed, not wrapped; the later profile editor reintroduced a single, explicit write path limited to the cycler's own JSON.

Published Pi SDK 1.5.0 tool execution and in-memory SessionManager are exercised without LLMs; extension tests use a mock API around those contracts. Actual mavam 0.39.0 spawn/helper resolvers are tested with disposable agent/project directories; its tool scheduler and real agent execution are not exercised. See [compatibility evidence](compatibility.md) for exact revisions and nested helper limitations. No claim of real provider or Windows TUI certification follows from these tests. The package is MIT-licensed and still marked private (not published to npm); publication and real smoke are separate gates.

The public pre-request hook does not reserve Pi's early prompt/auth/image preparation, nor can it veto the parent run on a failed pending switch. A request proceeds on the restored previous model with an explicit failure/cancellation notice. A hung SDK model change can hold this boundary indefinitely; imposing a competing forced rollback would introduce a worse race. These are documented SDK integration limits, not guarantees covered by mocks.
