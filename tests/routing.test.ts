import { test } from "node:test";
import assert from "node:assert/strict";
import { routeSpawn } from "../src/routing.ts";

const routes = { implementer: { model: "provider/model", thinking: "medium" }, reviewer: { model: "other/model", thinking: "high" } };

test("explicit-wins routes a graph and preserves all other arguments without mutation", () => {
  const input = { agents: [
    { profile: "implementer", name: "reviewer", job: "build", model: "user/model", thinking: "low", tools: ["read"], spawn: true },
    { profile: "reviewer", job: "review", after: ["builder"], cwd: "project", skills: ["test"] },
    { name: "implementer", job: "compat", model: "user/model" },
    { name: "implementer", job: "thinking only", thinking: "xhigh" },
    { profile: "reviewer", job: "blank", model: " ", thinking: "" },
    { name: "ad-hoc", job: "native", model: "native/model" },
    { profile: "unknown", name: "implementer", job: "native profile" },
  ], failFast: true, extra: { preserve: true } };
  const original = structuredClone(input);
  const output = routeSpawn(input, routes);
  assert.deepEqual(input, original);
  assert.deepEqual(output, { ...input, agents: [
    input.agents[0],
    { ...input.agents[1], ...routes.reviewer },
    { ...input.agents[2], thinking: "medium" },
    { ...input.agents[3], model: "provider/model" },
    { ...input.agents[4], ...routes.reviewer },
    input.agents[5], input.agents[6],
  ] });
});

test("malformed batches fail atomically and inherited role names never match", () => {
  assert.throws(() => routeSpawn({}, routes), /agents/);
  const input = { agents: [{ name: "implementer" }, null] };
  assert.throws(() => routeSpawn(input, routes), /agents\[1\]/);
  assert.deepEqual(input, { agents: [{ name: "implementer" }, null] });
  assert.deepEqual(routeSpawn({ agents: [{ name: "constructor" }] }, routes), { agents: [{ name: "constructor" }] });
});

test("precedence per field: explicit > role > default > native", () => {
  const fallback = { model: "def/model", thinking: "off" };
  const input = { agents: [
    { name: "implementer", model: "user/model" },
    { name: "implementer", thinking: "xhigh" },
    { name: "teacher", job: "unconfigured" },
    { name: "teacher", model: "user/model", thinking: " " },
    { profile: "unknown", name: "implementer" },
  ] };
  const out = routeSpawn(input, routes, fallback).agents as Array<Record<string, unknown>>;
  assert.deepEqual(out.map(a => [a.model, a.thinking]), [
    ["user/model", "medium"], ["provider/model", "xhigh"], ["def/model", "off"], ["user/model", "off"], ["def/model", "off"],
  ]);
  const native = routeSpawn(input, routes).agents as Array<Record<string, unknown>>;
  assert.deepEqual(native[2], input.agents[2]);
  assert.deepEqual(native[4], input.agents[4]);
});
