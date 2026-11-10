import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { THINKING_LEVELS, type ThinkingLevel } from "./config.ts";

// Read-only mirror of pi-agents' `discoverProfiles` (a dev dependency only); keep the validation rules in step with it.
export interface DiscoveredRole { name: string; source: "user" | "project"; filePath: string; description: string; model?: string; thinking?: ThinkingLevel; localName?: string; aliases?: string[]; external?: boolean }
export interface DiscoveryDiagnostic { source: "user" | "project"; filePath: string; message: string }
export interface Discovery { roles: DiscoveredRole[]; diagnostics: DiscoveryDiagnostic[] }

const ALLOWED_KEYS = ["name", "description", "model", "thinking", "skills", "tools", "spawn", "maxTurns"];
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const validList = (value: unknown) => value === undefined || typeof value === "string" || (Array.isArray(value) && value.every(item => typeof item === "string"));

function parseRole(filePath: string, source: DiscoveredRole["source"]): DiscoveredRole | string {
  let frontmatter: Record<string, unknown>;
  try { frontmatter = parseFrontmatter<Record<string, unknown>>(readFileSync(filePath, "utf-8")).frontmatter; }
  catch (error) { return `Could not read or parse file: ${message(error)}`; }
  const unknown = Object.keys(frontmatter).filter(key => !ALLOWED_KEYS.includes(key));
  if (unknown.length) return `Unsupported frontmatter keys: ${unknown.join(", ")}. Allowed keys: ${ALLOWED_KEYS.join(", ")}.`;
  const { name, description, model, thinking, spawn, maxTurns } = frontmatter;
  if (typeof name !== "string" || !name.trim()) return "Missing or invalid 'name' (must be a non-empty string)";
  if (typeof description !== "string" || !description.trim()) return "Missing or invalid 'description' (must be a non-empty string)";
  if (model !== undefined && typeof model !== "string") return "Invalid 'model' (must be a string)";
  if (thinking !== undefined && !THINKING_LEVELS.some(level => level === thinking)) return `Invalid 'thinking' (must be one of ${THINKING_LEVELS.join("|")})`;
  if (!validList(frontmatter.skills)) return "Invalid 'skills' (must be a YAML array of strings or a comma-separated string)";
  if (!validList(frontmatter.tools)) return "Invalid 'tools' (must be a YAML array of strings or a comma-separated string)";
  if (spawn !== undefined && typeof spawn !== "boolean") return "Invalid 'spawn' (must be true or false)";
  if (maxTurns !== undefined && (typeof maxTurns !== "number" || !Number.isSafeInteger(maxTurns) || maxTurns < 1)) return "Invalid 'maxTurns' (must be a positive integer)";
  return {
    name: name.trim(), source, filePath, description: description.trim(),
    ...(typeof model === "string" && model.trim() ? { model: model.trim() } : {}),
    ...(thinking !== undefined ? { thinking: thinking as ThinkingLevel } : {}),
  };
}

function loadDir(dir: string, source: DiscoveredRole["source"]): Discovery {
  const found: Discovery = { roles: [], diagnostics: [] };
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch (error) {
    // Like mavam, a missing directory is simply empty; other failures are reported.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") found.diagnostics.push({ source, filePath: dir, message: `Could not read directory: ${message(error)}` });
    return found;
  }
  for (const entry of entries) {
    if (!entry.name.endsWith(".md") || (!entry.isFile() && !entry.isSymbolicLink())) continue;
    const filePath = join(dir, entry.name);
    const result = parseRole(filePath, source);
    if (typeof result === "string") found.diagnostics.push({ source, filePath, message: result });
    else found.roles.push(result);
  }
  return found;
}

/** User agents plus, in a trusted project, project agents (which win by name). A project `.pi` equal to the agent dir holds user agents only. */
export function discoverRoles(cwd: string, trusted: boolean, agentDir = getAgentDir()): Discovery {
  const userDir = resolve(agentDir);
  const projectDir = resolve(cwd, ".pi");
  const user = loadDir(join(userDir, "agents"), "user");
  const project = trusted && projectDir !== userDir ? loadDir(join(projectDir, "agents"), "project") : { roles: [], diagnostics: [] };
  const merged = new Map<string, DiscoveredRole>();
  for (const role of [...user.roles, ...project.roles]) merged.set(role.name, role);
  const roles = [...merged.values()].sort((a, b) => Number(b.source === "project") - Number(a.source === "project") || a.name.localeCompare(b.name));
  return { roles, diagnostics: [...user.diagnostics, ...project.diagnostics] };
}
