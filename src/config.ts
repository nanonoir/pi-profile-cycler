/** Pure schema validation and v1 migration; this module never reads or writes files. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export const REQUIRED_ROLES = ["specs-writer", "designer", "implementer", "fix-agent", "reviewer", "explorer", "archiver"] as const;
const LEGACY_ROLES = REQUIRED_ROLES.slice(0, 4);
export const NAME = /^[a-z0-9][a-z0-9_-]*$/;

export interface Route { model: string; thinking: ThinkingLevel }
export interface Profile { default?: Route; main?: Route; agents: Record<string, Route> }
export type ParentSource = "main" | "default";
/** Orchestrator route: `main`, else `default`; validated profiles always have one. */
export function parentRoute(profile: Profile): { route: Route; source: ParentSource } {
  if (profile.main) return { route: profile.main, source: "main" };
  if (profile.default) return { route: profile.default, source: "default" };
  throw new Error("profile defines neither main nor default");
}
export interface Config { version: 2; defaultProfile: string; order: string[]; profiles: Record<string, Profile> }

function fail(path: string, message: string): never { throw new Error(`${path}: ${message}`); }
function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail(path, "expected object");
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, keys: readonly string[], path: string, optional: readonly string[] = []): void {
  for (const key of Object.keys(value)) if (!keys.includes(key) && !optional.includes(key)) fail(`${path}.${key}`, "unexpected field");
  for (const key of keys) if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, "required field missing");
}
function name(value: unknown, path: string): string {
  if (typeof value !== "string" || !NAME.test(value)) return fail(path, "expected a lowercase name containing letters, digits, _ or -");
  return value;
}
function route(value: unknown, path: string): Route {
  const entry = object(value, path); fields(entry, ["model", "thinking"], path);
  if (typeof entry.model !== "string" || !/^[^/\s]+\/[^\s/]+(?:\/[^\s/]+)*$/.test(entry.model)) fail(`${path}.model`, "expected provider/model ID without whitespace");
  if (typeof entry.thinking !== "string" || !THINKING_LEVELS.some(level => level === entry.thinking)) fail(`${path}.thinking`, `expected one of ${THINKING_LEVELS.join(", ")}`);
  return { model: entry.model as string, thinking: entry.thinking as ThinkingLevel };
}
function profile(value: unknown, path: string): Profile {
  const entry = object(value, path);
  fields(entry, [], path, ["default", "main", "agents"]);
  if (!Object.hasOwn(entry, "main") && !Object.hasOwn(entry, "default")) fail(`${path}.main`, "profile must define main or default");
  const rawAgents = Object.hasOwn(entry, "agents") ? object(entry.agents, `${path}.agents`) : {};
  const agents: Record<string, Route> = Object.create(null);
  for (const [key, value] of Object.entries(rawAgents)) {
    name(key, `${path}.agents.${key}`);
    agents[key] = route(value, `${path}.agents.${key}`);
  }
  const result: Profile = { agents };
  if (Object.hasOwn(entry, "default")) result.default = route(entry.default, `${path}.default`);
  if (Object.hasOwn(entry, "main")) result.main = route(entry.main, `${path}.main`);
  return result;
}
function orderAndProfiles(rawOrder: unknown, rawProfiles: unknown, shape: (value: unknown, path: string) => Profile = profile): { order: string[]; profiles: Record<string, Profile> } {
  const source = object(rawProfiles, "$.profiles");
  const profiles: Record<string, Profile> = Object.create(null);
  for (const [key, value] of Object.entries(source)) {
    name(key, `$.profiles.${key}`);
    if (["next", "status", "reload", "manage"].includes(key)) fail(`$.profiles.${key}`, "reserved command name");
    profiles[key] = shape(value, `$.profiles.${key}`);
  }
  if (!Array.isArray(rawOrder) || rawOrder.length === 0) fail("$.order", "expected nonempty array");
  const seen = new Set<string>();
  const order = rawOrder.map((item: unknown, index: number) => {
    const path = `$.order[${index}]`; const key = name(item, path);
    if (seen.has(key)) fail(path, "duplicate profile");
    if (!Object.hasOwn(profiles, key)) fail(path, "unknown profile");
    seen.add(key); return key;
  });
  for (const key of Object.keys(profiles)) if (!seen.has(key)) fail(`$.profiles.${key}`, "profile missing from order");
  return { order, profiles };
}
/** v1 profiles: exactly `main` and `agents`, with the four legacy roles present. */
function legacyProfile(value: unknown, path: string): Profile {
  fields(object(value, path), ["main", "agents"], path);
  const result = profile(value, path);
  for (const role of LEGACY_ROLES) if (!Object.hasOwn(result.agents, role)) fail(`${path}.agents.${role}`, "required role missing");
  return result;
}
export function validateConfig(value: unknown): Config {
  const root = object(value, "$"); fields(root, ["version", "defaultProfile", "order", "profiles"], "$");
  if (root.version !== 2) fail("$.version", "expected 2");
  const { order, profiles } = orderAndProfiles(root.order, root.profiles);
  const defaultProfile = name(root.defaultProfile, "$.defaultProfile");
  if (!Object.hasOwn(profiles, defaultProfile)) fail("$.defaultProfile", "unknown profile");
  return { version: 2, defaultProfile, order, profiles };
}

/** JSON.parse cannot detect duplicate keys; scan the already-valid text recursively. */
export function parseJson(text: string): unknown {
  let result: unknown;
  try { result = JSON.parse(text) as unknown; } catch (error) { return fail("$", `invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  let i = 0;
  const space = () => { while (/\s/.test(text[i] ?? "") && i < text.length) i++; };
  const string = (): string => {
    const start = i++;
    while (i < text.length) { if (text[i] === "\\") { i += 2; continue; } if (text[i++] === '"') break; }
    return JSON.parse(text.slice(start, i)) as string;
  };
  const scan = (path: string): void => {
    space();
    if (text[i] === "{") {
      i++; space(); const seen = new Set<string>();
      while (text[i] !== "}") {
        const key = string(); const child = `${path}.${key}`;
        if (seen.has(key)) fail(child, "duplicate JSON key");
        seen.add(key); space(); i++; scan(child); space();
        if (text[i] === ",") { i++; space(); } else break;
      }
      i++;
    } else if (text[i] === "[") {
      i++; space(); let index = 0;
      while (text[i] !== "]") { scan(`${path}[${index++}]`); space(); if (text[i] === ",") { i++; } else break; }
      i++;
    } else if (text[i] === '"') { string(); }
    else { while (i < text.length && !/[\s,\]}]/.test(text[i])) i++; }
  };
  scan("$"); return result;
}
export function parseConfig(text: string): Config { return validateConfig(parseJson(text)); }

// v1 files used the nonexistent "openai-codex" provider; match on it, emit the real "openai" provider.
const SOL = "openai-codex/gpt-6.1-sol";
const TERRA = "openai-codex/gpt-6.1-terra";
const LEGACY_PROVIDER = "openai-codex/";
const fixRoute = (route: Route): Route =>
  route.model.startsWith(LEGACY_PROVIDER) ? { ...route, model: `openai/${route.model.slice(LEGACY_PROVIDER.length)}` } : route;
const OPUS = "claude-code/claude-opus-5-5";
const SONNET = "claude-code/claude-sonnet-5-5";
const FLASH = "antigravity/gemini-3-8-flash";
const signatures: Record<string, readonly string[]> = {
  balanced: [SOL, TERRA, SOL, SONNET, SONNET],
  claude: [OPUS, SONNET, OPUS, SONNET, SONNET],
  codex: [SOL, TERRA, SOL, TERRA, TERRA],
};

/** Classify by all core model IDs, not historical names. Refuse noncanonical/ambiguous input. */
export function migrateLegacy(value: unknown): Config {
  const root = object(value, "$"); fields(root, ["active", "order", "profiles"], "$");
  const { order, profiles } = orderAndProfiles(root.order, root.profiles, legacyProfile);
  const active = name(root.active, "$.active");
  if (!Object.hasOwn(profiles, active)) fail("$.active", "unknown profile");
  if (order.length !== 3) fail("$.profiles", "legacy migration requires exactly three recognizable profiles");
  const migrated: Record<string, Profile> = Object.create(null);
  const mapping: Record<string, string> = Object.create(null);
  for (const oldName of order) {
    const item = profiles[oldName];
    const models = [item.main!.model, ...LEGACY_ROLES.map(role => item.agents[role].model)];
    const match = Object.entries(signatures).filter(([, signature]) => signature.every((model, i) => model === models[i]));
    if (match.length !== 1) fail(`$.profiles.${oldName}`, "ambiguous or unrecognized legacy profile content");
    const target = match[0][0];
    if (Object.hasOwn(migrated, target)) fail(`$.profiles.${oldName}`, `duplicate ${target} profile content`);
    mapping[oldName] = target;
    const agents: Record<string, Route> = Object.create(null);
    for (const [role, route] of Object.entries(item.agents)) agents[role] = fixRoute(route);
    for (const role of REQUIRED_ROLES.slice(4)) if (!Object.hasOwn(agents, role)) agents[role] = { model: FLASH, thinking: "high" };
    migrated[target] = { main: fixRoute(item.main!), agents };
  }
  return validateConfig({ version: 2, defaultProfile: mapping[active], order: order.map(key => mapping[key]), profiles: migrated });
}
export function migrateLegacyJson(text: string): Config { return migrateLegacy(parseJson(text)); }
