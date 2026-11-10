# Pi Profile Cycler — personal extension v1

This is an independent, small extension for Pi + mavam/pi-agents. It is not an official pi-agents plugin.

## Install on Windows

1. Extract the ZIP somewhere (e.g. `$HOME\Downloads\pi-profile-cycler-v1-20261109`).
2. Copy `pi-profile-cycler.ts` to `$HOME\.pi\agent\extensions\pi-profile-cycler.ts`.
3. Copy `profile-cycler.json` to `$HOME\.pi\agent\profile-cycler.json`.
4. In Pi, run `/reload`, or reopen Pi.

PowerShell (adjust `$src` to your extraction folder):

```powershell
$src = "$HOME\Downloads\pi-profile-cycler-v1-20261109"
New-Item -ItemType Directory -Force "$HOME\.pi\agent\extensions" | Out-Null
Copy-Item "$src\pi-profile-cycler.ts" "$HOME\.pi\agent\extensions\pi-profile-cycler.ts"
Copy-Item "$src\profile-cycler.json" "$HOME\.pi\agent\profile-cycler.json"
```

## Use

- `Alt+P` cycles through profiles (do not use Tab: it is reserved for editor autocomplete).
- `/hprofile` opens a selection menu.
- `/hprofile balanced`, `/hprofile codex-low`, `/hprofile claude-low` select directly.
- `/hprofile status` shows selected profile.
- After editing the JSON manually, `/hprofile <name>` reapplies that profile.

## How it works

When switching, Pi sets the main model and thinking level immediately. The extension only edits `model:` and `thinking:` in the YAML frontmatter of agent Markdown files named in the selected profile. It leaves agent instructions and other fields untouched. pi-agents re-reads these files on every new spawn. Already running agents keep their original model and thinking. Agent roles not listed (reviewer, explorer, archiver) remain unchanged. No project-level `.pi` is created. Pruning, authentication, tools, skills, MCP, and security settings are untouched.

All models in the selected profile must appear in `pi --list-models`. If a provider or model is missing, no changes are applied. The supplied model IDs are examples based on your target stack: adjust to match Pi's actual models.

## Security and limitations

- Always inspect extension code before installing; it has your process's filesystem permissions.
- The extension changes agent Markdown files in the global Pi agent directory and stores the active profile in `profile-cycler.json`.
- No automatic fallback to a different paid model; missing models abort activation.
- This extension is not a permission guard for shell, Git, secrets or native Antigravity ACP tools.
- Changes to models and agent file frontmatter affect future requests and new spawns, not already-running child agents.
- If the extension is not loaded, editing its JSON alone has no effect.
