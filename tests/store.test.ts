import { strict as assert } from "node:assert";
import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseConfig, type Config } from "../src/config.ts";
import { setRoute } from "../src/editing.ts";
import { serializeConfig, writeConfig, type StoreFs } from "../src/store.ts";
import * as nodeFs from "node:fs";

const exampleText = readFileSync(new URL("../examples/profile-cycler.json", import.meta.url), "utf8");
const base = () => parseConfig(exampleText);
const real: StoreFs = nodeFs;
function withDir(run: (dir: string, path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "hprofile-store-"));
  try { run(dir, join(dir, "profile-cycler.json")); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const changed = (config: Config) => setRoute(config, "claude", "default", { model: "claude-code/claude-haiku-5-5", thinking: "low" });

test("serializer round trips the example with stable key order", () => {
  const config = base(); const text = serializeConfig(config);
  assert.deepEqual(parseConfig(text), config);
  assert.ok(text.endsWith("}\n") && text.includes('\n  "version"'));
  assert.deepEqual(Object.keys(JSON.parse(text)), ["version", "defaultProfile", "order", "profiles"]);
  const edited = serializeConfig(changed(config));
  assert.deepEqual(Object.keys(JSON.parse(edited).profiles.claude), ["default", "main", "agents"]);
  assert.deepEqual(parseConfig(edited), changed(config));
});

test("serializer omits absent main and empty agents", () => {
  const config = parseConfig(JSON.stringify({ version: 2, defaultProfile: "a", order: ["a"], profiles: { a: { default: { model: "p/m", thinking: "off" } } } }));
  assert.deepEqual(JSON.parse(serializeConfig(config)).profiles.a, { default: { model: "p/m", thinking: "off" } });
});

test("writeConfig writes new file and backs up the previous one", () => withDir((dir, path) => {
  writeConfig(path, base());
  assert.deepEqual(readdirSync(dir), ["profile-cycler.json"]);
  writeFileSync(path, "old content");
  writeConfig(path, changed(base()));
  assert.equal(readFileSync(`${path}.bak`, "utf8"), "old content");
  assert.deepEqual(parseConfig(readFileSync(path, "utf8")), changed(base()));
  writeConfig(path, base());
  assert.deepEqual(parseConfig(readFileSync(`${path}.bak`, "utf8")), changed(base()));
  assert.deepEqual(readdirSync(dir).sort(), ["profile-cycler.json", "profile-cycler.json.bak"]);
}));

test("interrupted write leaves the original and no temp files", () => withDir((dir, path) => {
  writeFileSync(path, "original");
  const crash: StoreFs = { ...real, renameSync: () => { throw new Error("crash"); } };
  assert.throws(() => writeConfig(path, base(), crash), /crash/);
  assert.equal(readFileSync(path, "utf8"), "original");
  assert.deepEqual(readdirSync(dir).sort(), ["profile-cycler.json", "profile-cycler.json.bak"]);
  const failWrite: StoreFs = { ...real, writeSync: (fd, data, offset) => { real.writeSync(fd, data, offset, 10); throw new Error("disk full"); } };
  assert.throws(() => writeConfig(path, base(), failWrite), /disk full/);
  assert.equal(readFileSync(path, "utf8"), "original");
  assert.deepEqual(readdirSync(dir).sort(), ["profile-cycler.json", "profile-cycler.json.bak"]);
  writeConfig(path, base(), { ...real, renameSync });
  assert.deepEqual(parseConfig(readFileSync(path, "utf8")), base());
}));

test("short writes are retried until the whole file is written", () => withDir((_dir, path) => {
  let calls = 0;
  const trickle: StoreFs = { ...real, writeSync: (fd, data, offset, length) => { calls++; return real.writeSync(fd, data, offset, Math.min(length, 7)); } };
  writeConfig(path, base(), trickle);
  assert.ok(calls > 1);
  assert.deepEqual(parseConfig(readFileSync(path, "utf8")), base());
  const stuck: StoreFs = { ...real, writeSync: () => 0 };
  assert.throws(() => writeConfig(path, base(), stuck), /no progress/);
  assert.deepEqual(parseConfig(readFileSync(path, "utf8")), base());
}));

test("a failing .bak copy leaves the original intact and writes nothing", () => withDir((dir, path) => {
  writeFileSync(path, "original");
  const noBackup: StoreFs = { ...real, copyFileSync: () => { throw new Error("no space"); } };
  assert.throws(() => writeConfig(path, base(), noBackup), /no space/);
  assert.equal(readFileSync(path, "utf8"), "original");
  assert.deepEqual(readdirSync(dir), ["profile-cycler.json"]);
}));

test("the temp file is flushed to disk before the rename", () => withDir((_dir, path) => {
  const order: string[] = [];
  const spy: StoreFs = {
    ...real,
    fsyncSync: fd => { order.push("fsync"); real.fsyncSync(fd); },
    closeSync: fd => { order.push("close"); real.closeSync(fd); },
    renameSync: (from, to) => { order.push("rename"); real.renameSync(from, to); },
  };
  writeConfig(path, base(), spy);
  assert.deepEqual(order, ["fsync", "close", "rename"]);
}));

test("invalid config is never written", () => withDir((dir, path) => {
  writeFileSync(path, "original");
  const invalid = { ...base(), defaultProfile: "missing" } as Config;
  assert.throws(() => writeConfig(path, invalid), /defaultProfile/);
  assert.equal(readFileSync(path, "utf8"), "original");
  assert.deepEqual(readdirSync(dir), ["profile-cycler.json"]);
}));
