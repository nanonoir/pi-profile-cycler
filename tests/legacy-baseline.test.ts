import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { test } from "node:test";

test("v1 baseline records inverted names and global writes", () => {
  const config = JSON.parse(readFileSync(new URL("./fixtures/profile-cycler-v1.json", import.meta.url), "utf8"));
  assert.deepEqual(config.order, ["balanced", "codex-low", "claude-low"]);
  assert.equal(config.profiles["codex-low"].main.model, "claude-code/claude-opus-5-5");
  assert.equal(config.profiles["claude-low"].main.model, "openai-codex/gpt-6.1-sol");
  const source = readFileSync(new URL("./fixtures/pi-profile-cycler-v1.ts", import.meta.url), "utf8");
  assert.match(source, /function patchFrontmatter/);
  assert.match(source, /function storeActive/);
  assert.match(source, /registerShortcut\("alt\+p"/);
  assert.match(source, /registerCommand\("hprofile"/);
  assert.match(readFileSync(new URL("./fixtures/README-v1.md", import.meta.url), "utf8"), /personal extension v1/);
});
