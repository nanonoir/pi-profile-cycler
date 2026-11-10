# Pi Agents Profile Cycler

> Switch your orchestrator and every subagent between model profiles in one keystroke.

A small [Pi](https://github.com/earendil-works/pi) extension for [`mavam/pi-agents`](https://github.com/mavam/pi-agents). Pick a profile and the parent model, its thinking level and the routes for new subagents change together, without restarting the session or touching your agent files.

```text
Alt+M   balanced  →  claude  →  codex  →  balanced …
```

## Features

- ⚡ **One key**: `Alt+M` cycles profiles. `/hprofile` opens a picker.
- 🧭 **Per-role routing**: `implementer` on Sonnet, `reviewer` on Gemini, all in one profile.
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

Only copy the example if you don't already have a `profile-cycler.json`. Then check the model IDs against `pi --list-models`.

## Use

| Command | What it does |
|---|---|
| `Alt+M` · `/hprofile next` | Next profile |
| `/hprofile` | Pick from a menu |
| `/hprofile <name>` | Activate a profile |
| `/hprofile status` | Active profile, real parent model and next subagent routes |
| `/hprofile reload` | Apply edits to the JSON; on error the previous config stays |

If Pi is busy, the switch is queued and applied when the current run settles.

## Configure

`~/.pi/agent/profile-cycler.json` (shortened):

```json
{
  "version": 2,
  "defaultProfile": "balanced",
  "order": ["balanced"],
  "profiles": {
    "balanced": {
      "main": { "model": "openai/gpt-6.1-sol", "thinking": "medium" },
      "agents": {
        "implementer": { "model": "claude-code/claude-sonnet-5-5", "thinking": "medium" },
        "reviewer": { "model": "antigravity/gemini-3-8-flash", "thinking": "high" }
      }
    }
  }
}
```

`main` is the orchestrator and `agents` maps mavam roles to a model. Each profile currently needs all seven standard roles; see [`examples/`](examples/profile-cycler.json) for a full example.

## Limits

- Only **new direct** subagents are routed. Running agents keep their model.
- **Nested** subagents (spawned by other subagents) use mavam's native routing.
- On Windows, Pi reserves `Alt+P`, so the shortcut is `Alt+M`.

## Develop

```sh
npm ci && npm test && npm run typecheck
```

[Architecture](docs/architecture.md) · [Compatibility](docs/compatibility.md) · [Manual testing](docs/manual-testing.md) · [PRD](docs/pi-agents-profile-cycler.md)

<sub>Private · UNLICENSED · not an official pi-agents plugin</sub>
