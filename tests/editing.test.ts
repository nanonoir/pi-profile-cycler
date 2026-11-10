import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseConfig } from "../src/config.ts";
import { createProfile, deleteProfile, setDefaultProfile, setRoute } from "../src/editing.ts";

const base = () => parseConfig(readFileSync(new URL("../examples/profile-cycler.json", import.meta.url), "utf8"));
const route = { model: "claude-code/claude-haiku-5-5", thinking: "high" as const };

test("createProfile appends with a default route and rejects bad names", () => {
  const config = base(); const before = JSON.stringify(config);
  const next = createProfile(config, "fast", route);
  assert.deepEqual(next.order, [...config.order, "fast"]);
  assert.equal(JSON.stringify(next.profiles.fast), JSON.stringify({ agents: {}, default: route }));
  assert.equal(JSON.stringify(config), before);
  assert.throws(() => createProfile(config, "claude", route), /already exists/);
  assert.throws(() => createProfile(config, "manage", route), /reserved/);
  assert.throws(() => createProfile(config, "Bad Name", route), /name/);
  assert.throws(() => createProfile(config, "fast"), /default route/);
});

test("deleteProfile handles default replacement and last profile", () => {
  const config = base(); const before = JSON.stringify(config);
  const other = config.order.find(key => key !== config.defaultProfile)!;
  const next = deleteProfile(config, other);
  assert.ok(!next.order.includes(other) && !(other in next.profiles));
  assert.equal(next.defaultProfile, config.defaultProfile);
  assert.throws(() => deleteProfile(config, config.defaultProfile), /replacement/);
  assert.throws(() => deleteProfile(config, config.defaultProfile, config.defaultProfile), /replacement/);
  assert.throws(() => deleteProfile(config, config.defaultProfile, "missing"), /replacement/);
  const replaced = deleteProfile(config, config.defaultProfile, other);
  assert.equal(replaced.defaultProfile, other);
  assert.throws(() => deleteProfile(config, "missing"), /unknown profile/);
  assert.equal(JSON.stringify(config), before);
  const single = createProfile(deleteProfile(deleteProfile(config, "claude"), "codex", "balanced"), "solo", route);
  assert.throws(() => deleteProfile(deleteProfile(single, "balanced", "solo"), "solo"), /last profile/);
});

test("setDefaultProfile switches or rejects unknown", () => {
  const config = base();
  assert.equal(setDefaultProfile(config, "codex").defaultProfile, "codex");
  assert.throws(() => setDefaultProfile(config, "nope"), /unknown profile/);
});

test("setRoute adds, replaces and removes without mutating input", () => {
  const config = base(); const before = JSON.stringify(config);
  const added = setRoute(config, "claude", "default", route);
  assert.deepEqual(added.profiles.claude.default, route);
  const role = setRoute(added, "claude", { role: "teacher" }, route);
  assert.deepEqual(role.profiles.claude.agents.teacher, route);
  const replaced = setRoute(role, "claude", { role: "teacher" }, { ...route, thinking: "low" });
  assert.equal(replaced.profiles.claude.agents.teacher.thinking, "low");
  assert.ok(!("teacher" in setRoute(replaced, "claude", { role: "teacher" }, undefined).profiles.claude.agents));
  assert.equal(setRoute(added, "claude", "main", undefined).profiles.claude.main, undefined);
  assert.equal(JSON.stringify(config), before);
});

test("setRoute refuses to leave a profile without main or default", () => {
  const config = base();
  assert.throws(() => setRoute(config, "claude", "main", undefined), /main or default/);
  assert.throws(() => setRoute(config, "missing", "main", route), /unknown profile/);
  assert.throws(() => setRoute(config, "claude", { role: "BAD" }, route), /agents/);
  assert.throws(() => setRoute(config, "claude", "main", { model: "bad", thinking: "high" }), /model/);
});
