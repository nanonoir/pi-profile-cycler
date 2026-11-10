# Technical debt tracker

Real debt that should stay visible after an execution plan is closed. Minor ideas, cosmetic suggestions and items tracked elsewhere are not listed here. Update an existing entry instead of adding a duplicate.

| ID | Debt | Origin | Next step |
|---|---|---|---|
| TD-001 | An explicit request `model` without explicit `thinking` takes thinking from the role or `default` route. Since `default` applies to every unconfigured subagent, this now reaches all direct spawns of such a profile. Whether Pi/mavam clamp an unsupported level for the explicit model is untested. | [hprofile-manage](completed/hprofile-manage.md), Review round 1 | Owner decision on the intended behavior; then add a test against real Pi clamping. |
| TD-002 | `/hprofile manage`, the fuzzy model picker and a real subagent spawn with a `default`-only profile have not been exercised in a real Pi TUI or with an authenticated provider. Only fake-terminal and mocked-API tests exist. | [manual-testing.md](../manual-testing.md) checklist rows | Run the manual checklist in a disposable Pi directory with a bounded, explicit smoke session. |
| TD-003 | Compare-before-write is not atomic across processes. A second Pi window that writes between the re-read and the rename can still be overwritten. The single-process case is protected. | [hprofile-manage](completed/hprofile-manage.md), Review round 2 | Accept, or add an OS-level lock if multiple windows must edit concurrently. |
| TD-004 | Nested helpers (`spawn: true` from a child) are not routed by profiles. | Pre-existing; [compatibility.md](../compatibility.md) | Needs a stable upstream pre-resolution hook plus real helper metadata tests. |
| TD-005 | The original PRD ([pi-agents-profile-cycler.md](../pi-agents-profile-cycler.md)) still describes `Alt+P`, `profile-wins` and a no-write rule. These were superseded by `Alt+M`, explicit-wins and the profile editor, which is recorded in [architecture.md](../architecture.md). | Pre-existing drift, not reconciled | Owner decision on whether to rewrite or mark the PRD as superseded. |
