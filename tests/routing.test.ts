import { test } from "node:test";
import assert from "node:assert/strict";
import { isLaunch, routeSubagent, type AgentIdentity } from "../src/routing.ts";

const routes = { implementer: { model: "provider/model", thinking: "medium" }, reviewer: { model: "other/model", thinking: "high" } };
const fallback = { model: "def/model", thinking: "off" };

test("a direct launch gets the role route as model:thinking; the input is not mutated", () => {
  const input = { agent: "implementer", task: "build", async: false };
  const original = structuredClone(input);
  assert.deepEqual(routeSubagent(input, routes, undefined, []), { model: "provider/model:medium" });
  assert.deepEqual(input, original);
});

test("precedence: explicit model > role > default > native; an explicit model gets no injected thinking", () => {
  const patch = (agent: string, model?: string, fb?: typeof fallback) => routeSubagent({ agent, task: "t", ...(model !== undefined ? { model } : {}) }, routes, fb, []);
  assert.deepEqual(patch("implementer", "user/model"), {});
  assert.deepEqual(patch("implementer", "user/model:low", fallback), {});
  assert.deepEqual(patch("implementer", " "), { model: "provider/model:medium" });
  assert.deepEqual(patch("teacher", undefined, fallback), { model: "def/model:off" });
  assert.deepEqual(patch("teacher"), {});
  assert.deepEqual(patch("constructor", undefined, fallback), { model: "def/model:off" }, "inherited names never match a role");
});

test("roles resolve through canonical name, localName, alias and package-qualified names", () => {
  const agents: AgentIdentity[] = [
    { name: "acme.implementer", localName: "implementer" },
    { name: "checker", localName: "checker", aliases: ["reviewer"] },
    { name: "pkg-a.twin", localName: "twin" }, { name: "pkg-b.twin", localName: "twin" },
  ];
  const model = (agent: string) => routeSubagent({ agent, task: "t" }, routes, undefined, agents).model;
  assert.equal(model("acme.implementer"), "provider/model:medium");
  assert.equal(model("implementer"), "provider/model:medium");
  assert.equal(model("checker"), "other/model:high", "alias key of the resolved agent");
  assert.equal(model("reviewer"), "other/model:high");
  assert.equal(model("twin"), undefined, "ambiguous local name resolves to nothing");
});

test("external-runner agents never get the default and a role route for one is rejected", () => {
  const agents: AgentIdentity[] = [{ name: "claude-code", external: true }, { name: "implementer", external: true }];
  assert.deepEqual(routeSubagent({ agent: "claude-code", task: "t" }, routes, fallback, agents), {});
  assert.throws(() => routeSubagent({ agent: "implementer", task: "t" }, routes, fallback, agents), /external CLI/);
});

test("tasks, chain steps and chain parallel items are routed individually; the rest passes through", () => {
  const input = {
    task: "orig",
    tasks: [{ agent: "implementer", task: "a" }, { agent: "reviewer", task: "b", model: "user/m" }, null],
    chain: [{ agent: "reviewer", task: "c", as: "x" }, { parallel: [{ agent: "implementer", task: "d" }, { agent: "teacher", task: "e", model: "z/z" }] }],
  };
  const original = structuredClone(input);
  const patch = routeSubagent(input, routes, undefined, []);
  assert.deepEqual(input, original);
  assert.deepEqual(patch, {
    tasks: [{ agent: "implementer", task: "a", model: "provider/model:medium" }, input.tasks[1], null],
    chain: [{ agent: "reviewer", task: "c", as: "x", model: "other/model:high" }, { parallel: [{ agent: "implementer", task: "d", model: "provider/model:medium" }, input.chain[1].parallel![1]] }],
  });
  assert.deepEqual(routeSubagent({ tasks: [{ agent: "implementer", task: "a", model: "u/m" }] }, routes, undefined, []), {}, "nothing to change yields an empty patch");
});

test("workflows, actions and non-launch or malformed input pass through untouched", () => {
  for (const input of [
    { workflow: true, agent: "implementer" }, { workflow: "flow", task: "t" }, { action: "status", agent: "implementer" },
    { action: "stop", id: "1" }, {}, { task: "no agent" }, { agent: 7 }, { tasks: "nope" }, null, "text", [],
  ]) {
    assert.equal(isLaunch(input), false);
    assert.deepEqual(routeSubagent(input, routes, fallback, []), {});
  }
});
