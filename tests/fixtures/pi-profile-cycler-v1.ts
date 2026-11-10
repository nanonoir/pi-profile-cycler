/**
 * Minimal global profile cycler for Pi + mavam/pi-agents.
 *
 * - Alt+P cycles named presets; /hprofile selects one.
 * - Changes Pi's current model/thinking without restarting the session.
 * - Changes ONLY model/thinking in ~/.pi/agent/agents/*.md.
 * - pi-agents discovers profiles again at spawn time; running agents keep their original model.
 * - Never touches Pi's MCP, auth, compaction, pruning, AGENTS.md or instructions.
 *
 * Install globally at ~/.pi/agent/extensions/pi-profile-cycler.ts.
 * Edit ~/.pi/agent/profile-cycler.json to customize presets.
 */
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const AGENT_DIR = getAgentDir();
const CONFIG_PATH = join(AGENT_DIR, "profile-cycler.json");
const LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const SAFE_NAME = /^[a-z0-9][a-z0-9_-]*$/;

type Route = { model: string; thinking: string };
type Profile = { main: Route; agents: Record<string, Route> };
type Config = {
  active: string;
  order: string[];
  profiles: Record<string, Profile>;
};

type FilePatch = { path: string; original: string; updated: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function expectRoute(value: unknown, label: string): Route {
  if (!isObject(value) || typeof value.model !== "string" || typeof value.thinking !== "string") {
    throw new Error(`${label} must contain { model, thinking }`);
  }
  const [provider, ...modelParts] = value.model.split("/");
  if (!provider || !modelParts.join("/") || !LEVELS.has(value.thinking)) {
    throw new Error(`Invalid model or thinking in ${label}: ${value.model} / ${value.thinking}`);
  }
  return { model: value.model, thinking: value.thinking };
}
function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`Missing ${CONFIG_PATH}. Copy the supplied profile-cycler.json there.`);
  }
  const data: unknown = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  if (!isObject(data) || !isObject(data.profiles) || !Array.isArray(data.order)) {
    throw new Error("Invalid profile-cycler.json: expected order[] and profiles{}");
  }
  const profiles: Record<string, Profile> = {};
  for (const [name, entry] of Object.entries(data.profiles)) {
    if (!SAFE_NAME.test(name) || !isObject(entry) || !isObject(entry.agents)) {
      throw new Error(`Invalid profile: ${name}`);
    }
    const agents: Record<string, Route> = {};
    for (const [agentName, route] of Object.entries(entry.agents)) {
      if (!SAFE_NAME.test(agentName)) throw new Error(`Invalid agent name: ${agentName}`);
      agents[agentName] = expectRoute(route, `${name}.agents.${agentName}`);
    }
    profiles[name] = { main: expectRoute(entry.main, `${name}.main`), agents };
  }
  const order = data.order;
  if (order.length === 0 || order.some((n) => typeof n !== "string" || !profiles[n]) || new Set(order).size !== order.length) {
    throw new Error("Invalid order: list unique, existing profile names");
  }
  const active = typeof data.active === "string" ? data.active : order[0];
  if (!profiles[active]) throw new Error(`Unknown active profile: ${active}`);
  return { active, order: order as string[], profiles };
}
function storeActive(config: Config, name: string): void {
  // Preserve extra user-defined fields when changing only the active name.
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>;
  raw.active = name;
  const temp = `${CONFIG_PATH}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(raw, null, 2) + "\n", "utf8");
    renameSync(temp, CONFIG_PATH);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}
function patchFrontmatter(source: string, route: Route, name: string): string {
  // Only alter top-level YAML keys, preserving the complete Markdown prompt.
  const match = /^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---(?=\r?\n|$))/.exec(source);
  if (!match) throw new Error(`Missing YAML frontmatter in agent ${name}`);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = match[2].split(/\r?\n/);
  for (const key of ["model", "thinking"] as const) {
    const found = lines.findIndex((line) => line.startsWith(`${key}:`));
    if (found >= 0) lines[found] = `${key}: ${route[key]}`;
    else lines.push(`${key}: ${route[key]}`);
  }
  return `${match[1]}${lines.join(newline)}${match[3]}${source.slice(match[0].length)}`;
}
function patchesFor(profile: Profile): FilePatch[] {
  return Object.entries(profile.agents).map(([name, route]) => {
    const path = join(AGENT_DIR, "agents", `${name}.md`);
    if (!existsSync(path)) throw new Error(`Missing agent file: ${path}`);
    const original = readFileSync(path, "utf8");
    return { path, original, updated: patchFrontmatter(original, route, name) };
  });
}
function validateModels(profile: Profile, ctx: ExtensionContext): string[] {
  const available = new Set(ctx.modelRegistry.getAvailable().map((m) => `${m.provider}/${m.id}`));
  return [...new Set([profile.main.model, ...Object.values(profile.agents).map((v) => v.model)])]
    .filter((id) => !available.has(id));
}
function applyFiles(patches: FilePatch[]): void {
  const completed: FilePatch[] = [];
  try {
    for (const patch of patches) {
      if (patch.original === patch.updated) continue;
      // Keep file contents intact; pi-agents re-reads these on new spawns.
      writeFileSync(patch.path, patch.updated, "utf8");
      completed.push(patch);
    }
  } catch (error) {
    for (const patch of completed.reverse()) {
      try { writeFileSync(patch.path, patch.original, "utf8"); } catch { /* best effort rollback */ }
    }
    throw error;
  }
}
function restoreFiles(patches: FilePatch[]): void {
  for (const patch of patches) {
    if (patch.original !== patch.updated) writeFileSync(patch.path, patch.original, "utf8");
  }
}

export default function profileCycler(pi: ExtensionAPI): void {
  let applying = false;
  let selected: string | undefined;

  async function activate(name: string, ctx: ExtensionContext, persist = true): Promise<void> {
    if (applying) { ctx.ui.notify("Profile switch already in progress", "warning"); return; }
    applying = true;
    try {
      const config = loadConfig();
      const profile = config.profiles[name];
      if (!profile) throw new Error(`Unknown profile ${name}. Available: ${config.order.join(", ")}`);
      const missing = validateModels(profile, ctx);
      if (missing.length) throw new Error(`Unavailable models: ${missing.join(", ")}. Check pi --list-models and provider logins.`);
      const patches = patchesFor(profile); // preflight all files before changing anything
      const [provider, ...id] = profile.main.model.split("/");
      const model = ctx.modelRegistry.find(provider, id.join("/"));
      if (!model) throw new Error(`Model not registered: ${profile.main.model}`);
      const previousModel = ctx.model;
      const previousThinking = pi.getThinkingLevel();
      const ok = await pi.setModel(model);
      if (!ok) throw new Error(`Authentication unavailable for ${profile.main.model}`);
      try {
        applyFiles(patches);
        pi.setThinkingLevel(profile.main.thinking as Parameters<typeof pi.setThinkingLevel>[0]);
        if (persist && config.active !== name) storeActive(config, name);
      } catch (error) {
        try { restoreFiles(patches); } catch { /* best effort */ }
        if (previousModel) { try { await pi.setModel(previousModel); } catch { /* best effort */ } }
        try { pi.setThinkingLevel(previousThinking); } catch { /* best effort */ }
        throw error;
      }
      selected = name;
      ctx.ui.setStatus("hprofile", `profile: ${name}`);
      if (persist) ctx.ui.notify(`Profile: ${name} | ${profile.main.model} (${profile.main.thinking})`, "info");
    } catch (error) {
      ctx.ui.notify(`Profile switch failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      applying = false;
    }
  }

  async function next(ctx: ExtensionContext): Promise<void> {
    try {
      const config = loadConfig();
      const current = selected ?? config.active;
      const index = config.order.indexOf(current);
      await activate(config.order[(index + 1) % config.order.length], ctx);
    } catch (error) {
      ctx.ui.notify(String(error), "error");
    }
  }

  pi.registerShortcut("alt+p", {
    description: "Switch to next harness model profile",
    handler: next,
  });

  pi.registerCommand("hprofile", {
    description: "Switch harness profile: /hprofile, /hprofile next, /hprofile balanced",
    handler: async (args, ctx) => {
      try {
        const config = loadConfig();
        const choice = args.trim();
        if (choice === "next") return await next(ctx);
        if (choice === "status") {
          ctx.ui.notify(`Selected: ${selected ?? config.active}\nAvailable: ${config.order.join(", ")}`, "info");
          return;
        }
        if (choice) return await activate(choice, ctx);
        if (!ctx.hasUI) {
          ctx.ui.notify(`Profiles: ${config.order.join(", ")}`, "info");
          return;
        }
        const option = await ctx.ui.select("Harness profile", config.order);
        if (option) await activate(option, ctx);
      } catch (error) {
        ctx.ui.notify(`Profile error: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    try {
      const config = loadConfig();
      await activate(config.active, ctx, false);
    } catch (error) {
      ctx.ui.notify(`Profile initialization: ${String(error)}`, "warning");
    }
  });
}
