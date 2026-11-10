# Real Pi smoke checklist (not yet executed)

Automated mocks cannot establish real provider routing, Windows hotkey behavior or nested helper compatibility. This checklist is a remaining release gate, not passing test evidence. Do not run paid model calls without an explicit, bounded smoke session.

## Isolate the harness first

Use a disposable Pi agent directory and project directory. Never point this smoke at the user's global configuration. Copy only intentional example configuration; do not copy credentials into the repository. Load exactly one cycler extension and only the target `mavam/pi-agents` runtime. Resolve authentication separately with the owner. Do not install a second subagent engine.

Record Pi and mavam versions, OS/terminal, registered model IDs, authentication availability, and the approximate cost of each real call. Example IDs are not proof of provider availability.

## Verify incrementally

| Check | Expected evidence |
|---|---|
| Start; `/hprofile status` | Selected profile, real parent model/thinking, future routes and limitations agree. Missing models produce explicit failure, never a false selected status. |
| Menu, explicit profile, `next`, Alt+M | Same conversation/history; exact configured cycle; Tab unchanged. |
| Invalid config then `reload` | Clear field error; last working configuration/selection retained. |
| Valid edit then `reload` | Configuration validated; selected name unchanged; removal requires explicit choice. |
| Direct spawn, then two-role graph | Runtime agent metadata reports configured model **and** thinking for each new agent; unrelated arguments/instructions/tools unchanged. |
| Change while parent is generating | Clear refusal/pending notice; no mid-stream model redirection. |
| Change while an existing child runs | Existing child unchanged; next direct spawn uses new route. |
| Two windows | Different selections remain isolated. |
| `/resume`, `/reload`, `/fork`, `/tree` | Active branch selection restored; no duplicate custom entries from restoration; status never claims a failed activation. |
| Manual `/model` | Status distinguishes real parent route from selected future-spawn profile. |
| First run with no `profile-cycler.json` | Status `profile: none (/hprofile manage)`; subagents spawn with mavam's own routing; `manage` offers only New profile; Save creates the file and activates it. |
| `/hprofile manage` → New profile with only a default | Fuzzy search (`opu`) narrows models; only supported thinking levels offered; Save writes `profile-cycler.json` + `.bak`; profile appears in Alt+M cycle. |
| Edit orchestrator and one role, Save | Status shows `[from main]`/role routes; next direct spawn of that role uses it; other roles use default. |
| Edit while parent generates, Save | File saved, notice to run `/hprofile reload`; nothing applied mid-run. |
| Delete default/active profile | Replacement required; last profile refused; active switch only after successful reload. |
| Project agents | Trusted project `.pi/agents` roles listed (override user by name); untrusted project not listed. |
| Helper from child with `spawn: true` | Record actual route and hook path. Unsupported until stable hook and real execution prove otherwise. |

## Safety checks

- Compare disposable agent Markdown and unrelated configuration before/after; the only writes are `profile-cycler.json` and `.bak` after an explicit Save, Delete or Set as default confirmation.
- Confirm no requests, telemetry, quota fallback, periodic jobs or credential reads originate from the cycler.
- Keep only minimal redacted metadata as evidence. Stop the disposable processes and delete only task-owned temporary resources.

## Current result

Automated checks use the real Pi tool pipeline with a non-spawning tool and the real mavam spawn/helper resolvers in disposable directories. They verify argument consumption and the nested resolver's native defaults, not real agent execution.

Not executed: no real Pi conversation, authenticated provider, Windows TUI hotkey, concurrent real window, or nested helper smoke has been exercised by this checklist.
