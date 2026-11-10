# Execution plan — first package release

## Scope and constraints

Canonical requirements: [PRD](../../pi-agents-profile-cycler.md). Deliver the first package version using configuration schema v2. Work only inside this repository; do not read credentials, modify global Pi configuration, install another subagent runtime, invoke paid models, push, or publish. Keep the package private and UNLICENSED pending an owner license decision. Preserve the original v1 in a local fixture until Git history exists.

## Sequence

- [x] Phase 0: audit existing v1; preserve a baseline and characterize it before refactoring; add minimal package/tooling, ignore rules and architecture documentation.
- [x] Phase 1: strict schema v2, full approved model matrix, pure legacy migration by content, focused tests; remove all Markdown/global-state writes.
- [x] Contract gate: verify actual Pi tool dispatch, model/thinking APIs, lifecycle events and mavam direct/nested spawning using versioned upstream evidence. If the proposed hook cannot route safely, document the blocker rather than simulate support.
- [x] Phase 2: validated transactional model switching, direct spawn routing, commands and status; focused integration checks.
- [x] Phase 3: branch-aware session persistence, lifecycle restoration, busy handling and isolation tests.
- [x] Phase 4 documentation: nested delegation evidence and limitations, installation and manual compatibility checklist. Real smoke and publication remain deferred release gates, not completed work.
- [x] Independent review, corrections, focused validation, documentation reconciliation and plan closure for the automated implementation scope.

## Validation

Use Node-based focused unit tests and TypeScript checking. Test pure configuration/routing first, then the registered extension against a faithful mocked Pi API. Cover failures/rollback, unsupported thinking, commands, lifecycle navigation, isolation, no redundant persistence and no filesystem writes. Record real API evidence separately from mocked behavior. Do not claim runtime or provider compatibility from mocks alone.

## Initial audit

- Existing files: README, single TypeScript extension, legacy JSON and PRD; the referenced test-local.cjs is absent.
- Git initialized on main with no commits; three baseline files are staged. Preserve user staging; no history rewrite or baseline deletion.
- v1 writes global agents/*.md and active JSON, has no tool_call routing, session persistence, busy guard or reload command.
- Legacy codex-low is Claude-heavy; claude-low is Codex-heavy. Three required Gemini roles are absent.
- IDs in the PRD are provisional, not verified installed models. Validate against the actual session registry before activation; never invent replacements.

## Progress and evidence

Phases 0–1: baseline characterized before refactor; exact fixture hashes match staged originals. Five focused tests and scoped typecheck passed. Source evidence confirms direct input routing on upstream Pi 1.5.1 and mavam 0.39.0; nested helpers use a separate path with no suitable public hook. Pi 1.5.1 was not on npm; actual local Pi/npm version is 1.5.0. Repository-only SDK dev dependencies 1.5.0 installed successfully (zero reported vulnerabilities); inspect their actual dispatch before lowering compatibility requirement. Routing/state pure tests separately passed (4 tests). Real smoke not performed.

Published Pi 1.5.0 was independently inspected and confirmed to support input mutation, supported-thinking query and public agent_settled. Peer requirement corrected to ^1.5.0. Initial 15 focused tests and whole-project typecheck passed; 2 additional real SDK tests exercise tool dispatch/blocking and in-memory branching, without provider calls. Independent review found realistic busy-tree, async activation/run race, and pending-intent defects; correction and deterministic regression tests delegated before acceptance. The real mavam 0.39.0 target runtime was added only as a repository-local dev dependency for isolated resolver/dispatch contract tests, not enabled globally. No other subagent runtime was installed.

First concurrency correction round added an in-flight request gate, pending preservation and busy tree reconciliation; 28 focused tests passed in ~2.4 seconds and whole-project typecheck passed. Actual mavam resolver test confirms single/graph-shaped direct request routes preserve project instructions/tools, and resolveHelper retains native profile routes (not parent injection). This is not mavam graph scheduler or provider execution. Follow-up review found failed reconciliation could falsely retain selection, shutdown did not await rollback before SDK invalidation, and tree reread configuration outside explicit reload. A second correction addressed these defects before final acceptance.

## Implementation Outcome

### Implemented

- Phases 0–1: audited v1 before refactoring and preserved exact baseline fixtures; made the package private and UNLICENSED; implemented schema 2, the approved matrix and pure content-based migration.
- Phase 2: implemented real registry/thinking validation, transactional parent switching and rollback, profile-wins direct spawn injection, commands, shortcut and status.
- Phase 3: implemented per-branch custom state, safe public request/settlement gating, shutdown awaiting rollback before SDK invalidation, cached tree configuration and idempotent default pinning across reload and replaced pending intent.
- Phase 4 documentation records installation, compatibility limits and the remaining [manual smoke checklist](../../manual-testing.md). Execution closure is not release certification.

### Deviations from Design

Pi 1.5.1 was unavailable on npm; the published 1.5.0 SDK was inspected and tested and the peer requirement is `^1.5.0`. The actual mavam 0.39.0 target runtime was installed only as a repository-local development dependency. Nested helpers follow a separate path without a supported parent routing hook; no workaround was introduced.

### Validation

Final independent review (session `ses_e3d520e50ffeIUuHKztFe0CPj7`) passed the automated implementation scope with 21 focused tests and no material issues, subject to the real-smoke caveat. Final orchestrator `npm test` passed 37 tests, 0 failed, in approximately 2.68 seconds; `npm run typecheck` and `npm ls --depth=0` passed. `git diff --check` passed with LF/CRLF warnings only. Tests include the actual published Pi 1.5.0 tool pipeline and in-memory sessions, plus isolated published mavam 0.39.0 `resolveSpawn`/`resolveHelper` tests; they do not execute the mavam scheduler or real agents.

No global Pi configuration or credentials were accessed or modified, no paid calls were made, and no second subagent runtime was installed. Work remained on `feat/profile-cycler-v1` with no commits; the preexisting staged originals were preserved. No push, PR or publication was authorized or performed.

### Follow-up

Real Windows/TUI, provider, mavam scheduler/agent and nested helper smoke remains unexecuted and is a release gate under the manual checklist. The owner must choose a license before publication. Existing SDK integration limits remain documented in [architecture](../../architecture.md): a hung `setModel` can hold request and shutdown gates, early prompt/auth/image checks precede the request hook, and a failed pending switch cannot veto the parent run. These limits were not resolved or certified by automated tests.
