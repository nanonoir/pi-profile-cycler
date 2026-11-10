import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { migrateLegacyJson, parentRoute, parseConfig, parseJson, validateConfig, THINKING_LEVELS } from "../src/config.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const example = () => JSON.parse(read("../examples/profile-cycler.json"));

test("approved example has complete matrix and matches root and legacy migration", () => {
  const config = parseConfig(read("../examples/profile-cycler.json"));
  assert.deepEqual(config, parseConfig(read("../profile-cycler.json")));
  assert.deepEqual(config, migrateLegacyJson(read("./fixtures/profile-cycler-v1.json")));
  assert.deepEqual(config.order, ["balanced", "claude", "codex"]);
  for (const profile of Object.values(config.profiles)) {
    for (const role of ["reviewer", "explorer", "archiver"]) assert.deepEqual(profile.agents[role], { model: "antigravity/gemini-3-8-flash", thinking: "high" });
  }
});

test("strict errors identify fields", () => {
  const cases: Array<[string, (value: ReturnType<typeof example>) => void, RegExp]> = [
    ["version", v => { v.version = 1; }, /\$\.version/],
    ["unexpected", v => { v.profiles.balanced.main.extra = 1; }, /\$\.profiles\.balanced\.main\.extra/],
    ["model", v => { v.profiles.codex.main.model = "bad/"; }, /\$\.profiles\.codex\.main\.model/],
    ["thinking", v => { v.profiles.codex.main.thinking = "maximum"; }, /\$\.profiles\.codex\.main\.thinking/],
    ["default", v => { v.defaultProfile = "missing"; }, /\$\.defaultProfile/],
    ["duplicate order", v => { v.order[1] = "balanced"; }, /\$\.order\[1\]/],
    ["unknown order", v => { v.order[1] = "missing"; }, /\$\.order\[1\]/],
    ["unordered", v => { v.order.pop(); }, /\$\.profiles\.codex/],
    ["unsafe role", v => { v.profiles.codex.agents["../x"] = v.profiles.codex.main; }, /\.agents\.\.\.\/x/],
  ];
  for (const [label, change, expected] of cases) { const value = example(); change(value); assert.throws(() => validateConfig(value), expected, label); }
  for (const level of THINKING_LEVELS) { const value = example(); value.profiles.codex.main.thinking = level; assert.doesNotThrow(() => validateConfig(value)); }
});

test("JSON duplicates including escaped keys and invalid syntax fail", () => {
  assert.throws(() => parseJson('{"a": {"x": 1, "\\u0078": 2}}'), /\$\.a\.x: duplicate/);
  assert.throws(() => parseJson('{"a":'), /\$: invalid JSON/);
  assert.deepEqual(parseJson('{"a":[{"x":"escaped \\\" text"},true,null,-1.3e2]}'), { a: [{ x: 'escaped " text' }, true, null, -130] });
});

test("migration uses content, keeps custom roles and rejects ambiguous profiles", () => {
  const legacy = JSON.parse(read("./fixtures/profile-cycler-v1.json"));
  legacy.profiles["codex-low"].agents.teacher = { model: "custom/teacher", thinking: "low" };
  const original = JSON.stringify(legacy);
  const result = migrateLegacyJson(original);
  assert.deepEqual(result.profiles.claude.agents.teacher, { model: "custom/teacher", thinking: "low" });
  assert.equal(JSON.stringify(legacy), original);
  [legacy.profiles["codex-low"], legacy.profiles["claude-low"]] = [legacy.profiles["claude-low"], legacy.profiles["codex-low"]];
  assert.deepEqual(migrateLegacyJson(JSON.stringify(legacy)).order, ["balanced", "codex", "claude"]);
  legacy.profiles["codex-low"].main.model = "unknown/model";
  assert.throws(() => migrateLegacyJson(JSON.stringify(legacy)), /\$\.profiles\.codex-low: ambiguous/);
});

test("roles, main and default are optional, but a profile needs main or default", () => {
  const route = { model: "p/m", thinking: "low" };
  const build = (profile: unknown) => ({ version: 2, defaultProfile: "a", order: ["a"], profiles: { a: profile } });
  const only = validateConfig(build({ default: route }));
  assert.deepEqual(only.profiles.a.default, route);
  assert.deepEqual(Object.keys(only.profiles.a.agents), []);
  assert.doesNotThrow(() => { const v = example(); delete v.profiles.claude.agents.reviewer; validateConfig(v); });
  assert.deepEqual(parentRoute(only.profiles.a), { route, source: "default" });
  assert.deepEqual(parentRoute(validateConfig(build({ main: route, default: { ...route, model: "p/d" } })).profiles.a), { route, source: "main" });
  assert.equal(validateConfig(build({ main: route, agents: { custom: route } })).profiles.a.agents.custom.model, "p/m");
  assert.throws(() => validateConfig(build({ agents: {} })), /\$\.profiles\.a\.main: profile must define main or default/);
  assert.throws(() => validateConfig(build({ default: { model: "bad", thinking: "low" } })), /\$\.profiles\.a\.default\.model/);
  assert.throws(() => validateConfig(build({ default: route, extra: 1 })), /\$\.profiles\.a\.extra/);
  assert.throws(() => validateConfig(build({ default: { ...route, x: 1 } })), /\$\.profiles\.a\.default\.x/);
  assert.throws(() => parseConfig('{"version":2,"defaultProfile":"a","order":["a"],"profiles":{"a":{"default":{"model":"p/m","thinking":"low"},"default":{"model":"p/m","thinking":"low"}}}}'), /duplicate JSON key/);
});
