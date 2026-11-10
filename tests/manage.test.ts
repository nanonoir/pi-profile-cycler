import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.ts";
import { parseConfig } from "../src/config.ts";

const FLASH = "antigravity/gemini-3-8-flash";
const TERRA = "openai/gpt-6.1-terra";
const OPUS = "claude-code/claude-opus-5-5";
const saved = (h: ReturnType<typeof harness>) => parseConfig(h.text());

test("create a profile with only a default and save it", async () => {
  const h = harness();
  h.script("+ New profile", "mini", FLASH, "high", "Save", "Done");
  await h.command("manage");
  assert.equal(h.scriptLeft(), 0);
  const config = saved(h);
  assert.deepEqual(JSON.parse(h.text()).profiles.mini, { default: { model: FLASH, thinking: "high" } });
  assert.deepEqual(config.order, ["balanced", "claude", "codex", "mini"]);
  assert.equal(h.writes.length, 1);
  assert.ok(h.notifications.some(text => /saved/.test(text)));
});

test("invalid or reserved profile names are re-asked; Esc backs out without writing", async () => {
  const h = harness();
  h.script("+ New profile", "manage", "Bad Name", "claude", undefined, "Done");
  await h.command("manage");
  assert.equal(h.notifications.filter(text => /Invalid name/.test(text)).length, 3);
  assert.equal(h.writes.length, 0);
});

test("edit a role and the orchestrator in one draft", async () => {
  const h = harness();
  h.script("balanced", "Edit", "implementer", "Change", TERRA, "high", "Orchestrator", "Change", OPUS, "medium", "Save", "Done");
  await h.command("manage");
  const profile = saved(h).profiles.balanced;
  assert.deepEqual(profile.agents.implementer, { model: TERRA, thinking: "high" });
  assert.deepEqual(profile.main, { model: OPUS, thinking: "medium" });
  assert.equal(h.writes.length, 1);
});

test("remove a role; the orchestrator cannot be removed without a default", async () => {
  const h = harness();
  h.script("balanced", "Edit", "reviewer", "Remove", "Orchestrator", "Remove", "Discard", true, "Done");
  await h.command("manage");
  assert.ok(h.notifications.some(text => /Profile error: scripted select "Remove" not in \[Change model\/thinking\]/.test(text)));
  const second = harness();
  second.script("balanced", "Edit", "reviewer", "Remove", "Save", "Done");
  await second.command("manage");
  assert.equal(saved(second).profiles.balanced.agents.reviewer, undefined);
  assert.equal(Object.keys(saved(second).profiles.balanced.agents).length, 6);
});

test("set as default profile", async () => {
  const h = harness();
  h.script("claude", "Set as default", "Done");
  await h.command("manage");
  assert.equal(saved(h).defaultProfile, "claude");
});

test("delete a non-default profile", async () => {
  const h = harness();
  h.script("claude", "Delete", true, "Done");
  await h.command("manage");
  const config = saved(h);
  assert.deepEqual(config.order, ["balanced", "codex"]);
  assert.equal(config.defaultProfile, "balanced");
});

test("deleting the default profile requires a replacement", async () => {
  const h = harness();
  h.script("balanced", "Delete", true, undefined, "balanced", "Delete", true, "codex", "Done");
  await h.command("manage");
  const config = saved(h);
  assert.equal(config.defaultProfile, "codex");
  assert.deepEqual(config.order, ["claude", "codex"]);
  assert.equal(h.writes.length, 1, "cancelling the replacement wrote nothing");
});

test("deleting the active profile offers a profile to activate afterwards", async () => {
  const h = harness();
  await h.emit("session_start");
  h.script("balanced", "Delete", true, "claude", "claude", "Done");
  await h.command("manage");
  assert.deepEqual(saved(h).order, ["claude", "codex"]);
  assert.match(h.statuses.at(-1)!, /profile: claude/);
  assert.equal(`${h.model().provider}/${h.model().id}`, OPUS);
});

test("the last profile cannot be deleted", async () => {
  const h = harness();
  const only = structuredClone(h.config);
  only.order = ["balanced"]; only.profiles = { balanced: only.profiles.balanced };
  h.setText(JSON.stringify(only));
  h.script("balanced", "Delete", "Done");
  await h.command("manage");
  assert.ok(h.notifications.some(text => /last profile/.test(text)));
  assert.equal(h.writes.length, 0);
});

test("discard asks for confirmation when there are unsaved changes", async () => {
  const h = harness();
  h.script("balanced", "Edit", "reviewer", "Remove", "Discard", false, undefined, true, "Done");
  await h.command("manage");
  assert.equal(h.scriptLeft(), 0);
  assert.equal(h.writes.length, 0);
  const clean = harness();
  clean.script("balanced", "Edit", "Discard", "Done"); // no changes: no confirm needed
  await clean.command("manage");
  assert.equal(clean.scriptLeft(), 0);
});

test("saving while busy writes the file and tells the user to reload", async () => {
  const h = harness();
  h.setIdle(false);
  h.script("balanced", "Edit", "reviewer", "Remove", "Save", "Done");
  await h.command("manage");
  assert.equal(h.writes.length, 1);
  assert.equal(saved(h).profiles.balanced.agents.reviewer, undefined);
  assert.ok(h.notifications.some(text => /saved but not applied.*parent busy.*\/hprofile reload/.test(text)));
});

test("a route that fails preflight blocks the write", async () => {
  const h = harness();
  const broken = structuredClone(h.config);
  broken.profiles.codex.agents.archiver.model = "ghost/none";
  h.setText(JSON.stringify(broken));
  h.script("codex", "Edit", "implementer", "Change", FLASH, "high", "Save", "Discard", true, "Done");
  await h.command("manage");
  assert.equal(h.writes.length, 0);
  assert.ok(h.notifications.some(text => /Not saved: agents\.archiver: Unavailable model: ghost\/none/.test(text)));
  // other profiles of the same file are still editable
  h.script("balanced", "Edit", "reviewer", "Remove", "Save", "Done");
  await h.command("manage");
  assert.equal(h.writes.length, 1);
});

test("a failing writer reports the error and keeps the draft open", async () => {
  const h = harness();
  h.failWrite(true);
  h.script("balanced", "Edit", "reviewer", "Remove", "Save", "Discard", true, "Done");
  await h.command("manage");
  assert.ok(h.notifications.some(text => /Not saved: disk full/.test(text)));
  assert.equal(h.writes.length, 0);
});

test("discovered roles and native labels, including configured roles that are gone", async () => {
  const h = harness();
  const role = (name: string, model?: string) => ({ name, source: "user" as const, filePath: `/a/${name}.md`, description: "d", ...(model ? { model } : {}) });
  h.setDiscovery({ roles: [role("teacher", "openai/gpt-6.1-sol"), role("scout")], diagnostics: [{ source: "user", filePath: "/a/bad.md", message: "bad" }] });
  h.script(
    "balanced", "Edit",
    "teacher: native: openai/gpt-6.1-sol", "Set model/thinking", FLASH, "high",
    `reviewer: ${FLASH} (high) [not discovered]`, "Change", FLASH, "high",
    "scout: native", "Set model/thinking", TERRA, "medium",
    "Save", "Done",
  );
  await h.command("manage");
  assert.equal(h.scriptLeft(), 0);
  assert.ok(h.notifications.some(text => /^1 agent file/.test(text)));
  const agents = saved(h).profiles.balanced.agents;
  assert.deepEqual(agents.teacher, { model: FLASH, thinking: "high" });
  assert.deepEqual(agents.scout, { model: TERRA, thinking: "medium" });
});

test("roles of a profile with a default show \"default\"", async () => {
  const h = harness();
  h.setDiscovery({ roles: [{ name: "scout", source: "project", filePath: "/p/scout.md", description: "d" }], diagnostics: [] });
  h.script("+ New profile", "mini", FLASH, "high", "scout: default", "Set model/thinking", TERRA, "low", "Orchestrator: default", "Remove", "Save", "Done");
  await h.command("manage");
  assert.ok(h.notifications.some(text => /Profile error/.test(text)), "orchestrator has no Remove when it already inherits the default");
  const h2 = harness();
  h2.setDiscovery({ roles: [{ name: "scout", source: "project", filePath: "/p/scout.md", description: "d" }], diagnostics: [] });
  h2.script("+ New profile", "mini", FLASH, "high", "scout: default", "Set model/thinking", TERRA, "high", "Save", "Done");
  await h2.command("manage");
  assert.deepEqual(saved(h2).profiles.mini.agents.scout, { model: TERRA, thinking: "high" });
});

test("thinking choices come from the model's supported levels", async () => {
  const h = harness();
  h.script("balanced", "Edit", "reviewer", "Change", FLASH, "not-a-level");
  await h.command("manage");
  assert.ok(h.notifications.some(text => /not in \[/.test(text) && /off/.test(text)));
});

test("manage needs the interactive TUI", async () => {
  const h = harness();
  h.setUI(false);
  h.script("balanced");
  await h.command("manage");
  assert.match(h.notifications.at(-1)!, /interactive TUI/);
  assert.equal(h.scriptLeft(), 1);
  assert.equal(h.writes.length, 0);
});
