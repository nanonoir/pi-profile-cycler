# Verified contracts and compatibility limits

Direct spawn input routing is supported by the inspected upstream source. Nested helper profile routing is **not supported by this extension**. Source inspection is not a real provider smoke test.

## Inspected revisions

| Component | Revision |
|---|---|
| Pi coding-agent 1.5.1 | `4ea8837927564c592b1d184c956ab7d28c88119b` |
| mavam/pi-agents v0.39.0 | `85279cf05670f35a71329b802af55b50a3b8c97d` |

The published Pi **1.5.0** SDK and its pi-agent-core/pi-ai 1.5.0 dependencies were also installed as repository-local development dependencies and inspected. Its `dist/core/agent-session.js` lines 339–351 pass the validated argument object to events; `pi-agent-core/dist/agent-loop.js` lines 496–503, 532–536 and 574–580 execute that same object. `dist/core/extensions/types.d.ts` lines 997–1002 explicitly promise mutable input. This supports the declared Pi `^1.5.0` peer range; no older compatibility is asserted. The local Pi CLI reports 1.5.0, but the user's installed providers/model IDs and mavam runtime have not been certified.

## Direct calls

Pi explicitly documents in-place input mutation, handler ordering and no revalidation in [tool event types](https://github.com/earendil-works/pi/blob/4ea8837927564c592b1d184c956ab7d28c88119b/packages/coding-agent/src/core/extensions/types.ts#L1271-L1276). The [agent loop](https://github.com/earendil-works/pi/blob/4ea8837927564c592b1d184c956ab7d28c88119b/packages/agent/src/agent-loop.ts#L735-L779) passes validated args to preflight and retains them for [tool execution](https://github.com/earendil-works/pi/blob/4ea8837927564c592b1d184c956ab7d28c88119b/packages/agent/src/agent-loop.ts#L839-L850). Mutate the existing input object; do not merely replace the event property. Other extensions running afterward can overwrite routes; ordering remains a compatibility constraint.

mavam's [direct tool](https://github.com/mavam/pi-agents/blob/85279cf05670f35a71329b802af55b50a3b8c97d/src/pi/tools.ts#L438-L494) resolves all agents before graph execution. Its [spawn resolver](https://github.com/mavam/pi-agents/blob/85279cf05670f35a71329b802af55b50a3b8c97d/src/pi/spawn.ts#L205-L220) prioritizes request model/thinking over Markdown and inherited routes.

## Model and lifecycle contracts

`setModel` can return false or throw; `setThinkingLevel` can clamp. Read back the effective thinking before confirming. See [Pi model implementation](https://github.com/earendil-works/pi/blob/4ea8837927564c592b1d184c956ab7d28c88119b/packages/coding-agent/src/core/agent-session.ts#L2641-L2663) and [thinking clamping](https://github.com/earendil-works/pi/blob/4ea8837927564c592b1d184c956ab7d28c88119b/packages/coding-agent/src/core/agent-session.ts#L2768-L2779).

`session_start` covers startup/reload/new/resume/fork; `session_tree` follows navigation. Restore using [`getBranch()`](https://github.com/earendil-works/pi/blob/4ea8837927564c592b1d184c956ab7d28c88119b/packages/coding-agent/src/core/session-manager.ts#L1475-L1489), not all entries. `agent_end` alone is not a reliable settled boundary (retries/queued messages can follow). Queue busy selections until `agent_settled` with an idle recheck or the next `before_agent_start` request boundary. In published Pi 1.5.0, `dist/core/extensions/types.d.ts` lines 819–823 define settlement after retries/compaction/continuations; `agent-session.js` lines 696–703 clear the active-run flag before emitting it. Other settlement handlers may still run afterward. This is a real public lifecycle boundary, not an invented scheduler.

Tree navigation sets its branch-summary abort controller **before** `session_before_tree` (`agent-session.js` lines 3315–3322), and retains it through `session_tree`; `isIdle()` is false throughout. It does not necessarily emit a later settlement event. Tree reconciliation therefore must expose the parent route as pending until a request/settlement boundary rather than wait indefinitely with an unavailable branch profile. During published Pi 1.5.0 reload, shutdown handlers are awaited before the old runner is invalidated (`agent-session.js` lines 3016–3020). An in-flight model transaction must unwind within that shutdown handler, not after invalidation.

## Nested helpers

The [durable helper tool](https://github.com/mavam/pi-agents/blob/85279cf05670f35a71329b802af55b50a3b8c97d/src/agents/spawning.ts#L841-L855) invokes [`resolveHelper`](https://github.com/mavam/pi-agents/blob/85279cf05670f35a71329b802af55b50a3b8c97d/src/pi/spawn.ts#L246-L275), wired through the internal [session path](https://github.com/mavam/pi-agents/blob/85279cf05670f35a71329b802af55b50a3b8c97d/src/pi/session.ts#L249-L258). It does not pass through the orchestrator's Pi tool hook. The [documented hooks](https://github.com/mavam/pi-agents/blob/85279cf05670f35a71329b802af55b50a3b8c97d/docs/hooks.md) and [public hook types](https://github.com/mavam/pi-agents/blob/85279cf05670f35a71329b802af55b50a3b8c97d/src/hooks.ts) do not expose pre-resolution helper model routing. Request transforms are not model selection hooks.

A possible upstream change is a typed pre-resolution callback receiving the helper request and creation snapshot. No monkeypatch, node_modules edit, runtime replacement or upstream PR has been made. A stable hook plus real helper metadata tests would be required before adding support.

## Release evidence still required

`tests/sdk.test.ts` executes the published Pi 1.5.0 tool pipeline with a non-spawning fixture and checks in-memory SessionManager branches. `tests/mavam.test.ts` loads the actual published mavam 0.39.0 `resolveSpawn` and `resolveHelper` through jiti with a disposable agent directory and project profiles. Direct single and graph-shaped request resolutions receive injected routes while preserving instructions/tools; the helper resolver retains its native profile route, demonstrating the absent parent-hook injection at that boundary. These tests do not start real agents or execute mavam's graph scheduler/tool dispatch.

See [manual smoke checklist](manual-testing.md). Real Windows hotkeys, authenticated provider routing, runtime graph execution, concurrent windows and spawned nested helper behavior remain unverified. No paid calls were made.

## Shortcut context snapshot (Pi 1.5.0)

Interactive mode builds shortcut handler contexts with `model: this.session.model` (`modes/interactive/interactive-mode.js` ~1813), a keypress-time snapshot, while command/event contexts read the model live. The cycler therefore verifies switches against the model reported by `model_select`, not `ctx.model`. Alt+P is reserved by Pi on Windows (`app.model.cycleBackward`) and extension shortcuts on it are skipped; the cycler uses Alt+M.
