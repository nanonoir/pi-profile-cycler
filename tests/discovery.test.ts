import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { discoverRoles } from "../src/discovery.ts";

// Fixtures mirror pi-subagents 0.87.0 discovery (agents.js:450-479, 1651-1700, 1931-1970, 2207-2249, 2718-2760; agent-selection.js).
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "discovery-test-"));
  const home = join(root, "home");
  const agentDir = join(root, "agent");
  const project = join(home, "project"); // inside the fake home so the project-root walk stops there, not at the real home
  const cwd = join(project, "src");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(home, { recursive: true });
  const write = (dir: string, file: string, content: string) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, file), content); };
  const agent = (name: string, extra = "") => `---\nname: ${name}\ndescription: ${name} agent\n${extra}---\nBody\n`;
  const discover = (trusted = true, options: { env?: NodeJS.ProcessEnv; builtinDir?: string } = {}) => discoverRoles(cwd, trusted, agentDir, { home, builtinDir: join(root, "none"), env: {}, ...options });
  return { root, home, agentDir, project, cwd, write, agent, discover, userDir: join(agentDir, "agents"), projectPi: join(project, ".pi", "agents"), projectAgents: join(project, ".agents"), done: () => rmSync(root, { recursive: true, force: true }) };
}
const summary = (roles: Array<{ name: string; source: string }>) => roles.map(r => [r.name, r.source]);

test("discovers user agents with native model and thinking, sorted by name", () => {
  const s = sandbox();
  try {
    s.write(s.userDir, "b.md", s.agent("b", "model: p/m\nthinking: low\n"));
    s.write(s.userDir, "a.md", s.agent("a"));
    const { roles, diagnostics } = s.discover();
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(roles.map(r => [r.name, r.source, r.model, r.thinking]), [["a", "user", undefined, undefined], ["b", "user", "p/m", "low"]]);
  } finally { s.done(); }
});

test("precedence builtin < user (extra, agentDir, ~/.agents) < project (.agents, .pi/agents); project sorts first", () => {
  const s = sandbox();
  try {
    const extra = join(s.root, "extra");
    const builtinDir = join(s.root, "builtin");
    s.write(builtinDir, "w.md", s.agent("w", "model: builtin/m\n"));
    s.write(builtinDir, "scout.md", s.agent("scout"));
    s.write(extra, "w.md", s.agent("w", "model: extra/m\n"));
    s.write(s.userDir, "w.md", s.agent("w", "model: userdir/m\n"));
    s.write(join(s.home, ".agents"), "w.md", s.agent("w", "model: home/m\n"));
    s.write(join(s.home, ".agents"), "u.md", s.agent("u"));
    s.write(s.projectAgents, "p.md", s.agent("p", "model: legacy/m\n"));
    s.write(s.projectPi, "p.md", s.agent("p", "model: pi/m\n"));
    const { roles } = s.discover(true, { builtinDir, env: { PI_SUBAGENT_EXTRA_AGENT_DIRS: extra } });
    assert.deepEqual(roles.map(r => [r.name, r.source, r.model]), [["p", "project", "pi/m"], ["u", "user", undefined], ["w", "user", "home/m"], ["scout", "builtin", undefined]]);
  } finally { s.done(); }
});

test("untrusted projects are ignored and the project is the nearest ancestor holding .pi or .agents, never the home directory", () => {
  const s = sandbox();
  try {
    s.write(s.projectPi, "p.md", s.agent("p"));
    assert.deepEqual(s.discover(false).roles, []);
    assert.deepEqual(summary(s.discover(true).roles), [["p", "project"]]);
    // A home that is itself a candidate is user configuration, not a project.
    mkdirSync(join(s.home, ".pi", "agents"), { recursive: true });
    writeFileSync(join(s.home, ".pi", "agents", "h.md"), s.agent("h"));
    assert.deepEqual(discoverRoles(join(s.home, "work"), true, s.agentDir, { home: s.home, builtinDir: join(s.root, "none"), env: {} }).roles, []);
  } finally { s.done(); }
});

test("a project dir equal to a user dir counts as user only", () => {
  const s = sandbox();
  try {
    s.write(s.projectPi, "a.md", s.agent("a"));
    const { roles } = discoverRoles(s.cwd, true, join(s.project, ".pi"), { home: s.home, builtinDir: join(s.root, "none"), env: {} });
    assert.deepEqual(summary(roles), [["a", "user"]]);
  } finally { s.done(); }
});

test("scans recursively, prunes node_modules/.git/.pi/nested projects, skips .chain.md and .agents/skills", () => {
  const s = sandbox();
  try {
    s.write(join(s.userDir, "team", "deep"), "ok.md", s.agent("ok"));
    s.write(join(s.userDir, "node_modules"), "n.md", s.agent("npm"));
    s.write(join(s.userDir, ".git"), "g.md", s.agent("git"));
    s.write(join(s.userDir, ".pi"), "p.md", s.agent("pi"));
    s.write(join(s.userDir, "nested", ".pi"), "x.txt", "marker");
    s.write(join(s.userDir, "nested"), "n.md", s.agent("nested"));
    s.write(s.userDir, "flow.chain.md", s.agent("flow"));
    s.write(s.userDir, "notes.txt", s.agent("txt"));
    s.write(join(s.projectAgents, "skills"), "s.md", s.agent("skill"));
    s.write(s.projectAgents, "keep.md", s.agent("keep"));
    assert.deepEqual(summary(s.discover().roles), [["keep", "project"], ["ok", "user"]]);
  } finally { s.done(); }
});

test("names resolve through package, localName and aliases (alias/aliases, comma or list)", () => {
  const s = sandbox();
  try {
    s.write(s.userDir, "a.md", s.agent("worker", "package: Acme Tools\naliases: dev, coder, worker, acme-tools.worker\n"));
    s.write(s.userDir, "b.md", s.agent("checker", "alias:\n  - rev # comment\n  - qa\n"));
    const [worker, checker] = s.discover().roles;
    assert.deepEqual([worker.name, worker.localName, worker.aliases], ["acme-tools.worker", "worker", ["dev", "coder", "worker"]]);
    assert.deepEqual([checker.name, checker.localName, checker.aliases], ["checker", "checker", ["rev", "qa"]]);
  } finally { s.done(); }
});

test("external CLI/job runners are flagged; a pi runner is not; unknown runner types are diagnostics", () => {
  const s = sandbox();
  try {
    s.write(s.userDir, "cc.md", s.agent("cc", "runner:\n  type: external-cli\n  adapter: claude-code\n  command: claude\n"));
    s.write(s.userDir, "job.md", s.agent("job", "runner:\n  type: external-job\n  provider: x\n"));
    s.write(s.userDir, "pi.md", s.agent("pi", "runner:\n  type: pi\n"));
    s.write(s.userDir, "bad.md", s.agent("bad", "runner: nope\n"));
    const { roles, diagnostics } = s.discover();
    assert.deepEqual(roles.map(r => [r.name, r.external]), [["cc", true], ["job", true], ["pi", undefined]]);
    assert.deepEqual(diagnostics.map(d => d.filePath.split(/[\\/]/).pop()), ["bad.md"]);
  } finally { s.done(); }
});

test("files without name/description are skipped silently; invalid package becomes a diagnostic", () => {
  const s = sandbox();
  try {
    s.write(s.userDir, "noname.md", "---\ndescription: x\n---\n");
    s.write(s.userDir, "nodesc.md", "---\nname: n\n---\n");
    s.write(s.userDir, "plain.md", "no frontmatter");
    s.write(s.userDir, "pkg.md", s.agent("pkg", "package: ---\n"));
    s.write(s.userDir, "ok.md", s.agent("ok", 'model: "p/m"\n'));
    const { roles, diagnostics } = s.discover();
    assert.deepEqual(roles.map(r => [r.name, r.model]), [["ok", "p/m"]]);
    assert.deepEqual(diagnostics.map(d => d.filePath.split(/[\\/]/).pop()), ["pkg.md"]);
  } finally { s.done(); }
});

test("settings agentScanDirs add user dirs (literal and one * segment) below the agent dir", () => {
  const s = sandbox();
  try {
    const pack = join(s.root, "packs");
    s.write(join(pack, "one", "agents"), "o.md", s.agent("o", "model: scan/m\n"));
    s.write(join(pack, "two", "agents"), "t.md", s.agent("t"));
    s.write(join(s.root, "lit"), "l.md", s.agent("l"));
    s.write(s.userDir, "o.md", s.agent("o", "model: agentdir/m\n"));
    s.write(s.agentDir, "settings.json", JSON.stringify({ subagents: { agentScanDirs: [join(pack, "*", "agents"), join(s.root, "lit"), 4, join(s.root, "missing")] } }));
    assert.deepEqual(s.discover().roles.map(r => [r.name, r.model]), [["l", undefined], ["o", "agentdir/m"], ["t", undefined]]);
  } finally { s.done(); }
});

test("symlinked directories are followed once", { skip: process.platform === "win32" }, () => {
  const s = sandbox();
  try {
    s.write(join(s.root, "shared"), "sh.md", s.agent("sh"));
    mkdirSync(s.userDir, { recursive: true });
    symlinkSync(join(s.root, "shared"), join(s.userDir, "link"), "dir");
    symlinkSync(s.userDir, join(s.userDir, "loop"), "dir");
    assert.deepEqual(summary(s.discover().roles), [["sh", "user"]]);
  } finally { s.done(); }
});

test("missing directories yield nothing without diagnostics or creating files; the env list uses the platform delimiter", () => {
  const s = sandbox();
  try {
    assert.deepEqual(s.discover(true, { env: { PI_SUBAGENT_EXTRA_AGENT_DIRS: `${join(s.root, "a")}${delimiter}${join(s.root, "b")}` } }), { roles: [], diagnostics: [] });
    assert.equal(existsSync(s.agentDir), false);
    assert.equal(existsSync(join(s.project, ".pi")), false);
  } finally { s.done(); }
});
