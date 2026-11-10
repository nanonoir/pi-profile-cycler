import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.ts";
import { preflight, switchProfile } from "../src/switching.ts";

test("every route needs actual supported thinking before any parent mutation", () => {
  const h = harness();
  const gemini = h.models.find(model => model.provider === "antigravity")!;
  gemini.reasoning = false;
  assert.throws(() => preflight(h.config.profiles.balanced, h.ctx), /agents.reviewer.*Unsupported thinking high/);
  assert.equal(h.calls.length, 0);
});

test("commit failure restores actual previous parent and thinking", async () => {
  const h = harness(); const previous = h.model();
  await assert.rejects(switchProfile(h.api, h.ctx, h.config.profiles.codex, () => { throw new Error("session append failed"); }), /session append failed/);
  assert.equal(h.model(), previous); assert.equal(h.thinking(), "medium");
  assert.equal(h.branch().length, 0);
});

test("incomplete rollback is explicit and never commits", async () => {
  const h = harness(); let calls = 0; let committed = false;
  const api = {
    setModel: async () => { calls++; if (calls === 1) throw new Error("provider error"); return false; },
    getThinkingLevel: h.api.getThinkingLevel,
    setThinkingLevel: h.api.setThinkingLevel,
  };
  await assert.rejects(switchProfile(api, h.ctx, h.config.profiles.codex, () => { committed = true; }), /provider error; ROLLBACK INCOMPLETE/);
  assert.equal(committed, false);
});

test("no selected parent fails closed because rollback would be impossible", async () => {
  const h = harness(); Object.defineProperty(h.ctx, "model", { get: () => undefined });
  await assert.rejects(switchProfile(h.api, h.ctx, h.config.profiles.codex, () => {}), /No current parent model/);
  assert.equal(h.calls.length, 0);
});
