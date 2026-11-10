import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

// Read-only mirror of pi-subagents 0.87.0 agent discovery (src/agents/agents.js, frontmatter.js, identity.js, agent-selection.js).
// Not mirrored: package-provided agents, `agentOverrides`/`agentExcludeDirs`/`projectRootResolution` settings, disabled agents.
export interface DiscoveredRole {
  /** Runtime name (`<package>.<name>` when the file declares `package`), the canonical name pi-subagents resolves. */
  name: string;
  localName?: string;
  aliases?: string[];
  source: "builtin" | "user" | "project";
  filePath: string;
  description: string;
  model?: string;
  thinking?: string;
  /** Runner is an external CLI/job adapter: its model is not a Pi model. */
  external?: boolean;
}
export interface DiscoveryDiagnostic { source: DiscoveredRole["source"]; filePath: string; message: string }
export interface Discovery { roles: DiscoveredRole[]; diagnostics: DiscoveryDiagnostic[] }
export interface DiscoverOptions {
  /** Home directory (`~/.agents`, `~` in scan dirs, and the stop for the project-root walk). */
  home?: string;
  /** Extra user dirs come from `PI_SUBAGENT_EXTRA_AGENT_DIRS`. */
  env?: NodeJS.ProcessEnv;
  /** Builtin agents directory; defaults to the installed pi-subagents package, omitted when not found. */
  builtinDir?: string;
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const isDirectory = (path: string) => { try { return statSync(path).isDirectory(); } catch { return false; } };

/** frontmatter.js:72 `parseFrontmatter`: flat `key: value`, quotes stripped, empty value opens an indented block kept as a string. */
function parseFrontmatter(content: string): Record<string, string> {
  const frontmatter: Record<string, string> = {};
  const text = content.replace(/\r\n/g, "\n");
  const end = text.indexOf("\n---", 3);
  if (!text.startsWith("---") || end === -1) return frontmatter;
  let key: string | undefined;
  let block: string[] = [];
  let keyIndent = 0;
  const flush = () => { if (key !== undefined) frontmatter[key] = block.map(line => line.trim()).filter(Boolean).join("\n"); key = undefined; block = []; };
  for (const line of text.slice(4, end).split("\n")) {
    const indent = line.search(/\S|$/);
    if (line.trim().startsWith("#")) continue;
    if (key !== undefined && (indent > keyIndent || line.trim() === "")) { block.push(line); continue; }
    flush();
    const match = line.match(/^([\w-]+):\s*(.*)$/);
    if (!match) continue;
    const raw = match[2].trim();
    const quoted = (raw[0] === '"' || raw[0] === "'") && raw.endsWith(raw[0]) && raw.length > 1;
    const value = quoted ? raw.slice(1, -1) : raw;
    if (value === "" || value === ">" || value === "|") { key = match[1]; keyIndent = indent; } else frontmatter[match[1]] = value;
  }
  flush();
  return frontmatter;
}

/** frontmatter.js:42 `parseFrontmatterList`. */
const parseList = (raw: string | undefined): string[] | undefined => raw?.split("\n").flatMap(line => {
  const value = line.trim();
  const item = value.match(/^-\s+(.+)$/)?.[1];
  return (item === undefined || /^["']/.test(item) ? item ?? value : item.replace(/(?:^|\s)#.*$/, "")).split(",");
}).map(value => value.trim()).filter(Boolean);

/** identity.js:8 `parsePackageName` + `buildRuntimeName`. */
function packageName(value: string | undefined): string | undefined {
  if (value === undefined || value === "" || value === "false") return undefined;
  const name = value.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9.-]/g, "").replace(/-+/g, "-").replace(/\.+/g, ".").replace(/(?:^[-.]+|[-.]+$)/g, "");
  if (!/^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/.test(name)) throw new Error("package is invalid after sanitization.");
  return name;
}

/** agents.js:1802-1850 `parseAgentRunnerFrontmatter`: only the runner type matters here (`pi` runs on Pi models). */
function external(runner: string | undefined, name: string): boolean {
  if (runner === undefined || !runner.trim()) return false;
  const type = runner.match(/\btype\s*["']?\s*:\s*["']?([\w-]+)/)?.[1];
  if (type !== "pi" && type !== "external-cli" && type !== "external-job") throw new Error(`Agent '${name}' has invalid runner.type; expected 'pi', 'external-cli', or 'external-job'.`);
  return type !== "pi";
}

/** agents.js:1933-1970 `loadAgentsFromDefinitionFiles`: a file without `name` and `description` is skipped silently. */
function parseRole(filePath: string, source: DiscoveredRole["source"]): DiscoveredRole | string | undefined {
  let frontmatter: Record<string, string>;
  try { frontmatter = parseFrontmatter(readFileSync(filePath, "utf-8")); } catch { return undefined; }
  const { name: localName, description } = frontmatter;
  if (!localName || !description) return undefined;
  try {
    const pkg = packageName(frontmatter.package);
    const name = pkg ? `${pkg}.${localName}` : localName;
    const isExternal = external(frontmatter.runner, localName);
    const aliases = [...new Set((parseList(frontmatter.aliases ?? frontmatter.alias) ?? []).map(alias => alias.trim()).filter(Boolean))].filter(alias => alias !== name);
    const thinking = frontmatter.thinking;
    return {
      name, localName, source, filePath, description,
      ...(aliases.length ? { aliases } : {}),
      ...(frontmatter.model !== undefined ? { model: frontmatter.model } : {}),
      ...(thinking !== undefined ? { thinking } : {}),
      ...(isExternal ? { external: true } : {}),
    };
  } catch (error) { return message(error); }
}

const PRUNED = new Set([".git", "node_modules", ".pi", "sync-backups"]);
/** agents.js:1612 `shouldPruneDiscoveryDir`: VCS/dependency dirs, git checkouts and nested project roots below the scan root. */
const pruned = (root: string, dir: string, name: string) =>
  PRUNED.has(name) || existsSync(join(dir, ".git")) || (resolve(dir) !== resolve(root) && (isDirectory(join(dir, ".pi")) || isDirectory(join(dir, ".agents"))));
/** agents.js:1791 `isLegacyAgentSkillPath`: `.agents/skills/**` holds skills, not agents. */
function legacySkill(root: string, file: string): boolean {
  const parts = relative(root, file).split(sep).map(part => part.toLowerCase());
  if (basename(root).toLowerCase() === ".agents") parts.unshift(".agents");
  return parts.some((part, index) => part === ".agents" && parts[index + 1] === "skills");
}

/** agents.js:1728 `inspectAgentDefinitionDirectory`: recursive `.md` scan (not `.chain.md`), symlinked dirs followed once, entries sorted by name. */
function scan(root: string, source: DiscoveredRole["source"], found: Discovery): DiscoveredRole[] {
  const roles: DiscoveredRole[] = [];
  const visited = new Set<string>();
  const visit = (dir: string): void => {
    let real: string;
    let entries;
    try { real = realpathSync(dir); entries = readdirSync(dir, { withFileTypes: true }); }
    catch (error) {
      if (!existsSync(dir)) return;
      found.diagnostics.push({ source, filePath: dir, message: `Could not read directory: ${message(error)}` });
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      const directory = entry.isDirectory() || (entry.isSymbolicLink() && isDirectory(path));
      if (directory) { if (!pruned(root, path, entry.name)) visit(path); continue; }
      if (!(entry.isFile() || entry.isSymbolicLink()) || !entry.name.endsWith(".md") || entry.name.endsWith(".chain.md") || legacySkill(root, path)) continue;
      const role = parseRole(path, source);
      if (typeof role === "string") found.diagnostics.push({ source, filePath: path, message: role });
      else if (role) roles.push(role);
    }
  };
  if (isDirectory(root)) visit(root);
  return roles;
}

/** agents.js:582 `findProjectRootCandidates` (nearest): a dir holding `.pi` or `.agents`; the walk stops at a home directory. */
function projectRoot(cwd: string, home: string): string | undefined {
  const homes = new Set([home].filter(isDirectory).map(dir => realpathSync.native(dir)));
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (isDirectory(dir) && homes.has(realpathSync.native(dir))) return undefined;
    if (isDirectory(join(dir, ".pi")) || isDirectory(join(dir, ".agents"))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

/** agents.js:2230 `readConfiguredAgentScanDirs` + `expandAgentScanDirPattern` (agents.js:2252): literal dirs and one `*` path segment. */
function scanDirs(settingsPath: string, home: string): string[] {
  let entries: unknown;
  try { entries = (JSON.parse(readFileSync(settingsPath, "utf-8")) as { subagents?: { agentScanDirs?: unknown } }).subagents?.agentScanDirs; } catch { return []; }
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "").flatMap(entry => {
    const expanded = entry.trim().replace(/^~(?=$|[\\/])/, home).replace(/[\\/]+/g, sep);
    const parts = expanded.split(sep);
    const star = parts.findIndex(part => part.includes("*"));
    if (star === -1) return existsSync(resolve(expanded)) ? [resolve(expanded)] : [];
    if (parts.filter(part => part.includes("*")).length !== 1 || parts[star] !== "*") return [];
    const base = resolve(parts.slice(0, star).join(sep) || sep);
    try {
      return readdirSync(base, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => join(base, entry.name, ...parts.slice(star + 1))).filter(existsSync);
    } catch { return []; }
  });
}

/** Installed pi-subagents `agents/` directory, best effort: Pi's npm root under the agent dir, then Node resolution. */
function builtinAgentsDir(agentDir: string): string | undefined {
  const installed = join(agentDir, "npm", "node_modules", "pi-subagents", "agents");
  if (isDirectory(installed)) return installed;
  try { const dir = join(dirname(createRequire(import.meta.url).resolve("pi-subagents/package.json")), "agents"); return isDirectory(dir) ? dir : undefined; }
  catch { return undefined; }
}

const RANK = { project: 0, user: 1, builtin: 2 } as const;

/**
 * agents.js:2718 `discoverAgentsUncached` + agent-selection.js `mergeAgentsForScope`: builtin < user < project, later dirs win by
 * name. User dirs in increasing precedence: `PI_SUBAGENT_EXTRA_AGENT_DIRS`, settings `agentScanDirs`, `<agentDir>/agents`, `~/.agents`;
 * project (trusted only, at the nearest project root): settings `agentScanDirs`, `.agents`, `.pi/agents`.
 */
export function discoverRoles(cwd: string, trusted: boolean, agentDir = getAgentDir(), options: DiscoverOptions = {}): Discovery {
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const found: Discovery = { roles: [], diagnostics: [] };
  const root = trusted ? projectRoot(cwd, home) : undefined;
  const userDirs = [
    ...(env.PI_SUBAGENT_EXTRA_AGENT_DIRS ?? "").split(delimiter).map(dir => dir.trim()).filter(Boolean),
    ...scanDirs(join(agentDir, "settings.json"), home),
    join(agentDir, "agents"), join(home, ".agents"),
  ].map(dir => resolve(dir));
  const projectDirs = root ? [...scanDirs(join(root, ".pi", "settings.json"), home), join(root, ".agents"), join(root, ".pi", "agents")].map(dir => resolve(dir)).filter(dir => !userDirs.includes(dir)) : [];
  const builtin = options.builtinDir ?? builtinAgentsDir(agentDir);
  const merged = new Map<string, DiscoveredRole>();
  for (const [source, dirs] of [["builtin", builtin ? [builtin] : []], ["user", userDirs], ["project", projectDirs]] as const) {
    for (const dir of dirs) for (const role of scan(dir, source, found)) merged.set(role.name, role);
  }
  found.roles = [...merged.values()].sort((a, b) => RANK[a.source] - RANK[b.source] || a.name.localeCompare(b.name));
  return found;
}
