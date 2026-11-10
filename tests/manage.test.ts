import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("first run without a config file: native routing, then manage creates and activates the first profile", async () => {
  const h = harness();
  h.setText(undefined);
  await h.emit("session_start");
  assert.match(h.statuses.at(-1)!, /profile: none \(\/hprofile manage\)/);
  assert.match(h.notifications.join("\n"), /no profiles yet/);
  assert.ok(!h.notifications.some(text => /Profile initialization/.test(text)));
  // Without a config nothing is blocked or injected: pi-subagents routes natively.
  const input: Record<string, unknown> = { agent: "implementer", task: "x" };
  assert.equal(await h.emit("tool_call", { toolName: "subagent", input }), undefined);
  assert.deepEqual(input, { agent: "implementer", task: "x" });
  await h.command("next");
  assert.match(h.notifications.at(-1)!, /No profiles yet; run \/hprofile manage/);

  h.script("+ New profile", "fast", OPUS, "medium", "Save", "Done");
  await h.command("manage");
  assert.equal(h.scriptLeft(), 0);
  assert.equal(h.offered[0].title, "Manage profiles: no profiles yet");
  assert.deepEqual(h.offered[0].options, ["+ New profile", "Done"]);
  assert.deepEqual(JSON.parse(h.text()), { version: 2, defaultProfile: "fast", order: ["fast"], profiles: { fast: { default: { model: OPUS, thinking: "medium" } } } });
  assert.match(h.statuses.at(-1)!, /^profile: fast$/);
  assert.equal(`${h.model().provider}/${h.model().id}`, OPUS);
  assert.equal(await h.emit("tool_call", { toolName: "subagent", input }), undefined);
  assert.deepEqual(input, { agent: "implementer", task: "x", model: `${OPUS}:medium` });
});

test("first run: Done or Esc writes nothing; a file created meanwhile is not overwritten", async () => {
  const h = harness();
  const original = h.text();
  h.setText(undefined);
  await h.emit("session_start");
  h.script("Done");
  await h.command("manage");
  assert.equal(h.writes.length, 0);
  assert.equal(h.exists(), false);
  h.script("+ New profile", "fast", OPUS, "medium", () => h.setText(original), "Save", "Discard", true, "Done");
  await h.command("manage");
  assert.equal(h.writes.length, 0);
  assert.equal(h.text(), original);
  assert.match(h.notifications.join("\n"), /changed on disk/);
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
  h.script("balanced", "Edit", "reviewer", "Remove", "Orchestrator", undefined, "Discard", true, "Done");
  await h.command("manage");
  assert.equal(h.scriptLeft(), 0);
  const route = (title: string) => h.offered.find(entry => entry.title.startsWith(title))!.options;
  assert.deepEqual(route("Orchestrator"), ["Change model/thinking"]);
  assert.deepEqual(route("reviewer"), ["Change model/thinking", "Remove"]);
  assert.equal(h.writes.length, 0);
  const second = harness();
  second.script("balanced", "Edit", "reviewer", "Remove", "Save", "Done");
  await second.command("manage");
  assert.equal(saved(second).profiles.balanced.agents.reviewer, undefined);
  assert.equal(Object.keys(saved(second).profiles.balanced.agents).length, 6);
});

test("set as default profile", async () => {
  const h = harness();
  h.script("claude", "Set as default", true, "Done");
  await h.command("manage");
  assert.equal(saved(h).defaultProfile, "claude");
  const declined = harness();
  declined.script("claude", "Set as default", false, "Done");
  await declined.command("manage");
  assert.equal(declined.writes.length, 0);
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

test("a changed route that fails preflight blocks the write", async () => {
  const h = harness();
  h.script("balanced", "Edit", "reviewer", "Change", TERRA, "low", () => { h.models.splice(h.models.findIndex(m => `${m.provider}/${m.id}` === TERRA), 1); }, "Save", "Discard", true, "Done");
  await h.command("manage");
  assert.equal(h.writes.length, 0);
  assert.ok(h.notifications.some(text => /Not saved: agents\.reviewer: Unavailable model: openai\/gpt-6.1-terra/.test(text)));
});

test("an untouched broken route does not block an unrelated save; reload names the profile", async () => {
  const h = harness();
  const broken = structuredClone(h.config);
  broken.profiles.codex.agents.archiver.model = "ghost/none";
  h.setText(JSON.stringify(broken));
  h.script("codex", "Edit", "implementer", "Change", FLASH, "high", "Save", "Done");
  await h.command("manage");
  assert.equal(h.writes.length, 1);
  assert.deepEqual(saved(h).profiles.codex.agents.implementer, { model: FLASH, thinking: "high" });
  assert.ok(!h.notifications.some(text => /^Not saved/.test(text)));
  assert.ok(h.notifications.some(text => /saved but not applied \(profiles\.codex: agents\.archiver: Unavailable model: ghost\/none/.test(text)));
});

test("activation failure of the edited selected profile is reported as saved but not applied", async () => {
  const h = harness();
  await h.emit("session_start");
  h.failModel("claude-opus-5-5");
  h.script("balanced", "Edit", "Orchestrator", "Change", OPUS, "medium", "Save", "Done");
  await h.command("manage");
  assert.equal(h.writes.length, 1);
  assert.ok(h.notifications.some(text => /Configuration saved but not applied \(.*\/hprofile reload/.test(text)));
  assert.ok(!h.notifications.some(text => /^Configuration saved$/.test(text)));
  assert.match(h.statuses.at(-1)!, /profile: balanced/);
});

test("a file changed on disk since the menu was read is never overwritten", async () => {
  const h = harness();
  const other = structuredClone(h.config);
  other.profiles.claude.agents.reviewer.thinking = "low";
  const external = JSON.stringify(other);
  h.script("balanced", "Edit", "reviewer", "Remove", () => h.setText(external), "Save", "Discard", true, "Done");
  await h.command("manage");
  assert.equal(h.writes.length, 0);
  assert.equal(h.text(), external);
  assert.ok(h.notifications.some(text => /profile-cycler\.json changed on disk; reopen \/hprofile manage/.test(text)));
  const del = harness();
  del.script("claude", "Delete", () => del.setText(external), true, "Done");
  await del.command("manage");
  assert.equal(del.writes.length, 0);
  assert.ok(del.notifications.some(text => /changed on disk/.test(text)));
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

test("discovered roles with names the schema rejects are not offered and are counted as unreadable", async () => {
  const h = harness();
  const role = (name: string) => ({ name, source: "user" as const, filePath: `/a/${name}.md`, description: "d" });
  h.setDiscovery({ roles: [role("Bad Name"), role("scout")], diagnostics: [] });
  h.script("balanced", "Edit", "Discard", "Done");
  await h.command("manage");
  const options = h.offered.find(entry => entry.title.startsWith("Edit balanced"))!.options;
  assert.ok(options.some(option => option.startsWith("scout:")));
  assert.ok(!options.some(option => option.startsWith("Bad Name")));
  assert.ok(h.notifications.some(text => /^1 agent file/.test(text)));
});

test("the default save path writes the real file and its .bak under PI_CODING_AGENT_DIR", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hprofile-manage-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    const original = readFileSync(new URL("../examples/profile-cycler.json", import.meta.url), "utf8");
    writeFileSync(join(dir, "profile-cycler.json"), original);
    const h = harness({ realStore: true });
    h.script("balanced", "Edit", "reviewer", "Remove", "Save", "Done");
    await h.command("manage");
    assert.equal(readFileSync(join(dir, "profile-cycler.json.bak"), "utf8"), original);
    assert.equal(parseConfig(readFileSync(join(dir, "profile-cycler.json"), "utf8")).profiles.balanced.agents.reviewer, undefined);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
