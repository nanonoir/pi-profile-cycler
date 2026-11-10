/** `/hprofile manage`: dialog flow over the pure editing core. Edits stay in a draft until Save; the file is the source of truth. */
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { THINKING_LEVELS, type Config, type Profile, type Route } from "./config.ts";
import type { Discovery } from "./discovery.ts";
import { createProfile, deleteProfile, setDefaultProfile, setRoute, type RouteTarget } from "./editing.ts";
import { modelId, type PickModelOptions } from "./model-picker.ts";
import { message, preflight, type RegisteredModel } from "./switching.ts";

export interface ManageDeps {
  /** Reads and validates the configuration file. */
  load(): Config;
  /** Validates and atomically writes the configuration file. */
  write(config: Config): void;
  /** Existing reload path; throws when the parent is busy or the file is rejected. */
  reload(): Promise<void>;
  activate(name: string): Promise<boolean>;
  selected(): string | undefined;
  pick(ctx: ExtensionContext, options: PickModelOptions): Promise<RegisteredModel | undefined>;
  discover(): Discovery;
}

const NEW = "+ New profile";
const DONE = "Done";
const fmt = (route: Route) => `${route.model} (${route.thinking})`;

type Outcome = "failed" | "saved" | "applied";

/** Persist `next`, then apply it through the reload path. Nothing is written when validation or preflight fails. */
async function commit(ctx: ExtensionContext, deps: ManageDeps, next: Config, check: string[]): Promise<Outcome> {
  try {
    for (const name of check) preflight(next.profiles[name], ctx);
    deps.write(next);
  } catch (error) { ctx.ui.notify(`Not saved: ${message(error)}`, "error"); return "failed"; }
  try { await deps.reload(); ctx.ui.notify("Configuration saved", "info"); return "applied"; }
  catch (error) {
    ctx.ui.notify(`Configuration saved but not applied (${message(error)}); run /hprofile reload when ready`, "warning");
    return "saved";
  }
}

/** Model then thinking, limited to what the registry and the model support. Undefined when cancelled. */
async function chooseRoute(ctx: ExtensionContext, deps: ManageDeps, title: string, current?: Route): Promise<Route | undefined> {
  const models = ctx.modelRegistry.getAvailable();
  if (!models.length) { ctx.ui.notify("No available models; check provider authentication", "warning"); return undefined; }
  const model = await deps.pick(ctx, { title: `${title}: model`, models, current: current?.model });
  if (!model) return undefined;
  const supported = getSupportedThinkingLevels(model);
  const levels = THINKING_LEVELS.filter(level => supported.includes(level));
  const first = current?.model === modelId(model) ? current.thinking : undefined;
  const ordered = first && levels.includes(first) ? [first, ...levels.filter(level => level !== first)] : levels;
  const thinking = await ctx.ui.select(`${title}: thinking`, ordered);
  const level = levels.find(item => item === thinking);
  return level ? { model: modelId(model), thinking: level } : undefined;
}

function current(profile: Profile, target: RouteTarget): Route | undefined {
  return typeof target === "object" ? profile.agents[target.role] : profile[target];
}

/** Edit one route of the draft. Returns the (possibly unchanged) draft. */
async function editRoute(ctx: ExtensionContext, deps: ManageDeps, draft: Config, name: string, target: RouteTarget, title: string): Promise<Config> {
  const profile = draft.profiles[name];
  const route = current(profile, target);
  const removable = !!route && (target !== "main" || !!profile.default) && (target !== "default" || !!profile.main);
  const change = route ? "Change model/thinking" : "Set model/thinking";
  const action = await ctx.ui.select(`${title}${route ? `: ${fmt(route)}` : ""}`, removable ? [change, "Remove"] : [change]);
  try {
    if (action === change) {
      const next = await chooseRoute(ctx, deps, title, route);
      return next ? setRoute(draft, name, target, next) : draft;
    }
    if (action === "Remove") return setRoute(draft, name, target, undefined);
  } catch (error) { ctx.ui.notify(`Cannot edit: ${message(error)}`, "error"); }
  return draft;
}

/** Returns once the draft is saved (or saved but not applied), or abandoned. */
async function editProfile(ctx: ExtensionContext, deps: ManageDeps, base: Config, name: string, start = base): Promise<void> {
  const discovery = deps.discover();
  if (discovery.diagnostics.length) ctx.ui.notify(`${discovery.diagnostics.length} agent file(s) could not be read and are not listed`, "warning");
  const native = new Map(discovery.roles.map(role => [role.name, role]));
  let draft = start;
  const dirty = () => JSON.stringify(draft) !== JSON.stringify(base);
  for (;;) {
    const profile = draft.profiles[name];
    const entries = new Map<string, { target: RouteTarget; title: string }>();
    entries.set(`Default: ${profile.default ? fmt(profile.default) : "not set"}`, { target: "default", title: "Default" });
    entries.set(`Orchestrator: ${profile.main ? fmt(profile.main) : "default"}`, { target: "main", title: "Orchestrator" });
    const roles = [...new Set([...native.keys(), ...Object.keys(profile.agents)])];
    for (const role of roles) {
      const found = native.get(role);
      const route = profile.agents[role];
      const state = route ? fmt(route)
        : profile.default ? "default"
        : found?.model ? `native: ${found.model}` : "native";
      entries.set(`${role}: ${state}${found ? "" : " [not discovered]"}`, { target: { role }, title: role });
    }
    const options = [...entries.keys(), "Save", "Discard"];
    const answer = await ctx.ui.select(`Edit ${name}${dirty() ? " (unsaved changes)" : ""}`, options);
    if (answer === "Save") {
      if (!dirty()) return;
      if (await commit(ctx, deps, draft, [name]) !== "failed") return;
    } else if (answer === undefined || answer === "Discard") {
      if (!dirty() || await ctx.ui.confirm("Discard changes", `Discard unsaved changes to ${name}?`)) return;
    } else {
      const entry = entries.get(answer);
      if (entry) draft = await editRoute(ctx, deps, draft, name, entry.target, entry.title);
    }
  }
}

async function createFlow(ctx: ExtensionContext, deps: ManageDeps, config: Config): Promise<void> {
  const probe: Route = { model: "provider/model", thinking: "off" };
  let name: string | undefined;
  for (;;) {
    const input = await ctx.ui.input("New profile name", "lowercase letters, digits, - or _");
    if (input === undefined) return;
    try { createProfile(config, input.trim(), probe); name = input.trim(); break; }
    catch (error) { ctx.ui.notify(`Invalid name: ${message(error)}`, "error"); }
  }
  const route = await chooseRoute(ctx, deps, "Default");
  if (!route) return;
  await editProfile(ctx, deps, config, name, createProfile(config, name, route));
}

async function deleteFlow(ctx: ExtensionContext, deps: ManageDeps, config: Config, name: string): Promise<void> {
  if (config.order.length === 1) { ctx.ui.notify("Cannot delete the last profile", "warning"); return; }
  if (!await ctx.ui.confirm("Delete profile", `Delete profile ${name}? This rewrites profile-cycler.json (a .bak is kept).`)) return;
  const others = config.order.filter(key => key !== name);
  let replacement: string | undefined;
  if (config.defaultProfile === name) {
    replacement = await ctx.ui.select(`${name} is the default profile; choose the new default`, others);
    if (!replacement || !others.includes(replacement)) return;
  }
  let activateAfter: string | undefined;
  if (deps.selected() === name) {
    const options = replacement ? [replacement, ...others.filter(key => key !== replacement)] : others;
    activateAfter = await ctx.ui.select(`${name} is active; choose the profile to activate`, options);
    if (!activateAfter || !others.includes(activateAfter)) return;
  }
  let next: Config;
  try { next = deleteProfile(config, name, replacement); }
  catch (error) { ctx.ui.notify(`Cannot delete: ${message(error)}`, "error"); return; }
  const outcome = await commit(ctx, deps, next, []);
  if (outcome === "applied" && activateAfter) await deps.activate(activateAfter);
}

export async function manage(ctx: ExtensionContext, deps: ManageDeps): Promise<void> {
  for (;;) {
    let config: Config;
    try { config = deps.load(); }
    catch (error) { ctx.ui.notify(`Cannot manage profiles: ${message(error)}`, "error"); return; }
    const active = deps.selected();
    const labels = new Map(config.order.map(key => {
      const tags = [key === config.defaultProfile ? "default" : "", key === active ? "active" : ""].filter(Boolean).join(", ");
      return [tags ? `${key} (${tags})` : key, key] as const;
    }));
    const answer = await ctx.ui.select("Manage profiles", [...labels.keys(), NEW, DONE]);
    if (answer === undefined || answer === DONE) return;
    if (answer === NEW) { await createFlow(ctx, deps, config); continue; }
    const name = labels.get(answer);
    if (!name) continue;
    const actions = ["Activate", "Edit", "Delete", ...(name === config.defaultProfile ? [] : ["Set as default"])];
    const action = await ctx.ui.select(`Profile ${name}`, actions);
    try {
      if (action === "Activate") await deps.activate(name);
      else if (action === "Edit") await editProfile(ctx, deps, config, name);
      else if (action === "Delete") await deleteFlow(ctx, deps, config, name);
      else if (action === "Set as default") await commit(ctx, deps, setDefaultProfile(config, name), []);
    } catch (error) { ctx.ui.notify(`Profile error: ${message(error)}`, "error"); }
  }
}
