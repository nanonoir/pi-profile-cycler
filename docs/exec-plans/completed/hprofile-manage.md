# Execution plan — `/hprofile manage` and profile defaults

## Goal

Let the owner create, edit, delete and select profiles from inside Pi instead of hand-editing `profile-cycler.json`, and let a profile set one default model for the orchestrator and every subagent.

## Owner decisions (2026-11-10)

- Command: `/hprofile manage`. No CLI subcommand: Pi extensions register slash commands only.
- Roles become optional per profile. Unconfigured roles keep native mavam routing unless the profile has a `default`.
- Subagent discovery covers user agents and project agents.
- Each profile can configure the orchestrator (`main`).
- New optional profile `default` route applies to the orchestrator and all subagents not configured explicitly.
- Work directly on `main`; no feature branches for now.

## Design

### Schema (stays `version: 2`, backward compatible)

```json
"fast": {
  "default": { "model": "claude-code/claude-haiku-5-5", "thinking": "high" },
  "main":    { "model": "claude-code/claude-opus-5-5", "thinking": "medium" },
  "agents":  { "implementer": { "model": "claude-code/claude-sonnet-5-5", "thinking": "medium" } }
}
```

- `default`, `main` and `agents` are optional, but a profile must define `main` or `default` so the parent model is always determinable.
- `agents` may contain any role name; the seven standard roles are no longer required.
- Existing files remain valid unchanged.

### Precedence

For each direct `agent_spawn` agent and each field (`model`, `thinking`):

1. Explicit value in the request (current explicit-wins policy).
2. The profile's route for that role.
3. The profile's `default`.
4. Native mavam routing (nothing injected).

Orchestrator: `main`, else `default`. With a `default`, every direct subagent is routed, including ones that previously used native routing (e.g. `teacher`). Nested helpers remain unsupported.

### Subagent discovery

Mirror mavam 0.39.0 `discoverProfiles` (`src/catalog/profiles.ts`) without importing it at runtime:

- User: `<getAgentDir()>/agents/*.md`.
- Project: `<cwd>/.pi/agents/*.md` only when `ctx.isProjectTrusted()` and the directory is not the agent dir itself; project overrides user by name.
- Role name comes from frontmatter `name` (Pi's exported `parseFrontmatter`). Unparseable files are listed as diagnostics, not fatal.
- Read-only: agent Markdown is never written.
- The editor lists discovered roles plus roles already in the config (marked if no longer discovered).

### Writing the configuration

Writing `profile-cycler.json` is new behavior; until now the extension never wrote files.

- Edits act on an in-memory copy; nothing is written until the user confirms **Save**.
- Before writing: full schema validation plus registry/thinking preflight of every changed route.
- Write atomically (temp file in the same directory, then rename) after copying the previous file to `profile-cycler.json.bak`.
- Output is pretty-printed JSON; custom formatting is not preserved (documented).
- After saving, apply through the existing reload path. If Pi is busy, the file is saved and the user is told to run `/hprofile reload`.

### UI flow (Pi dialogs only: `select`, `input`, `confirm`)

```text
/hprofile manage
├─ <profile>          → Activate · Edit · Delete
├─ + New profile      → name → default model + thinking (optional) → edit
└─ Done

Edit <profile>
├─ Default            → model · thinking · remove
├─ Orchestrator       → model · thinking · remove (allowed only if default exists)
├─ <role> (discovered + configured, showing current route or "default"/"native")
│                     → model · thinking · remove
├─ Save / Discard
```

- Models come from `ctx.modelRegistry.getAvailable()`; thinking choices from `getSupportedThinkingLevels(model)`. Invalid choices cannot be selected.
- Navigation everywhere: arrows (or `j`/`k`), Enter to choose, Esc to go back. Verified in Pi 1.5.0 `ExtensionSelectorComponent`; it has no search.
- Profile names validated as today (lowercase, not `next`/`status`/`reload`/`manage`); new profiles are appended to `order`.
- Deleting the selected or default profile requires choosing a replacement; deleting the last profile is refused.
- **Model picker with fuzzy search** (owner decision 2026-11-10): typing `opu` narrows the list to Opus models, like Pi's `/model`. Built with `ctx.ui.custom` from public `@earendil-works/pi-tui` exports (`Input`, `fuzzyFilter`, `Container`/`Text`), as Pi's own `model-selector.js` does; the list is hand-rendered rather than `SelectList`. Rows show `model-id · provider`. All other menus (profile, role, thinking, confirmations) stay on plain `ctx.ui.select`.
- Fallback: if `ctx.ui.custom` is unavailable or throws, the model picker degrades to plain `select` with models ordered by provider.
- `@earendil-works/pi-tui` becomes a peer dependency (`^1.5.0`, already a peer of mavam) and a dev dependency for tests.
- Without UI (`!ctx.hasUI`), `manage` reports that it needs the interactive TUI.

### Out of scope

Renaming and reordering profiles, editing agent Markdown, CLI subcommands, nested helper routing, custom TUI components other than the model picker (e.g. a table view).

## Sequence

- [x] Phase 1 — Schema and routing: optional roles, `default`, optional `main`; reserve `manage`; precedence in `routeSpawn` and parent selection; preflight and `status` show default/native sources. Tests for precedence, old configs still valid and invalid profiles without `main`/`default`.
- [x] Phase 2 — Discovery: read-only module for user and trusted project agents, mirroring mavam, with tests against temporary directories (override, untrusted project, invalid frontmatter, agent dir equal to project `.pi`).
- [x] Phase 3 — Profile editing core: pure operations (create, delete with replacement, set/remove default, main and role) plus serializer and atomic writer with backup. Tests: round trip, validation before writing, interrupted write leaves the old file, no other files touched.
- [x] Phase 4a — Searchable model picker: pure filtering/row formatting tested against `fuzzyFilter`; component tested by feeding key input (type `opu`, arrows, Enter, Esc); fallback to plain `select` tested.
- [x] Phase 4b — `/hprofile manage` UI over the pure core; save applies through reload; busy handling. Harness tests drive dialog answers for create, edit, delete and discard.
- [x] Phase 5 — Docs: README (configure section, manage command, default), architecture (file writes, precedence), manual testing checklist.
- [x] Independent review, fixes, focused validation, archive this plan.

### Review round 1 (reviewer `ses_e3c60788effe6UCsroOrlW2cZa`, FAIL)

Decision (orchestrator, 2026-11-10): Delete and Set as default stay immediate profile-level writes, each behind an explicit confirmation; route edits remain draft-and-Save. Docs corrected accordingly. Fixes delegated: reload outcome reporting, compare-before-write, changed-routes-only preflight with named profile on reload failure, fsync before rename, dead `required` code, invalid discovered role names, lazy pi-tui import, cancelling pending on removed profile, test realism (offered options, real default save path).

Left open for the owner: an explicit request `model` without explicit `thinking` takes thinking from the role/default route, now also for every unconfigured subagent when a profile has `default`; whether Pi/mavam clamp an unsupported level for the explicit model is untested.

## Validation

- `npm test` and `npm run typecheck` after each phase; focused tests while iterating.
- Filesystem tests use temporary directories and `PI_CODING_AGENT_DIR`; never the owner's `~/.pi/agent`.
- Manual smoke by the owner: create a profile with only `default`, edit a role, delete a profile, verify `/hprofile status` and one real subagent spawn.

## Risks

- **First file writes:** a bug could corrupt the owner's config. Mitigated by validation before writing, atomic rename and `.bak`.
- **Broader routing with `default`:** subagents that previously used native routing get the default. Visible in `status`.
- **Discovery drift:** mavam may change discovery rules after 0.39.0; differences only affect which roles the editor lists, not routing.
- **Dialog UX:** chained dialogs are slower than a table; acceptable for v1 of the editor.
- **Custom component API:** `ctx.ui.custom` and pi-tui component contracts may change between Pi versions; mitigated by the plain `select` fallback and keeping the component small.
- **Delivery:** commits stay local on `main` until the whole feature is finished; no push before the owner says so.

## Progress and evidence

- Phase 1 (`2c1b989`): optional `main`/`default`/`agents`, any role name, `manage` reserved, `parentRoute()` (main else default), `routeSpawn` fallback to default, preflight checks default, status shows sources. `npm test` 41/41, typecheck clean. Example and root configs validate unchanged. Note: an explicit request model without explicit thinking still takes thinking from the role/default route (pre-existing explicit-wins behavior).
- Phase 2 (`d162b89`): `src/discovery.ts` `discoverRoles(cwd, trusted, agentDir)` mirrors mavam 0.39.0 `discoverProfiles` (user + trusted project, project overrides, ENOENT silent, invalid files as diagnostics, read-only). Parity test against mavam's real function via jiti.
- Phase 3 (`a5583f2`): `src/editing.ts` (`createProfile` requires a default route, `deleteProfile` with replacement for the default profile and last-profile refusal, `setRoute`, `setDefaultProfile`); `src/store.ts` (`serializeConfig` stable key order, `writeConfig` re-validates, `.bak`, temp file + rename, cleanup on failure). `npm test` 58/58, typecheck clean.
- Phase 4a (`cf3bd9f`, `8674ec2`): fuzzy model picker via `ctx.ui.custom` + pi-tui `Input`/`fuzzyFilter`, current route first, 10-row scroll, plain `select` fallback when `custom` is missing or throws. pi-tui added as peer `^1.5.0` / dev `1.5.0`. Tested with Pi's real `KeybindingsManager` and fake tui; real terminal rendering unverified.
- Phase 4b (`2976586`): `src/manage.ts` dialog flow over injected deps; reload logic extracted to a shared `reload(ctx)`; `CyclerOptions` gains `writeConfig`/`pickModel`/`discoverRoles`. Menu re-reads the file each pass; only the edited profile is preflighted before writing; Delete and Set as default apply immediately (not drafted). `npm test` 84/84, typecheck clean.
- Phase 5: README (manage, default, priority), architecture (modules, precedence, single write path), manual checklist rows for manage.

### Review round 2 (same reviewer, PASS)

Fixes in `4c3d349` verified (92/92). Follow-up `fix(store)`: short `writeSync` writes are retried (no-progress guard) and the removed-pending cancellation on reload has a test; 94/94, typecheck clean. Accepted residuals: reload still preflights every profile (error names it); compare-before-write is not atomic across processes (small window).

## Implementation Outcome

Closed 2026-11-10. Commits `2c1b989`..`6f92d0d` are local on `main`; nothing was pushed.

### Implemented

- Schema (still `version: 2`): `main`, `default` and `agents` are optional; any role name is allowed; a profile must define `main` or `default`. Precedence per field: explicit request → role route → `default` → native mavam. The orchestrator uses `main`, else `default`. `status` shows the source of each route.
- Discovery (`src/discovery.ts`): read-only listing of user and trusted project agent Markdown, mirroring mavam 0.39.0; invalid files become diagnostics.
- Editing core (`src/editing.ts`): pure create, delete (with replacement), set route, set default.
- Writer (`src/store.ts`): stable serialization, schema re-validation, `.bak`, temp file, fsync, rename, cleanup on failure, retry of short writes.
- Model picker (`src/model-picker.ts`): fuzzy filter via pi-tui `fuzzyFilter`; plain `select` fallback.
- `/hprofile manage` (`src/manage.ts`, wired in `src/index.ts`): profile list, edit menu, create, delete, set default, Save/Discard. Save reuses the `/hprofile reload` path.
- Packaging: `@earendil-works/pi-tui` as peer `^1.5.0` and dev `1.5.0`.
- Docs: README (manage, default, priority), architecture (modules, precedence, single write path), manual-testing rows for manage.

Main areas: `src/`, `tests/`, `package.json`, `README.md`, `docs/`.

### Deviations from Design

- **Delete and Set as default write immediately** after an explicit confirmation, not on Save. They are profile-level actions; route edits stay draft-and-Save. Decided in review round 1 and documented.
- **New profiles require a default route.** The design showed the default as optional at creation; a new profile must be usable, so `createProfile` requires it.
- **Save refuses if the file changed on disk** since the menu was built (compare-before-write). Added during review fixes; not in the original design.
- **Reload preflights every profile**, not only changed ones; the error names the offending profile. Only Save preflights changed routes.
- **Lazy pi-tui import** in the model picker, with plain `select` fallback. The list is hand-rendered, as the design said.
- Review round 1 fixes also covered: reload outcome reporting, fsync before rename, invalid discovered role names, cancelling a pending switch when its profile is removed, and more realistic tests.

### Validation

- `npm test`: 94/94 pass. `npm run typecheck`: clean (re-run at closure).
- Independent review round 1: FAIL → fixes in `4c3d349` and decisions in `c5bda8d`. Round 2: PASS (reviewer `ses_e3c60788effe6UCsroOrlW2cZa`). Follow-up `f1343dc` added short-write retry and a pending-cancellation test.
- Not validated: real Pi TUI behavior (manage dialogs, fuzzy picker in a real terminal), authenticated providers, real subagent spawns, Windows hotkeys. These remain open rows in `docs/manual-testing.md`.

### Follow-up

- Owner decision: an explicit request `model` without explicit `thinking` still takes thinking from the role/default route; now applies to every unconfigured subagent when a profile has `default`. Whether Pi/mavam clamp an unsupported level is untested. See `docs/exec-plans/tech-debt-tracker.md`.
- Real TUI and provider smoke of `/hprofile manage` and the fuzzy picker.
- Compare-before-write is not atomic across processes.
- Nested helpers remain unsupported (see `docs/compatibility.md`).
