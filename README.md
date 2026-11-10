# Pi Agents Profile Cycler

A small, independent Pi extension for `mavam/pi-agents`: switch the parent model/thinking and the routes of **new direct spawns**, without editing agent Markdown or global active state. First package version: 1.0.0; configuration schema: 2. Private and UNLICENSED until the owner chooses a license.

**Development build, not a certified release.** Pi 1.5.0 tool/session contracts and mavam v0.39.0 spawn/helper resolvers are tested locally without starting agents. Real provider calls, Windows TUI and mavam end-to-end smoke remain unverified. [Compatibility evidence](docs/compatibility.md) · [remaining smoke checks](docs/manual-testing.md) · [PRD](docs/pi-agents-profile-cycler.md).

## Try locally without changing global Pi

Requires Node 24, Pi 1.5.x and the existing mavam runtime. Development installs only SDK/test dependencies, not a second subagent runtime:

```sh
npm ci
npm test
npm run typecheck
```

For an actual smoke, follow the disposable-harness checklist first. Do not load the historical fixture extension. Do not load both `src/index.ts` and the root entrypoint: both register the same shortcut/command.

## Optional installation (owner action, not performed during development)

1. Disable any older cycler extension before enabling this one. Back up and manually inspect agent Markdown if the old v1 modified it; this package does not restore those files automatically.
2. Keep the repository directory intact. Install that directory as a local Pi package (`pi install <absolute-repository-path>`), **or** load just its root `pi-profile-cycler.ts` with Pi's extension option. Do not copy the root file alone: it imports `src/`.
3. Copy `examples/profile-cycler.json` to Pi's agent directory as `profile-cycler.json` **only if no personal file already exists**. Normally this is `~/.pi/agent`; a disposable harness should use a separate agent directory. Nothing creates or overwrites this file automatically.
4. Verify every configured ID against your model registry/provider setup. The example IDs come from the PRD; their presence is not guaranteed.
5. Reload Pi, then inspect `/hprofile status` before delegating.

For updates, keep the personal JSON and update only the package source. On uninstall, remove the package through Pi (or remove the explicit extension path) and reload; the optional JSON can be removed manually. Session history is retained. This does not reverse model changes already recorded in a conversation.

## Use

| Action | Behavior |
|---|---|
| Alt+M / `/hprofile next` | Cycle `balanced → claude → codex`, or the JSON's configured order. Tab remains untouched. Alt+P is not used: on Windows Pi reserves it for "previous model" and silently skips extension shortcuts on it. |
| `/hprofile` | Select from a TUI menu; in non-UI mode list choices. |
| `/hprofile <name>` | Activate a named profile after validating every declared route. |
| `/hprofile status` | Selected/pending profile, actual parent model/thinking, configured parent and future direct routes. |
| `/hprofile reload` | Validate edited JSON and all routes. Keep selected name and reapply its updated parent route. On failure retain the previous configuration. If the name was removed, require explicit selection and block direct spawns meanwhile. Busy reloads are refused with a retry instruction. |

Busy selections remain pending until Pi's `agent_settled` boundary plus idle recheck, or `before_agent_start` before the next request; the latest valid requested selection wins. Until then, the old profile routes new direct spawns. Reload preserves pending intent unless its name or selected profile was removed, in which case it explicitly notifies cancellation. Failed pending application is also explicitly cancelled, not retried forever. Preflight failure never queues a request or silently chooses another provider. Provider exhaustion is not detected or handled automatically.

## Routing and session policy

- `agent.profile` takes precedence. Only if absent, an exact configured `agent.name` may match. Unknown profiles/roles retain native mavam routing; `teacher` is untouched unless explicitly configured.
- **Explicit wins:** a non-empty `model` or `thinking` in the `agent_spawn` request is kept (so "spawn the implementer with model X" works); the profile fills only missing fields. The orchestrator can therefore bypass the profile whenever it sends a model. Explicit values are not preflighted by the cycler; mavam/Pi reject unknown models. Jobs, graph dependencies, instructions, tools, skills and all other arguments are preserved. Already-created agents never migrate.
- Nested helper routing is **unsupported**: mavam uses a separate internal path. No monkeypatch or replacement runtime is used.
- Each new branch without a selection pins `defaultProfile` once via a custom session entry. Restore reads only `getBranch()`, never unrelated branches.
- Startup, `/resume`, `/reload`, new session and `/fork` restore the current branch. `/tree` uses the cached validated configuration, not unsaved/unreloaded edits, and reconciles its routes after preflight; because Pi emits that event while navigation is still busy, the parent route is marked pending until a settled/next-request boundary. If that reconciliation fails, routing becomes unavailable and direct spawns are blocked until explicit selection. Restoring an existing selection writes no duplicate selection entry. Missing restored profiles never borrow another window's selection.
- Manual `/model` changes the actual parent only; the selected future-spawn profile remains selected. `status` shows both. Explicit activation, configuration reload or lifecycle restoration reapplies the profile's configured parent route.

New parent requests wait at `before_agent_start` for an in-flight switch; session/tree/fork navigation is temporarily cancelled with a retry notice during that switch. Shutdown/reload waits for any interrupted transaction to unwind before Pi invalidates its API. Pi's early prompt/auth/image preparation happens before the request hook and is not gated. A hung `setModel` also holds request/shutdown boundaries; the extension does not race it with a forced timeout. If a pending switch fails, Pi may continue the parent run after an explicit failure notice; the extension cannot veto that run. Inspect `/hprofile status` rather than assuming rollback succeeded.

## Configuration and migration

One editable JSON, no mutable global `active`. All seven standard agent roles are required per profile, alongside `main`. Additional profiles/roles are allowed; `next`, `status`, and `reload` are reserved profile names. Unknown fields and duplicate JSON keys fail with field-specific errors. Thinking must be supported by each actual registered model, not merely be a recognized schema value.

The pure `migrateLegacyJson` export in `src/config.ts` classifies original core model signatures by content: historical `codex-low` becomes `claude`, and `claude-low` becomes `codex`. It adds missing Gemini roles, preserves custom roles, rejects customized/ambiguous core signatures and performs **no writes**. Review any generated JSON before intentionally saving it; never overwrite personal configuration on update.

The original files remain in `tests/fixtures/` as historical evidence only. Runtime code has no direct filesystem writes, telemetry, polling, quota fallback, credential handling or permission guards. Pi's own model and custom-entry APIs intentionally record session history. [Architecture](docs/architecture.md).
