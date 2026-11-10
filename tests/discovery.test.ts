import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { discoverRoles } from "../src/discovery.ts";

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "discovery-test-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  mkdirSync(cwd, { recursive: true });
  const write = (base: string, file: string, content: string) => { mkdirSync(join(base, "agents"), { recursive: true }); writeFileSync(join(base, "agents", file), content); };
  const agent = (name: string, extra = "") => `---\nname: ${name}\ndescription: ${name} agent\n${extra}---\nBody\n`;
  return { root, agentDir, cwd, projectPi: join(cwd, ".pi"), write, agent, done: () => rmSync(root, { recursive: true, force: true }) };
}

test("discovers user agents with native route fields", () => {
  const s = sandbox();
  try {
    s.write(s.agentDir, "b.md", s.agent("b", "model: p/m\nthinking: low\n"));
    s.write(s.agentDir, "a.md", s.agent("a"));
    const { roles, diagnostics } = discoverRoles(s.cwd, true, s.agentDir);
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(roles.map(r => [r.name, r.source, r.model, r.thinking]), [["a", "user", undefined, undefined], ["b", "user", "p/m", "low"]]);
  } finally { s.done(); }
});

test("trusted project agents override user ones and sort first", () => {
  const s = sandbox();
  try {
    s.write(s.agentDir, "a.md", s.agent("a"));
    s.write(s.agentDir, "z.md", s.agent("z"));
    s.write(s.projectPi, "z.md", s.agent("z"));
    const { roles } = discoverRoles(s.cwd, true, s.agentDir);
    assert.deepEqual(roles.map(r => [r.name, r.source]), [["z", "project"], ["a", "user"]]);
  } finally { s.done(); }
});

test("untrusted project agents are ignored", () => {
  const s = sandbox();
  try {
    s.write(s.projectPi, "p.md", s.agent("p"));
    assert.deepEqual(discoverRoles(s.cwd, false, s.agentDir).roles, []);
  } finally { s.done(); }
});

test("project .pi equal to the agent dir counts as user only", () => {
  const s = sandbox();
  try {
    s.write(s.projectPi, "a.md", s.agent("a"));
    const { roles } = discoverRoles(s.cwd, true, s.projectPi);
    assert.deepEqual(roles.map(r => [r.name, r.source]), [["a", "user"]]);
  } finally { s.done(); }
});

test("invalid files become diagnostics and non-markdown files are ignored", () => {
  const s = sandbox();
  try {
    s.write(s.agentDir, "bad.md", "---\nname: [unclosed\n---\n");
    s.write(s.agentDir, "noname.md", "---\ndescription: x\n---\n");
    s.write(s.agentDir, "extra.md", s.agent("extra", "color: red\n"));
    s.write(s.agentDir, "level.md", s.agent("level", "thinking: nope\n"));
    s.write(s.agentDir, "plain.md", "no frontmatter");
    s.write(s.agentDir, "notes.txt", s.agent("txt"));
    s.write(s.agentDir, "ok.md", s.agent("ok"));
    const { roles, diagnostics } = discoverRoles(s.cwd, true, s.agentDir);
    assert.deepEqual(roles.map(r => r.name), ["ok"]);
    assert.deepEqual(diagnostics.map(d => d.filePath.split(/[\\/]/).pop()).sort(), ["bad.md", "extra.md", "level.md", "noname.md", "plain.md"]);
    assert.ok(diagnostics.every(d => d.source === "user" && d.message));
  } finally { s.done(); }
});

test("missing directories yield nothing without diagnostics or creating files", () => {
  const s = sandbox();
  try {
    assert.deepEqual(discoverRoles(s.cwd, true, s.agentDir), { roles: [], diagnostics: [] });
    assert.equal(existsSync(s.agentDir), false);
    assert.equal(existsSync(s.projectPi), false);
  } finally { s.done(); }
});

test("matches mavam discoverProfiles", async () => {
  const s = sandbox();
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = s.agentDir;
  try {
    s.write(s.agentDir, "a.md", s.agent("a"));
    s.write(s.agentDir, "z.md", s.agent("z"));
    s.write(s.agentDir, "bad.md", s.agent("bad", "color: red\n"));
    s.write(s.projectPi, "z.md", s.agent("z", "model: p/m\n"));
    s.write(s.projectPi, "q.md", s.agent("q"));
    const jiti = createJiti(import.meta.url);
    const modulePath = fileURLToPath(new URL("../node_modules/pi-agents/src/catalog/profiles.ts", import.meta.url));
    const { discoverProfiles } = await jiti.import<{ discoverProfiles(cwd: string, trusted: boolean): { profiles: { name: string; source: string; filePath: string }[]; diagnostics: { filePath: string }[] } }>(modulePath);
    for (const trusted of [true, false]) {
      const mavam = discoverProfiles(s.cwd, trusted);
      const ours = discoverRoles(s.cwd, trusted, s.agentDir);
      assert.deepEqual(ours.roles.map(r => [r.name, r.source, r.filePath]), mavam.profiles.map(p => [p.name, p.source, p.filePath]));
      assert.deepEqual(ours.diagnostics.map(d => d.filePath), mavam.diagnostics.map(d => d.filePath));
    }
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    s.done();
  }
});
