# Pi Agents Profile Cycler

> Switch your orchestrator and every subagent between model profiles in one keystroke.

A small [Pi](https://github.com/earendil-works/pi) extension for [`mavam/pi-agents`](https://github.com/mavam/pi-agents). Pick a profile and the parent model, its thinking level and the routes for new subagents change together, without restarting the session or touching your agent files.

```text
Alt+M   balanced  →  claude  →  codex  →  balanced …
```

## Features

- ⚡ **One key**: `Alt+M` cycles profiles. `/hprofile` opens a picker.
- 🧭 **Per-role routing**: `implementer` on Sonnet, `reviewer` on Gemini, everything else on one default.
- 🛠️ **Built-in editor**: `/hprofile manage` creates, edits and deletes profiles, with fuzzy model search and your real subagents.
- 🗣️ **You still decide**: ask the orchestrator for a specific model and it wins over the profile.
- 🌳 **Session-aware**: each conversation branch remembers its own profile across resume, fork and `/tree`.
- 🛡️ **Safe switching**: every model is validated first; failures roll back and never leave a false status.

## Install

Requires Pi 1.5.x and `mavam/pi-agents`.

```sh
git clone <this-repo> pi-profile-cycler
pi install ./pi-profile-cycler
cp pi-profile-cycler/examples/profile-cycler.json ~/.pi/agent/profile-cycler.json
```

Only copy the example if you don't already have a `profile-cycler.json`. Then check the model IDs against `pi --list-models`, or fix them from `/hprofile manage`.

## Use

| Command | What it does |
|---|---|
| `Alt+M` · `/hprofile next` | Next profile |
| `/hprofile` | Pick from a menu |
| `/hprofile <name>` | Activate a profile |
| `/hprofile status` | Active profile, real parent model and next subagent routes |
| `/hprofile manage` | Create, edit, delete and activate profiles from a menu |
| `/hprofile reload` | Apply hand edits to the JSON; on error the previous config stays |

If Pi is busy, the switch is queued and applied when the current run settles.

## Manage profiles

`/hprofile manage` lists your profiles, then lets you edit the **default**, the **orchestrator** and every subagent it finds in `~/.pi/agent/agents` and your trusted project's `.pi/agents`. Navigate with arrows, Enter and Esc; in the model picker just type to search (`opu` → Opus models). Nothing is written until **Save**, which validates every model, keeps a `profile-cycler.json.bak` and applies the change.

## Configure

Prefer the editor, or edit `~/.pi/agent/profile-cycler.json` and run `/hprofile reload`:

```json
{
  "version": 2,
  "defaultProfile": "balanced",
  "order": ["balanced", "fast"],
  "profiles": {
    "balanced": {
      "main": { "model": "openai/gpt-6.1-sol", "thinking": "medium" },
      "agents": {
        "implementer": { "model": "claude-code/claude-sonnet-5-5", "thinking": "medium" },
        "reviewer": { "model": "antigravity/gemini-3-8-flash", "thinking": "high" }
      }
    },
    "fast": {
      "default": { "model": "claude-code/claude-haiku-5-5", "thinking": "high" }
    }
  }
}
```

- `main` is the orchestrator; `agents` maps any mavam role to a model.
- `default` covers the orchestrator (when there is no `main`) and every subagent without its own route.
- Each profile needs `main` or `default`. Priority per subagent: model you ask for → role → `default` → mavam's own setting.

## Limits

- Only **new direct** subagents are routed. Running agents keep their model.
- **Nested** subagents (spawned by other subagents) use mavam's native routing.
- On Windows, Pi reserves `Alt+P`, so the shortcut is `Alt+M`.

## Develop

```sh
npm ci && npm test && npm run typecheck
```

[Architecture](docs/architecture.md) · [Compatibility](docs/compatibility.md) · [Manual testing](docs/manual-testing.md) · [PRD](docs/pi-agents-profile-cycler.md)

<sub>[MIT](LICENSE) © 2026 Nahuel Nicolas Noir (nanonoir) · not an official pi-agents plugin</sub>
