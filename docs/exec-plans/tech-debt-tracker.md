# Technical debt tracker

Real debt that should stay visible after an execution plan is closed. Minor ideas, cosmetic suggestions and items tracked elsewhere are not listed here. Update an existing entry instead of adding a duplicate.

| ID | Debt | Origin | Next step |
|---|---|---|---|
| TD-002 | A real authenticated subagent spawn with a `default`-only profile has not been exercised. The owner's 2026-11-10 manual smoke in Pi covered `/hprofile manage`, the fuzzy model picker, profile create/edit and Alt+M. | [manual-testing.md](../manual-testing.md) checklist rows | Run a bounded, explicit smoke session with a `default`-only profile in a disposable Pi directory. |
| TD-003 | Compare-before-write is not atomic across processes. A second Pi window that writes between the re-read and the rename can still be overwritten. The single-process case is protected. | [hprofile-manage](completed/hprofile-manage.md), Review round 2 | Accept, or add an OS-level lock if multiple windows must edit concurrently. |
| TD-004 | Nested helpers (`spawn: true` from a child) are not routed by profiles. | Pre-existing; [compatibility.md](../compatibility.md) | Needs a stable upstream pre-resolution hook plus real helper metadata tests. |
