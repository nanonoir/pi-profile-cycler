# Execution plan — retarget to pi-subagents and stop overriding child sessions

## Goal

Make the profile cycler route the subagents of [`pi-subagents`](https://www.npmjs.com/package/pi-subagents) (the runtime the owner actually uses) instead of `mavam/pi-agents`, and fix the bug where the extension, loaded inside an async pi-subagents child, switches that child to the profile's parent model.

## Owner decisions (2026-11-10)

- The intended runtime was always pi-subagents. The target changes from mavam to pi-subagents.
- Fix the child-session bug as part of this work.
- Work directly on `main`; commit locally; push only when the owner says.

## Orchestrator decisions (defaults, owner may override)

- **pi-subagents only.** mavam support (`agent_spawn` hook, mavam discovery mirror, mavam dev dependency and tests) is removed rather than kept in parallel. This is a breaking change → version `2.0.0`.
- Profile schema stays `version: 2`, unchanged. Existing `profile-cycler.json` files keep working. `ENTRY_TYPE` stays `"pi-agents-profile-cycler"`.
- Precedence is unchanged in spirit: explicit request model → profile role route → profile `default` → native pi-subagents resolution (nothing injected). An explicit model (with or without a `:level` suffix) is left untouched, so no thinking is injected for it (same rule as `a8b6767`).
- Workflow scripts (`workflow`), reply-block scripts and RPC/event launch paths are **not routed**; they keep native pi-subagents resolution. Documented as a limitation.
- Nested subagents remain unsupported (the extension is inert in child processes).

## Verified facts (pi-subagents 0.87.0, explorer report 2026-11-10)

`P/` = installed package `~/.pi/agent/npm/node_modules/pi-subagents`.

- Launch tool is `subagent`. Direct launch: top-level `agent` (role) + `task`, optional `model`, `async` (default true), `workflow`, `action`, `options` (`P/src/extension/schemas.js:250-306`).
- `tasks[]` (`{agent, task, cwd?, model?}`) and `chain[]` (`{agent, task?, as?, cwd?, model?, parallel?}`) exist only when `disabledFeatures` includes `workflow-scripts` (`schemas.js:278-289`).
- Per-launch thinking is only expressible as a `:level` suffix on `model` (`off|minimal|low|medium|high|xhigh|max`); there is no `thinking` launch field (`schemas.js:250`, `:177`).
- Model precedence in pi-subagents: per-run `model` → `agentOverrides` → frontmatter `model` → `subagents.defaultModel` → parent model (`docs/models.md`). An explicit unknown/ambiguous model fails the launch (`src/runs/shared/model-resolution.js:335-380`). Launch candidate = `model:thinking`; verification compares only the base id (`model-resolution.js:10-33`).
- Pi validates/clones the tool arguments before `tool_call`; the handler's `event.input` is the object that is executed, so mutating its properties is effective (`pi-agent-core/dist/agent-loop.js:475-580`). Transcript shows the original arguments.
- Async children run in a runner process that sets `PI_SUBAGENT_CHILD=1` (`P/src/runs/background/subagent-runner.js:90`) and loads ambient user extensions (`P/src/runs/shared/child-launch.js:203`). pi-subagents itself registers nothing when that variable is set (`P/src/extension/index.js:215`). Foreground children run in-process with `noExtensions` (`P/src/runs/shared/child-session.js:484`).
- Agent discovery: builtin (`P/agents/*.md`) < package < user (`<agentDir>/agents`, `~/.agents`, `PI_SUBAGENT_EXTRA_AGENT_DIRS`, `agentScanDirs`) < project (`.agents`, `.pi/agents` at the nearest project root, only if trusted). Recursive `.md` scan excluding `.chain.md`, pruning `.git`, `node_modules`, `.pi`, `sync-backups`. Required frontmatter `name`, `description`; `aliases`/`alias`, `runner`, `model`, `thinking` relevant (`P/src/agents/agents.js:450-479`, `:1651-1700`, `:1931-1945`, `:2207-2249`). No public listing API; mirror it.
- Agents with an external CLI runner (Claude Code / Codex / Cursor adapters) take a CLI alias as model, not a Pi registry id (`P/docs/models.md`, adapters).

## Plan

### Phase 1 — Child guard (bug fix)

- In the extension entry (`src/index.ts`, default export), register nothing when `PI_SUBAGENT_CHILD === "1"`. Make the environment injectable (e.g. via `CyclerOptions`) for tests.
- Tests: with the variable set no handlers, commands or shortcut are registered and no `setModel`/`appendEntry` happens; without it behavior is unchanged.
- Commit: `fix: stay inert inside pi-subagents child processes`.

### Phase 2 — Routing for the `subagent` tool

- Replace `routeSpawn` (`src/routing.ts`) with a pure, non-mutating router for the `subagent` input:
  - Direct launch: `agent` is a string and `workflow` and `action` are absent → route top-level `model`.
  - When present, route each `tasks[i]` and `chain[i]` item (and `chain[i].parallel[]` items if they carry `agent`/`model`; verify the shape in `P/src/extension/schemas.js` first).
  - Anything else (workflow, actions such as status/stop, RPC) passes through untouched.
  - Role lookup by canonical name, `localName`, aliases and package-qualified names, using the discovery result; unknown roles fall to `default`.
  - Injected value: `<provider>/<id>:<thinking>`. Skip when the request already has a non-empty `model`.
  - Never inject `default` into agents whose runner is an external CLI adapter; a role route for such an agent is rejected by validation.
- `src/index.ts`: hook `event.toolName === "subagent"`, keep the existing all-or-nothing preflight, busy/switch guards and "no config file → pass through" behavior; mutate only properties of `event.input`.
- Rewrite routing/extension/override/sdk tests for the new input shape; delete `tests/mavam.test.ts`.

### Phase 3 — Discovery for `/hprofile manage`

- Rewrite `src/discovery.ts` to mirror pi-subagents discovery (sources, precedence, trust, recursion/pruning, `name`/`description`, aliases, runner). Builtin agents: resolve the installed package's `agents/` directory best-effort (e.g. `<agentDir>/npm/node_modules/pi-subagents/agents` or Node resolution); if not found, omit builtins without failing.
- Replace the mavam parity test with a parity test against the pi-subagents source if it can be imported from a dev dependency without starting agents; otherwise fixture-based tests citing the mirrored lines.
- Manage editor labels "native" now mean pi-subagents' own resolution.

### Phase 4 — Dependencies, docs, release

- `package.json`: description mentions pi-subagents; replace dev dependency `pi-agents` with `pi-subagents@0.87.0` only if a test imports it; version `2.0.0`.
- Update README (requirements, how a subagent gets its model, limitations: workflows/RPC native, explicit model wins, overrides `agentOverrides` for routed roles, nested unsupported), `docs/architecture.md`, `docs/compatibility.md` (pi-subagents 0.87.0 evidence; mavam no longer supported), `docs/manual-testing.md` (async child keeps its model; routed direct launch; `model_verification_failed` absent), PRD update section.
- `npm test` and `npm run typecheck` green.

### Phase 5 — Review and closure

- Independent review (requirements + engineering quality).
- Fixes, then archiver closes this plan; local commits; tag `v2.0.0` and push only after owner approval.

## Validation

- Unit/integration tests per phase; full `npm test` + typecheck before closure.
- Manual smoke by the owner in real Pi (bounded): async `explorer` launch keeps its own model (no `model_verification_failed`); with a profile, a direct launch without `model` runs on the routed `model:level`; an explicit `model` is respected.

## Risks

- pi-subagents is fast-moving (0.87.0); the input schema and discovery are mirrored, not imported. Pin the verified version in `compatibility.md`.
- An injected model outside `modelScope` or above `maxThinking` fails the launch in pi-subagents; our preflight only checks Pi's registry and supported thinking. The failure is visible, not silent.

## Progress

- [x] Phase 1 — child guard
- [x] Phase 2 — `subagent` routing
- [x] Phase 3 — discovery
- [ ] Phase 4 — deps, docs, version
- [ ] Phase 5 — review and closure
