/** `/hprofile manage`: dialog flow over the pure editing core. Edits stay in a draft until Save; the file is the source of truth. */
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { NAME, THINKING_LEVELS, validateConfig, type Config, type Profile, type Route } from "./config.ts";
import type { Discovery } from "./discovery.ts";
import { createProfile, deleteProfile, setDefaultProfile, setRoute, type RouteTarget } from "./editing.ts";
import { modelId, type PickModelOptions } from "./model-picker.ts";
import { serializeConfig } from "./store.ts";
import { externalRouteMessage, isExternalRole } from "./routing.ts";
import { message, resolveRoute, type RegisteredModel } from "./switching.ts";

export interface ManageDeps {
  /** Reads and validates the configuration file; undefined when it does not exist yet. */
  load(): Config | undefined;
  /** Validates and atomically writes the configuration file. */
  write(config: Config): void;
  /** Existing reload path; throws when the parent is busy, the file is rejected or the selected profile cannot be re-activated. */
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

/** Routes of `name` that are new or modified relative to `base`, labelled like preflight errors. */
function changedRoutes(base: Config | undefined, next: Config, name: string): Array<[string, Route]> {
  const before = base?.profiles[name];
  const after = next.profiles[name];
  const routes: Array<[string, Route | undefined, Route | undefined]> = [
    ["default", before?.default, after.default],
    ["main", before?.main, after.main],
    ...Object.entries(after.agents).map(([role, route]) => [`agents.${role}`, before?.agents[role], route] as [string, Route | undefined, Route | undefined]),
  ];
  return routes.flatMap(([label, old, route]) => route && JSON.stringify(old) !== JSON.stringify(route) ? [[label, route] as [string, Route]] : []);
}

/** Persist `next`, then apply it through the reload path. Nothing is written when the file changed, validation or preflight fails. */
async function commit(ctx: ExtensionContext, deps: ManageDeps, base: Config | undefined, next: Config, edited?: string): Promise<Outcome> {
  try {
    if (edited) {
      const changed = changedRoutes(base, next, edited);
      const roles = changed.some(([label]) => label.startsWith("agents.")) ? deps.discover().roles : [];
      for (const [label, route] of changed) {
        const role = label.startsWith("agents.") ? label.slice("agents.".length) : undefined;
        if (role !== undefined && isExternalRole(role, roles)) throw new Error(`${label}: ${externalRouteMessage(role, role)}`);
        try { resolveRoute(route, ctx); } catch (error) { throw new Error(`${label}: ${message(error)}`); }
      }
    }
    const onDisk = deps.load();
    if ((onDisk && serializeConfig(onDisk)) !== (base && serializeConfig(base))) throw new Error("profile-cycler.json changed on disk; reopen /hprofile manage");
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

/** External CLI agents take a CLI alias, not a Pi model: no route can be set, only a stale one removed. */
async function dropExternalRoute(ctx: ExtensionContext, draft: Config, name: string, role: string): Promise<Config> {
  if (!draft.profiles[name].agents[role]) { ctx.ui.notify(`${role} runs an external CLI; its model is not a Pi model, so it cannot be routed`, "info"); return draft; }
  const action = await ctx.ui.select(`${role}: external CLI, not routed`, ["Remove"]);
  if (action !== "Remove") return draft;
  try { return setRoute(draft, name, { role }, undefined); }
  catch (error) { ctx.ui.notify(`Cannot edit: ${message(error)}`, "error"); return draft; }
}

/** Returns once the draft is saved (or saved but not applied), or abandoned. Without `base` the draft becomes the first configuration. */
async function editProfile(ctx: ExtensionContext, deps: ManageDeps, base: Config | undefined, name: string, start: Config): Promise<void> {
  const discovery = deps.discover();
  const valid = discovery.roles.filter(role => NAME.test(role.name));
  const unlisted = discovery.diagnostics.length + discovery.roles.length - valid.length;
  if (unlisted) ctx.ui.notify(`${unlisted} agent file(s) could not be read and are not listed`, "warning");
  const native = new Map(valid.map(role => [role.name, role]));
  let draft = start;
  const dirty = () => JSON.stringify(draft) !== JSON.stringify(base);
  for (;;) {
    const profile = draft.profiles[name];
    const entries = new Map<string, { target: RouteTarget; title: string; external: boolean }>();
    entries.set(`Default: ${profile.default ? fmt(profile.default) : "not set"}`, { target: "default", title: "Default", external: false });
    entries.set(`Orchestrator: ${profile.main ? fmt(profile.main) : "default"}`, { target: "main", title: "Orchestrator", external: false });
    const roles = [...new Set([...native.keys(), ...Object.keys(profile.agents)])];
    for (const role of roles) {
      const found = native.get(role);
      const route = profile.agents[role];
      const external = found?.external === true;
      const state = external ? `external CLI, not routed${route ? ` (blocking route: ${fmt(route)})` : ""}`
        : route ? fmt(route)
        : profile.default ? "default"
        : found?.model ? `native: ${found.model}` : "native";
      entries.set(`${role}: ${state}${found ? "" : " [not discovered]"}`, { target: { role }, title: role, external });
    }
    const options = [...entries.keys(), "Save", "Discard"];
    const answer = await ctx.ui.select(`Edit ${name}${dirty() ? " (unsaved changes)" : ""}`, options);
    if (answer === "Save") {
      if (!dirty()) return;
      const outcome = await commit(ctx, deps, base, draft, name);
      // The first profile has nothing selected yet: activate it so it is ready to use.
      if (outcome === "applied" && !base) await deps.activate(name);
      if (outcome !== "failed") return;
    } else if (answer === undefined || answer === "Discard") {
      if (!dirty() || await ctx.ui.confirm("Discard changes", `Discard unsaved changes to ${name}?`)) return;
    } else {
      const entry = entries.get(answer);
      if (entry?.external) draft = await dropExternalRoute(ctx, draft, name, entry.title);
      else if (entry) draft = await editRoute(ctx, deps, draft, name, entry.target, entry.title);
    }
  }
}

/** A brand-new configuration holding only `name`. */
const firstConfig = (name: string, route: Route): Config =>
  validateConfig({ version: 2, defaultProfile: name, order: [name], profiles: { [name]: { default: route, agents: {} } } });

async function createFlow(ctx: ExtensionContext, deps: ManageDeps, config: Config | undefined): Promise<void> {
  const create = (name: string, route: Route) => config ? createProfile(config, name, route) : firstConfig(name, route);
  const probe: Route = { model: "provider/model", thinking: "off" };
  let name: string | undefined;
  for (;;) {
    const input = await ctx.ui.input("New profile name", "lowercase letters, digits, - or _");
    if (input === undefined) return;
    try { create(input.trim(), probe); name = input.trim(); break; }
    catch (error) { ctx.ui.notify(`Invalid name: ${message(error)}`, "error"); }
  }
  const route = await chooseRoute(ctx, deps, "Default");
  if (!route) return;
  await editProfile(ctx, deps, config, name, create(name, route));
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
  const outcome = await commit(ctx, deps, config, next);
  if (outcome === "applied" && activateAfter) await deps.activate(activateAfter);
}

async function setDefaultFlow(ctx: ExtensionContext, deps: ManageDeps, config: Config, name: string): Promise<void> {
  if (!await ctx.ui.confirm("Set as default", `Make ${name} the default profile? This rewrites profile-cycler.json (a .bak is kept).`)) return;
  await commit(ctx, deps, config, setDefaultProfile(config, name));
}

export async function manage(ctx: ExtensionContext, deps: ManageDeps): Promise<void> {
  for (;;) {
    let config: Config | undefined;
    try { config = deps.load(); }
    catch (error) { ctx.ui.notify(`Cannot manage profiles: ${message(error)}`, "error"); return; }
    if (!config) {
      if (await ctx.ui.select("Manage profiles: no profiles yet", [NEW, DONE]) !== NEW) return;
      await createFlow(ctx, deps, undefined);
      continue;
    }
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
      else if (action === "Edit") await editProfile(ctx, deps, config, name, config);
      else if (action === "Delete") await deleteFlow(ctx, deps, config, name);
      else if (action === "Set as default") await setDefaultFlow(ctx, deps, config, name);
    } catch (error) { ctx.ui.notify(`Profile error: ${message(error)}`, "error"); }
  }
}
