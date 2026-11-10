import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.ts";
import { ENTRY_TYPE } from "../src/state.ts";
import { registerCycler } from "../src/index.ts";

test("inside a pi-subagents child nothing is registered and no model is touched; otherwise registration is unchanged", async () => {
  const registered: string[] = [];
  const api = new Proxy({}, { get: (_target, name: string) => (...args: unknown[]) => { registered.push(`${name}:${String(args[0])}`); } });
  registerCycler(api as never, { env: { PI_SUBAGENT_CHILD: "1" } });
  assert.equal(registered.length, 0, "no handlers, command, shortcut, setModel or appendEntry");
  registerCycler(api as never, { env: { PI_SUBAGENT_CHILD: "0" } });
  registerCycler(api as never, { env: {} });
  assert.equal(registered.filter(entry => entry.startsWith("registerCommand:hprofile")).length, 2);
  assert.ok(registered.includes("registerShortcut:alt+m") && registered.includes("on:tool_call"));
});

test("commands and shortcut cycle A B C A, menu and status show effective routes", async () => {
  const h = harness();
  assert.equal(h.calls.length, 0, "registration has no side effects");
  await h.emit("session_start");
  assert.equal(h.branch().length, 1);
  await h.shortcut(); assert.match(h.statuses.at(-1)!, /profile: claude/);
  await h.command("next"); assert.match(h.statuses.at(-1)!, /profile: codex/);
  await h.command("balanced"); assert.match(h.statuses.at(-1)!, /profile: balanced/);
  h.setAnswer("claude"); await h.command("");
  await h.command("status");
  assert.match(h.notifications.at(-1)!, /Effective parent: claude-code\/claude-opus-5-5/);
  assert.match(h.notifications.at(-1)!, /Nested helpers unsupported/);
  await h.command("not-found"); assert.match(h.notifications.at(-1)!, /Unknown profile/);
  h.setAnswer(undefined); await h.command("");
});

const routed = (route: { model: string; thinking: string }) => `${route.model}:${route.thinking}`;

test("direct tool hook changes the original argument object only for subagent launches; all-or-nothing preflight", async () => {
  const h = harness(); await h.emit("session_start");
  const implementer = routed(h.config.profiles.balanced.agents.implementer);
  const input: Record<string, unknown> = { agent: "implementer", task: "build", async: false };
  await h.emit("tool_call", { toolName: "other", input });
  assert.equal(input.model, undefined);
  assert.equal(await h.emit("tool_call", { toolName: "subagent", input }), undefined);
  assert.deepEqual(input, { agent: "implementer", task: "build", async: false, model: implementer });
  const teacher: Record<string, unknown> = { agent: "teacher", task: "teach" };
  const explicit: Record<string, unknown> = { agent: "reviewer", task: "check", model: "user/model" };
  const status: Record<string, unknown> = { action: "status", agent: "implementer" };
  for (const call of [teacher, explicit, status]) await h.emit("tool_call", { toolName: "subagent", input: call });
  assert.deepEqual(teacher, { agent: "teacher", task: "teach" });
  assert.equal(explicit.model, "user/model"); // explicit request wins
  assert.equal(status.model, undefined);
  h.models.splice(h.models.findIndex(model => model.provider === "antigravity"), 1);
  const blocked: Record<string, unknown> = { agent: "implementer", task: "again" };
  assert.equal((await h.emit("tool_call", { toolName: "subagent", input: blocked }) as { block: boolean }).block, true);
  assert.deepEqual(blocked, { agent: "implementer", task: "again" });
  assert.equal(await h.emit("tool_call", { toolName: "subagent", input: { action: "status" } }), undefined, "management calls are never blocked");
});

test("launch roles resolve through discovered aliases and external-runner agents are never given the default", async () => {
  const h = harness(); await h.emit("session_start");
  h.setDiscovery({ roles: [{ name: "pkg.implementer", localName: "implementer", source: "user", filePath: "/a", description: "d" }, { name: "claude-code", external: true, source: "user", filePath: "/b", description: "d" }], diagnostics: [] });
  const qualified: Record<string, unknown> = { agent: "pkg.implementer", task: "t" };
  await h.emit("tool_call", { toolName: "subagent", input: qualified });
  assert.equal(qualified.model, routed(h.config.profiles.balanced.agents.implementer));
  const external: Record<string, unknown> = { agent: "claude-code", task: "t" };
  assert.equal(await h.emit("tool_call", { toolName: "subagent", input: external }), undefined);
  assert.equal(external.model, undefined);
});

test("discovery runs lazily: not at all when every launch carries an explicit model", async () => {
  const h = harness(); await h.emit("session_start");
  let runs = 0;
  h.setDiscovery({ get roles() { runs++; return []; }, diagnostics: [] });
  await h.emit("tool_call", { toolName: "subagent", input: { agent: "implementer", task: "t", model: "user/model" } });
  assert.equal(runs, 0);
  await h.emit("tool_call", { toolName: "subagent", input: { agent: "implementer", task: "t" } });
  assert.equal(runs, 1);
});

test("/hprofile status warns when pi-subagents builtin agents were not found", async () => {
  const h = harness(); await h.emit("session_start");
  await h.command("status");
  assert.doesNotMatch(h.notifications.at(-1)!, /builtin agents not found/);
  h.setDiscovery({ roles: [], diagnostics: [], builtinMissing: true });
  await h.command("status");
  assert.match(h.notifications.at(-1)!, /pi-subagents builtin agents not found; external CLI builtins may receive the default/);
});

test("reload warns, without failing, when the file routes a discovered external CLI agent", async () => {
  const h = harness(); await h.emit("session_start");
  h.setDiscovery({ roles: [{ name: "implementer", external: true, source: "builtin", filePath: "/b", description: "d" }], diagnostics: [] });
  await h.command("reload");
  assert.ok(h.notifications.some(text => /profiles\.balanced\.agents\.implementer: .*external CLI/.test(text)));
  assert.ok(!h.notifications.some(text => /Profile error/.test(text)));
});

test("switch failure/clamping rolls back and does not persist a false selection", async () => {
  const h = harness(); await h.emit("session_start");
  const before = h.model(); const count = h.branch().length;
  h.failModel("claude-opus-5-5"); await h.command("claude");
  assert.equal(h.model(), before); assert.equal(h.branch().length, count);
  assert.match(h.notifications.at(-1)!, /Authentication unavailable/);
  h.failModel(undefined); h.setClamp(true); await h.command("codex");
  assert.equal(h.model(), before); assert.equal(h.thinking(), "medium");
  assert.equal(h.branch().length, count); assert.match(h.notifications.at(-1)!, /clamped/);
});

test("busy activation is queued until settled, not agent_end, and old routes remain active", async () => {
  const h = harness(); await h.emit("session_start"); h.setIdle(false);
  await h.command("claude"); assert.match(h.statuses.at(-1)!, /pending: claude/);
  const count = h.calls.length;
  await h.emit("agent_end"); assert.equal(h.calls.length, count);
  await h.emit("agent_settled"); assert.equal(h.calls.length, count);
  const input: Record<string, unknown> = { agent: "implementer", task: "old" };
  await h.emit("tool_call", { toolName: "subagent", input });
  assert.equal(input.model, routed(h.config.profiles.balanced.agents.implementer));
  h.setIdle(true); await h.emit("agent_settled");
  assert.match(h.statuses.at(-1)!, /^profile: claude$/);
});

test("restoration respects branch, reload/resume/fork and independent extension instances", async () => {
  const a = harness(); const b = harness(); await a.emit("session_start"); await b.emit("session_start");
  const common = structuredClone(a.branch());
  await a.command("claude"); await b.command("codex");
  const count = a.branch().length;
  await a.emit("session_start"); assert.equal(a.branch().length, count);
  assert.match(a.statuses.at(-1)!, /claude/); assert.match(b.statuses.at(-1)!, /codex/);
  a.setBranch(common); await a.emit("session_tree");
  assert.match(a.statuses.at(-1)!, /balanced/); assert.equal(a.branch().length, common.length);
  a.setBranch([{ type: "custom", customType: ENTRY_TYPE, data: { version: 1, profile: "removed" } }]);
  await a.emit("session_start"); assert.match(a.statuses.at(-1)!, /unavailable/);
  assert.equal((await a.emit("tool_call", { toolName: "subagent", input: { agent: "implementer", task: "t" } }) as { block: boolean }).block, true);
});

const profiles = (branch: unknown[]) => (branch as { data: { profile: string } }[]).map(entry => entry.data.profile);
const settles = (promise: Promise<unknown>) => { const state = { done: false }; void promise.then(() => { state.done = true; }); return state; };
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test("parent run starting during an in-flight setModel is gated at before_agent_start, without deadlock", async () => {
  const h = harness(); await h.emit("session_start");
  const release = h.deferSetModel();
  const switching = h.command("claude");
  await tick();
  const start = settles(h.emit("before_agent_start"));
  await tick();
  assert.equal(start.done, false, "request boundary waits for the in-flight switch");
  assert.notEqual(h.model().id, "claude-opus-5-5");
  release(); await switching; await tick();
  assert.equal(start.done, true);
  assert.equal(h.model().id, "claude-opus-5-5");
  assert.match(h.statuses.at(-1)!, /^profile: claude$/);
});

test("navigation is cancelled with an explanation only while a switch applies", async () => {
  const h = harness(); await h.emit("session_start");
  const release = h.deferSetModel();
  const switching = h.command("codex"); await tick();
  for (const name of ["session_before_switch", "session_before_fork", "session_before_tree"]) {
    assert.deepEqual(await h.emit(name), { cancel: true });
  }
  assert.match(h.notifications.at(-1)!, /Navigation cancelled/);
  release(); await switching;
  for (const name of ["session_before_switch", "session_before_fork", "session_before_tree"]) {
    assert.equal(await h.emit(name), undefined);
  }
});

test("busy session_tree routes spawns to the branch profile now and applies the parent at before_agent_start", async () => {
  const h = harness(); await h.emit("session_start");
  h.setIdle(false); // SDK: branch-summary controller set, so isIdle() is false and no agent_settled follows
  h.setBranch([{ type: "custom", customType: ENTRY_TYPE, data: { version: 1, profile: "claude" } }]);
  const before = h.model(); const count = h.branch().length;
  await h.emit("session_tree");
  assert.match(h.statuses.at(-1)!, /profile: claude \(pending: claude\)/);
  assert.equal(h.model(), before, "parent untouched while busy");
  const input: Record<string, unknown> = { agent: "implementer", task: "x" };
  assert.equal(await h.emit("tool_call", { toolName: "subagent", input }), undefined);
  assert.equal(input.model, routed(h.config.profiles.claude.agents.implementer));
  await h.emit("before_agent_start"); // the next parent request is the safe boundary; isIdle() is still false
  assert.equal(h.model().id, "claude-opus-5-5");
  assert.match(h.statuses.at(-1)!, /^profile: claude$/);
  assert.equal(h.branch().length, count, "restored selection is not duplicated");
});

test("a pending profile survives reload, applies later, and is cancelled explicitly when removed", async () => {
  const h = harness(); await h.emit("session_start");
  h.setIdle(false); await h.command("codex"); h.setIdle(true);
  await h.command("reload");
  assert.match(h.statuses.at(-1)!, /pending: codex/);
  await h.emit("agent_settled");
  assert.match(h.statuses.at(-1)!, /^profile: codex$/);
  h.setIdle(false); await h.command("claude"); h.setIdle(true);
  const candidate = structuredClone(h.config);
  delete candidate.profiles.claude; candidate.order = ["balanced", "codex"];
  h.setText(JSON.stringify(candidate)); await h.command("reload");
  assert.match(h.notifications.join("\n"), /Pending profile claude cancelled/);
  assert.doesNotMatch(h.statuses.at(-1)!, /pending/);
});

test("with no selected profile, reload cancels a pending profile it removes", async () => {
  const h = harness();
  h.setBranch([{ type: "custom", customType: ENTRY_TYPE, data: { version: 1, profile: "ghost" } }]);
  await h.emit("session_start");
  assert.match(h.statuses.at(-1)!, /profile: unavailable/);
  h.setIdle(false); await h.command("codex"); h.setIdle(true);
  assert.match(h.statuses.at(-1)!, /pending: codex/);
  const candidate = structuredClone(h.config);
  delete candidate.profiles.codex; candidate.order = ["balanced", "claude"];
  h.setText(JSON.stringify(candidate)); await h.command("reload");
  assert.match(h.notifications.join("\n"), /Pending profile codex cancelled: profile removed by reload/);
  assert.doesNotMatch(h.statuses.at(-1)!, /pending/);
});

test("a pending profile that fails to apply is cancelled explicitly, and an applied one supersedes with a notice", async () => {
  const h = harness(); await h.emit("session_start");
  h.setIdle(false); await h.command("claude"); h.setIdle(true);
  h.failModel("claude-opus-5-5"); await h.emit("agent_settled");
  assert.match(h.notifications.join("\n"), /Pending profile claude cancelled/);
  assert.doesNotMatch(h.statuses.at(-1)!, /pending/);
  h.failModel(undefined);
  h.setIdle(false); await h.command("claude"); h.setIdle(true);
  await h.command("codex");
  assert.match(h.notifications.join("\n"), /Pending profile claude cancelled: superseded by codex/);
});

test("session replaced during an in-flight switch rolls it back and never persists a stale selection", async () => {
  const h = harness(); await h.emit("session_start");
  const before = h.model();
  const release = h.deferSetModel();
  const switching = h.command("claude"); await tick();
  const restart = settles(h.emit("session_start"));
  await tick();
  assert.equal(restart.done, false, "restore waits for the stale switch to roll back");
  release(); await switching; await tick();
  assert.equal(restart.done, true);
  assert.equal(profiles(h.branch()).includes("claude"), false);
  assert.equal(h.model(), before);
  assert.match(h.statuses.at(-1)!, /^profile: balanced$/);
});

test("busy tree reconcile whose parent apply fails clears the early route and blocks spawns (saved and default)", async () => {
  const blocked = async (h: ReturnType<typeof harness>) => {
    assert.match(h.notifications.at(-1)!, /Pending profile \w+ cancelled.*Direct launches blocked/);
    assert.doesNotMatch(h.notifications.at(-1)!, /Parent model unchanged/);
    assert.match(h.statuses.at(-1)!, /^profile: unavailable$/);
    assert.equal((await h.emit("tool_call", { toolName: "subagent", input: { agent: "implementer", task: "t" } }) as { block: boolean }).block, true);
  };
  const saved = harness(); await saved.emit("session_start");
  saved.setIdle(false);
  saved.setBranch([{ type: "custom", customType: ENTRY_TYPE, data: { version: 1, profile: "claude" } }]);
  await saved.emit("session_tree");
  assert.match(saved.statuses.at(-1)!, /profile: claude \(pending: claude\)/);
  saved.failModel("claude-opus-5-5"); await saved.emit("before_agent_start");
  await blocked(saved);
  assert.equal(saved.branch().length, 1);

  const fresh = harness(); await fresh.emit("session_start"); await fresh.command("codex");
  fresh.setBranch([]); fresh.setIdle(false);
  await fresh.emit("session_tree");
  assert.match(fresh.statuses.at(-1)!, /profile: balanced \(pending: balanced\)/);
  fresh.failModel(fresh.config.profiles.balanced.main!.model.split("/")[1]); await fresh.emit("before_agent_start");
  await blocked(fresh);
  assert.equal(fresh.branch().length, 0, "unapplied default is never pinned");
});

test("session_shutdown awaits rollback before the API is invalidated and rejects later activations", async () => {
  const old = harness(); await old.emit("session_start");
  const before = old.model(); const callsBefore = old.calls.length;
  const release = old.deferSetModel();
  const switching = old.command("claude"); await tick();
  const shutdown = settles(old.emit("session_shutdown"));
  await tick();
  assert.equal(shutdown.done, false, "shutdown does not return while the switch is unwinding");
  release(); await switching; await tick();
  assert.equal(shutdown.done, true);
  assert.equal(old.model(), before, "rolled back before invalidation");
  const calls = old.calls.length;
  await old.command("codex");
  assert.match(old.notifications.at(-1)!, /shutting down/);
  assert.equal(old.calls.length, calls);
  old.invalidate();
  const replacement = harness(); await replacement.emit("session_start");
  await tick();
  assert.deepEqual(old.violations, [], "no use of the old API after invalidation");
  assert.equal(profiles(old.branch()).includes("claude"), false);
  assert.ok(old.calls.length > callsBefore);
  assert.match(replacement.statuses.at(-1)!, /^profile: balanced$/);
});

test("busy tree navigation queues (isIdle false at before_session_tree); no sticky lock when another extension cancels", async () => {
  const h = harness(); await h.emit("session_start");
  h.setIdle(false); // navigateTree sets the branch-summary controller before session_before_tree
  assert.equal(await h.emit("session_before_tree"), undefined, "nothing applying, so nothing to cancel");
  const count = h.calls.length;
  await h.command("claude");
  assert.match(h.statuses.at(-1)!, /pending: claude/); assert.equal(h.calls.length, count);
  // Another extension cancelled the navigation: no session_tree and possibly no settle. Next request applies it.
  await h.emit("before_agent_start");
  assert.equal(h.model().id, "claude-opus-5-5");
  assert.equal(await h.emit("session_before_tree"), undefined);
});

test("session_tree reuses the cached validated config; only session_start and reload reread the file", async () => {
  const h = harness(); await h.emit("session_start");
  h.setText("bad JSON");
  h.setBranch([{ type: "custom", customType: ENTRY_TYPE, data: { version: 1, profile: "claude" } }]);
  const before = h.notifications.length;
  await h.emit("session_tree");
  assert.match(h.statuses.at(-1)!, /^profile: claude$/);
  assert.doesNotMatch(h.notifications.slice(before).join("\n"), /invalid JSON/);
  const edited = structuredClone(h.config); edited.defaultProfile = "codex";
  h.setText(JSON.stringify(edited)); h.setBranch([]);
  await h.emit("session_tree");
  assert.match(h.statuses.at(-1)!, /^profile: balanced$/, "edited default is not picked up by tree");
  h.setText("bad JSON"); await h.emit("session_start");
  assert.match(h.notifications.join("\n"), /invalid JSON/);
  assert.match(h.statuses.at(-1)!, /unavailable/);
});

test("reload keeps valid previous config on failure and requires choice when selection is removed", async () => {
  const h = harness(); await h.emit("session_start");
  h.setText("bad JSON"); await h.command("reload"); assert.match(h.notifications.at(-1)!, /invalid JSON/);
  await h.command("next"); assert.match(h.statuses.at(-1)!, /claude/);
  const candidate = structuredClone(h.config);
  delete candidate.profiles.claude; candidate.order = ["balanced", "codex"];
  h.setText(JSON.stringify(candidate)); await h.command("reload");
  assert.match(h.statuses.at(-1)!, /unavailable/); assert.match(h.notifications.at(-1)!, /choose/);
  await h.command("codex"); assert.match(h.statuses.at(-1)!, /codex/);
  const count = h.branch().length; await h.command("reload"); assert.equal(h.branch().length, count);
});
