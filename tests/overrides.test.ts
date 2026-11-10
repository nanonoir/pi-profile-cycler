import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.ts";
import { validateConfig } from "../src/config.ts";
import { ENTRY_TYPE } from "../src/state.ts";

test("replacing a pending tree intent cannot leave its unverified early route active on failure", async () => {
  const h = harness(); await h.emit("session_start");
  h.setBranch([{ type: "custom", customType: ENTRY_TYPE, data: { version: 1, profile: "claude" } }]);
  h.setIdle(false); await h.emit("session_tree");
  await h.command("codex");
  h.failModel("gpt-6.1-sol"); h.setIdle(true); await h.emit("agent_settled");
  assert.match(h.statuses.at(-1)!, /unavailable/);
  assert.equal((await h.emit("tool_call", { toolName: "agent_spawn", input: { agents: [] } }) as { block: boolean }).block, true);
});

test("reload fulfilling a pending branch default pins it before clearing the pending intent", async () => {
  const h = harness(); await h.emit("session_start");
  h.setBranch([]); h.setIdle(false); await h.emit("session_tree");
  assert.equal(h.branch().length, 0);
  h.setIdle(true); await h.command("reload");
  assert.equal(h.branch().length, 1);
  assert.deepEqual(h.branch()[0], { type: "custom", customType: ENTRY_TYPE, data: { version: 1, profile: "balanced" } });
  assert.equal(h.statuses.at(-1), "profile: balanced");
  const candidate = structuredClone(h.config); candidate.defaultProfile = "codex";
  h.setText(JSON.stringify(candidate)); await h.emit("session_start");
  assert.equal(h.statuses.at(-1), "profile: balanced");
  assert.equal(h.branch().length, 1);
});

test("reload pins an early default even when another pending profile replaced its intent", async () => {
  const h = harness(); await h.emit("session_start");
  h.setBranch([]); h.setIdle(false); await h.emit("session_tree");
  await h.command("claude");
  h.setIdle(true); await h.command("reload");
  assert.deepEqual(h.branch()[0], { type: "custom", customType: ENTRY_TYPE, data: { version: 1, profile: "balanced" } });
  h.failModel("claude-opus-5-5"); await h.emit("agent_settled");
  assert.equal(h.statuses.at(-1), "profile: balanced");
  const candidate = structuredClone(h.config); candidate.defaultProfile = "codex";
  h.setText(JSON.stringify(candidate)); await h.emit("session_start");
  assert.equal(h.statuses.at(-1), "profile: balanced");
  assert.equal(h.branch().length, 1);
});

test("manual parent model override is visible and does not change selected future-spawn routing", async () => {
  const h = harness(); await h.emit("session_start");
  const opus = h.models.find(model => model.id === "claude-opus-5-5")!;
  await h.api.setModel(opus);
  await h.command("status");
  const notice = h.notifications.at(-1)!;
  assert.match(notice, /Selected: balanced/);
  assert.match(notice, /Effective parent: claude-code\/claude-opus-5-5/);
  assert.match(notice, /Configured parent: openai\/gpt-6.1-sol/);
  const input = { agents: [{ profile: "implementer", job: "fixture" }] };
  await h.emit("tool_call", { toolName: "agent_spawn", input });
  assert.equal((input.agents[0] as Record<string, unknown>).model, h.config.profiles.balanced.agents.implementer.model);
});

test("additional profiles work, but command names cannot shadow selectable profiles", () => {
  const h = harness();
  const config = structuredClone(h.config);
  config.profiles.custom = config.profiles.balanced;
  config.order.push("custom");
  assert.equal(validateConfig(config).profiles.custom.main!.model, config.profiles.balanced.main!.model);
  for (const name of ["next", "status", "reload", "manage"]) {
    const invalid = structuredClone(h.config);
    invalid.profiles[name] = invalid.profiles.balanced;
    invalid.order.push(name);
    assert.throws(() => validateConfig(invalid), /reserved command name/);
  }
});

test("default-only profile switches the parent to default and routes unconfigured agents", async () => {
  const h = harness();
  const config = structuredClone(h.config);
  config.profiles.solo = { default: { model: "claude-code/claude-opus-5-5", thinking: "medium" }, agents: { reviewer: { model: "antigravity/gemini-3-8-flash", thinking: "high" } } };
  config.order.push("solo");
  h.setText(JSON.stringify(config)); await h.emit("session_start");
  await h.command("solo");
  await h.command("status");
  const notice = h.notifications.at(-1)!;
  assert.match(notice, /Configured parent: claude-code\/claude-opus-5-5 \(medium\) \[from default\]/);
  assert.match(notice, /default: claude-code\/claude-opus-5-5 \(medium\)/);
  assert.match(notice, /reviewer: antigravity\/gemini-3-8-flash \(high\)/);
  assert.match(notice, /Unconfigured and unknown roles use the default/);
  const input = { agents: [{ name: "teacher" }, { name: "reviewer", model: "user/m" }] };
  await h.emit("tool_call", { toolName: "agent_spawn", input });
  assert.deepEqual(input.agents, [{ name: "teacher", model: "claude-code/claude-opus-5-5", thinking: "medium" }, { name: "reviewer", model: "user/m" }]);
  await h.command("balanced"); await h.command("status");
  assert.match(h.notifications.at(-1)!, /\[from main\][\s\S]*use native routing/);
});
