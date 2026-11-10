# Verified contracts and compatibility limits

Direct `subagent` launch routing is supported by the inspected pi-subagents 0.87.0 source. `mavam/pi-agents` (supported through 1.x) is no longer supported as of 2.0.0. Nested subagent routing is **not supported by this extension**. Source inspection is not a real provider smoke test.

## Inspected revisions

| Component | Revision |
|---|---|
| Pi coding-agent 1.5.1 | `4ea8837927564c592b1d184c956ab7d28c88119b` |
| pi-subagents 0.87.0 (npm) | installed package source, paths below relative to its root (no git revision recorded) |

The published Pi **1.5.0** SDK and its pi-agent-core/pi-ai 1.5.0 dependencies were also installed as repository-local development dependencies and inspected. Its `dist/core/agent-session.js` lines 339–351 pass the validated argument object to events; `pi-agent-core/dist/agent-loop.js` lines 496–503, 532–536 and 574–580 execute that same object. `dist/core/extensions/types.d.ts` lines 997–1002 explicitly promise mutable input. This supports the declared Pi `^1.5.0` peer range; no older compatibility is asserted. The local Pi CLI reports 1.5.0, but the user's installed providers/model IDs and pi-subagents runtime have not been certified.

## Direct calls

Pi explicitly documents in-place input mutation, handler ordering and no revalidation in [tool event types](https://github.com/earendil-works/pi/blob/4ea8837927564c592b1d184c956ab7d28c88119b/packages/coding-agent/src/core/extensions/types.ts#L1271-L1276). The [agent loop](https://github.com/earendil-works/pi/blob/4ea8837927564c592b1d184c956ab7d28c88119b/packages/agent/src/agent-loop.ts#L735-L779) passes validated args to preflight and retains them for [tool execution](https://github.com/earendil-works/pi/blob/4ea8837927564c592b1d184c956ab7d28c88119b/packages/agent/src/agent-loop.ts#L839-L850). Mutate the existing input object; do not merely replace the event property. Other extensions running afterward can overwrite routes; ordering remains a compatibility constraint.

### pi-subagents 0.87.0 evidence

Paths are relative to the installed package root.

- **Launch tool and schema** (`src/extension/schemas.js:250-306`): the tool is `subagent`; a direct launch is `agent` + `task` with optional `model`, `async`, `workflow`, `action`. `tasks[]` (`{agent, task, cwd?, model?}`) and `chain[]` (`{agent, task?, as?, cwd?, model?, parallel?[]}`) exist only when `disabledFeatures` includes `workflow-scripts` (`schemas.js:278-289`).
- **Thinking** is only expressible as a `:level` suffix (`off|minimal|low|medium|high|xhigh|max`) on `model`; there is no `thinking` launch field (`schemas.js:177`, `:250`). The suffix is therefore how the cycler injects thinking.
- **Model precedence** (`docs/models.md`): per-run `model` → `agentOverrides` → agent frontmatter `model` → `subagents.defaultModel` → parent model. An unknown or ambiguous explicit model fails the launch (`src/runs/shared/model-resolution.js:335-380`); verification compares only the base id (`model-resolution.js:10-33`). A routed model therefore overrides `agentOverrides` and frontmatter, and can be refused by `modelScope` / `maxThinking`.
- **In-place input**: Pi validates and clones arguments before `tool_call`; the handler's `event.input` is the executed object (`pi-agent-core/dist/agent-loop.js:475-580`), so assigning properties is effective. The transcript still shows the original arguments.
- **Async children** run in a runner process with `PI_SUBAGENT_CHILD=1` (`src/runs/background/subagent-runner.js:90`) that loads ambient user extensions (`src/runs/shared/child-launch.js:203`); pi-subagents registers nothing under that variable (`src/extension/index.js:215`). Loading the cycler there switched the child to the profile's parent model and caused `model_verification_failed`; the cycler now registers nothing when the variable is `1`. Foreground children run in-process with `noExtensions` (`src/runs/shared/child-session.js:484`).
- **Agent resolution** (`src/agents/agents.js:450-479`): canonical name, then `localName`, then aliases; ambiguity resolves to nothing. **Discovery** mirrored in `src/discovery.ts`: builtin (`agents/*.md`) < user (`PI_SUBAGENT_EXTRA_AGENT_DIRS`, settings `agentScanDirs`, `<agentDir>/agents`, `~/.agents`) < trusted project (`.agents`, `.pi/agents` at the nearest project root), recursive `.md` scan excluding `.chain.md`, pruning `.git`, `node_modules`, `.pi`, `sync-backups` and nested projects (`agents.js:1651-1700`, `:1931-1945`, `:2207-2249`, `:2718-2760`; merge in `src/agents/agent-selection.js`). Not mirrored: package-provided agents, `agentOverrides`, `agentExcludeDirs`, `projectRootResolution: git-root`, disabled agents.
- **External CLI runners** (`runner.type` `external-cli` / `external-job`; Claude Code, Codex, Cursor adapters) take a CLI alias as model, not a Pi registry id (`docs/models.md`): the cycler never injects into them.
- **Not routed**: `workflow` scripts, reply-block scripts, management `action`s and RPC/event launches keep native resolution.

## Model and lifecycle contracts

`setModel` can return false or throw; `setThinkingLevel` can clamp. Read back the effective thinking before confirming. See [Pi model implementation](https://github.com/earendil-works/pi/blob/4ea8837927564c592b1d184c956ab7d28c88119b/packages/coding-agent/src/core/agent-session.ts#L2641-L2663) and [thinking clamping](https://github.com/earendil-works/pi/blob/4ea8837927564c592b1d184c956ab7d28c88119b/packages/coding-agent/src/core/agent-session.ts#L2768-L2779).

`session_start` covers startup/reload/new/resume/fork; `session_tree` follows navigation. Restore using [`getBranch()`](https://github.com/earendil-works/pi/blob/4ea8837927564c592b1d184c956ab7d28c88119b/packages/coding-agent/src/core/session-manager.ts#L1475-L1489), not all entries. `agent_end` alone is not a reliable settled boundary (retries/queued messages can follow). Queue busy selections until `agent_settled` with an idle recheck or the next `before_agent_start` request boundary. In published Pi 1.5.0, `dist/core/extensions/types.d.ts` lines 819–823 define settlement after retries/compaction/continuations; `agent-session.js` lines 696–703 clear the active-run flag before emitting it. Other settlement handlers may still run afterward. This is a real public lifecycle boundary, not an invented scheduler.

Tree navigation sets its branch-summary abort controller **before** `session_before_tree` (`agent-session.js` lines 3315–3322), and retains it through `session_tree`; `isIdle()` is false throughout. It does not necessarily emit a later settlement event. Tree reconciliation therefore must expose the parent route as pending until a request/settlement boundary rather than wait indefinitely with an unavailable branch profile. During published Pi 1.5.0 reload, shutdown handlers are awaited before the old runner is invalidated (`agent-session.js` lines 3016–3020). An in-flight model transaction must unwind within that shutdown handler, not after invalidation.

## Nested subagents

Children are separate processes (async) or `noExtensions` in-process sessions (foreground), so the orchestrator's `tool_call` hook never sees what a child launches, and the cycler deliberately stays inert in them. Nested routing is unsupported; nested launches use pi-subagents' own resolution. No monkeypatch, node_modules edit or runtime replacement has been made.

## Release evidence still required

`tests/sdk.test.ts` executes the published Pi 1.5.0 tool pipeline with a non-spawning fixture and checks in-memory SessionManager branches. `tests/routing.test.ts` and `tests/extension.test.ts` use fixtures shaped after the pi-subagents `subagent` schema (lines cited above); `tests/discovery.test.ts` builds disposable agent/project/home directories that follow the mirrored discovery rules. pi-subagents is not a dependency and is not imported by tests. Discovery parity was verified manually on 2026-11-10 against the installed 0.87.0 `discoverAgents` over a sandbox with builtin, user, home, project, aliases, package-qualified, external-runner and pruned agents (identical agent sets, sources and models for trusted and untrusted projects); that check is not part of `npm test`. No real agents are started.

See [manual smoke checklist](manual-testing.md). Real Windows hotkeys, authenticated provider routing, runtime graph execution, concurrent windows and spawned nested helper behavior remain unverified. No paid calls were made.

## Shortcut context snapshot (Pi 1.5.0)

Interactive mode builds shortcut handler contexts with `model: this.session.model` (`modes/interactive/interactive-mode.js` ~1813), a keypress-time snapshot, while command/event contexts read the model live. The cycler therefore verifies switches against the model reported by `model_select`, not `ctx.model`. Alt+P is reserved by Pi on Windows (`app.model.cycleBackward`) and extension shortcuts on it are skipped; the cycler uses Alt+M.
