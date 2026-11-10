import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { PROFILE_SHORTCUT } from "../src/index.ts";

interface Binding { defaultKeys?: string | string[] }

// Pi does not export its keybinding table publicly; load the published module by path.
const keybindingsPath = fileURLToPath(new URL("../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js", import.meta.url));

test("profile shortcut collides with no Pi/TUI default binding on any platform", async () => {
  const source = await import(`file://${keybindingsPath.replace(/\\/g, "/")}`) as { KEYBINDINGS: Record<string, Binding> };
  const used = new Set(Object.values(source.KEYBINDINGS).flatMap(b => [b.defaultKeys ?? []].flat()).map(k => k.toLowerCase()));
  // Platform-dependent defaults are computed at load time; the Windows and Unix variants are both checked here.
  for (const key of ["alt+p", "shift+ctrl+p", "alt+q", "alt+up", "alt+v", "ctrl+v", "alt+enter", "ctrl+q", "alt+z", "ctrl+-"]) used.add(key);
  assert.equal(used.has(PROFILE_SHORTCUT), false, `${PROFILE_SHORTCUT} is a Pi default binding`);
  assert.notEqual(PROFILE_SHORTCUT, "tab");
});
