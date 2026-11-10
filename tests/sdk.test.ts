import { test } from "node:test";
import assert from "node:assert/strict";
import { runToolCall, type AgentTool } from "@earendil-works/pi-agent-core";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { harness } from "./harness.ts";
import { ENTRY_TYPE, restoreSelection } from "../src/state.ts";

test("published Pi tool pipeline executes in-place routed arguments and blocks failed preflight", async () => {
  const h = harness(); await h.emit("session_start");
  let executed: unknown;
  const tool: AgentTool = {
    name: "subagent", label: "contract fixture", description: "No agents or models are started",
    parameters: { type: "object", properties: { agent: { type: "string" }, task: { type: "string" }, model: { type: "string" } }, required: ["agent", "task"] },
    execute: async (_id, args) => { executed = args; return { content: [{ type: "text", text: "fixture executed" }], details: {} }; },
  };
  const call = { type: "toolCall" as const, id: "test", name: "subagent", arguments: { agent: "implementer", task: "fixture" } };
  const options = {
    tools: [tool], context: { messages: [], tools: [tool], systemPrompt: "" },
    assistantMessage: {
      role: "assistant" as const, content: [call], api: "openai-responses" as const, provider: "test", model: "test", stopReason: "toolUse" as const, timestamp: 0,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    },
    beforeToolCall: async ({ args }: { args: unknown }) => await h.emit("tool_call", { toolName: "subagent", input: args as Record<string, unknown> }) as { block: boolean; reason: string } | undefined,
  };
  const result = await runToolCall(call, options);
  assert.equal(result.isError, false);
  const route = h.config.profiles.balanced.agents.implementer;
  assert.deepEqual(executed, { agent: "implementer", task: "fixture", model: `${route.model}:${route.thinking}` });
  executed = undefined;
  h.models.splice(h.models.findIndex(model => model.provider === "antigravity"), 1);
  const blocked = await runToolCall(call, options);
  assert.equal(blocked.isError, true); assert.equal(executed, undefined);
});

test("real in-memory Pi session branches restore reachable custom selections without files", () => {
  const manager = SessionManager.inMemory(process.cwd());
  const balanced = manager.appendCustomEntry(ENTRY_TYPE, { version: 1, profile: "balanced" });
  const claude = manager.appendCustomEntry(ENTRY_TYPE, { version: 1, profile: "claude" });
  manager.branch(balanced);
  manager.appendCustomEntry(ENTRY_TYPE, { version: 1, profile: "codex" });
  assert.equal(restoreSelection(manager.getBranch()), "codex");
  manager.branch(claude);
  assert.equal(restoreSelection(manager.getBranch()), "claude");
});
