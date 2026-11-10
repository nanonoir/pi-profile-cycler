import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parentRoute, parseConfig, type Config } from "./config.ts";
import { discoverRoles, type Discovery } from "./discovery.ts";
import { manage } from "./manage.ts";
import { pickModel, type PickModelOptions } from "./model-picker.ts";
import { routeSpawn } from "./routing.ts";
import { ENTRY_TYPE, restoreSelection } from "./state.ts";
import { writeConfig } from "./store.ts";
import { message, preflight, switchProfile, type RegisteredModel } from "./switching.ts";

export const PROFILE_SHORTCUT = "alt+m";

export interface CyclerOptions {
  readConfig?: () => string;
  /** Persists the configuration for `/hprofile manage`; defaults to the file `readConfig` reads. */
  writeConfig?: (config: Config) => void;
  pickModel?: (ctx: ExtensionContext, options: PickModelOptions) => Promise<RegisteredModel | undefined>;
  discoverRoles?: (ctx: ExtensionContext) => Discovery;
}

interface ActivateOptions {
  /** Append the selection entry when it is not already the branch selection. */
  persist?: boolean;
  /** Caller is a safe request boundary (before_agent_start): skip the idle check. */
  boundary?: boolean;
  /** Reload reapplication: an existing pending intent survives. */
  keepPending?: boolean;
  /** Branch reconcile: route spawns to the profile as soon as preflight passes, even if the parent is busy. */
  routeNow?: boolean;
}

/**
 * Registration is inert: configuration is read only on lifecycle/explicit reload.
 *
 * Locking policy (public SDK events only): while a switch is in flight (`applying`),
 * before_agent_start and agent_settled await it, and session_before_switch/fork/tree cancel.
 * A session generation counter makes a late commit roll back if the session was replaced, and
 * session_shutdown awaits that rollback before returning (the SDK invalidates the old API only after
 * shutdown handlers complete); activations are rejected from shutdown until the next session_start.
 *
 * Tree navigation: navigateTree installs its branch-summary controller BEFORE emitting
 * session_before_tree, so isIdle() is already false there and activation queues instead of applying.
 * The navigation cancel below only covers switches that began earlier; no sticky lock is kept, so a
 * navigation cancelled by another extension leaves nothing behind. session_tree reuses the cached,
 * validated config; the file is read only at session_start and on explicit reload.
 */
export function registerCycler(pi: ExtensionAPI, options: CyclerOptions = {}): void {
  const configPath = () => join(getAgentDir(), "profile-cycler.json");
  const readConfig = options.readConfig ?? (() => readFileSync(configPath(), "utf8"));
  const save = options.writeConfig ?? ((next: Config) => writeConfig(configPath(), next));
  let config: Config | undefined;
  let selected: string | undefined;
  let applying = false;
  let inflight: Promise<unknown> | undefined;
  let generation = 0;
  let pending: string | undefined;
  let pendingPersist = true;
  /** The pending profile was already routed to (branch reconcile) while the parent model is not yet verified. */
  let pendingRouted = false;
  let shuttingDown = false;
  /** Live parent model during a switch: Pi 1.5.0 shortcut contexts expose `model` as a keypress-time snapshot. */
  let observedModel: ExtensionContext["model"];
  pi.on("model_select", async event => { observedModel = event.model; });

  function status(ctx: ExtensionContext): void {
    ctx.ui.setStatus("hprofile", `profile: ${selected ?? "unavailable"}${pending ? ` (pending: ${pending})` : ""}`);
  }

  /** `unroute`: the profile was routed early, so a failed reconciliation must not leave it active. */
  function cancelPending(ctx: ExtensionContext, reason: string, unroute = false): void {
    if (!pending) return;
    const name = pending;
    const blocked = unroute && pendingRouted;
    if (blocked) selected = undefined;
    pending = undefined;
    pendingPersist = true;
    pendingRouted = false;
    status(ctx);
    ctx.ui.notify(`Pending profile ${name} cancelled: ${reason}. Run /hprofile status to inspect the effective parent model.${blocked ? " Direct spawns blocked until you choose /hprofile <name>." : ""}`, "warning");
  }

  async function settleInflight(): Promise<void> {
    while (inflight) await inflight;
  }

  function activate(name: string, ctx: ExtensionContext, options: ActivateOptions = {}): Promise<boolean> {
    if (shuttingDown) { ctx.ui.notify("Profile switch rejected: session is shutting down", "warning"); return Promise.resolve(false); }
    if (applying) { ctx.ui.notify("Profile switch in progress; retry afterward", "warning"); return Promise.resolve(false); }
    applying = true;
    const run: Promise<boolean> = doActivate(name, ctx, options).finally(() => {
      applying = false;
      if (inflight === run) inflight = undefined;
    });
    inflight = run;
    return run;
  }

  /** Never rejects. The idle check and the first setModel call happen in the same synchronous turn. */
  async function doActivate(name: string, ctx: ExtensionContext, options: ActivateOptions): Promise<boolean> {
    const persist = options.persist ?? true;
    const started = generation;
    try {
      if (!config || !Object.hasOwn(config.profiles, name)) throw new Error(`Unknown profile: ${name}`);
      const profile = config.profiles[name];
      preflight(profile, ctx);
      if (!options.boundary && !ctx.isIdle()) {
        if (options.routeNow) selected = name;
        pending = name;
        pendingPersist = persist;
        // Replacing a queued intent must not forget that selected is still unverified.
        if (options.routeNow) pendingRouted = true;
        status(ctx);
        ctx.ui.notify(options.routeNow
          ? `Profile ${name} routes spawns now; the parent model switches when the parent settles or the next run starts`
          : `Profile ${name} pending until the parent settles; current routes remain unchanged`, "info");
        return false;
      }
      observedModel = ctx.model; // fresh at invocation; model_select keeps it current during the switch
      await switchProfile(pi, ctx, profile, () => {
        if (started !== generation) throw new Error("Session changed during the switch");
        if (persist && restoreSelection(ctx.sessionManager.getBranch()) !== name) {
          pi.appendEntry(ENTRY_TYPE, { version: 1, profile: name });
        }
        selected = name;
        pendingRouted = false;
        if (pending && pending !== name && !options.keepPending) cancelPending(ctx, `superseded by ${name}`);
        if (pending === name) { pending = undefined; pendingRouted = false; }
      }, () => observedModel);
      if (started !== generation) return false;
      status(ctx);
      if (persist) ctx.ui.notify(`Profile: ${name}`, "info");
      return true;
    } catch (error) {
      ctx.ui.notify(`Profile switch failed: ${message(error)}`, "error");
      return false;
    }
  }

  /** Apply the pending intent; an unsuccessful attempt is cancelled explicitly, never dropped silently. */
  async function applyPending(ctx: ExtensionContext, boundary: boolean): Promise<void> {
    await settleInflight();
    if (shuttingDown || !pending || !config || (!boundary && !ctx.isIdle())) return;
    const name = pending;
    if (await activate(name, ctx, { persist: pendingPersist, boundary })) return;
    if (pending === name) cancelPending(ctx, "it could not be applied", true);
  }

  /** `reread`: session_start only. session_tree reconciles against the cached validated config. */
  async function restore(ctx: ExtensionContext, reread: boolean): Promise<void> {
    const started = ++generation;
    shuttingDown = false;
    await settleInflight(); // an in-flight switch fails its commit (generation) and rolls back first
    if (started !== generation) return;
    selected = undefined;
    pending = undefined;
    pendingPersist = true;
    pendingRouted = false;
    if (reread) config = undefined;
    status(ctx);
    try {
      if (reread) config = parseConfig(readConfig());
      if (!config) throw new Error("No valid configuration; use /hprofile reload");
      const saved = restoreSelection(ctx.sessionManager.getBranch());
      const name = saved ?? config.defaultProfile;
      if (!Object.hasOwn(config.profiles, name)) throw new Error(`Saved profile ${name} no longer exists; choose /hprofile <name>`);
      // Pin a new branch's default once. Existing selections never generate duplicate entries.
      await activate(name, ctx, { persist: saved === undefined, routeNow: true });
    } catch (error) { ctx.ui.notify(`Profile initialization: ${message(error)}`, "error"); }
  }

  async function next(ctx: ExtensionContext): Promise<void> {
    if (!config) throw new Error("No valid configuration; use /hprofile reload");
    const current = pending ?? selected;
    const index = current ? config.order.indexOf(current) : -1;
    await activate(config.order[(index + 1) % config.order.length], ctx);
  }

  async function reload(ctx: ExtensionContext): Promise<void> {
    if (!ctx.isIdle() || applying) throw new Error("Reload not applied: parent busy; retry when idle");
    const candidate = parseConfig(readConfig());
    for (const profile of Object.values(candidate.profiles)) preflight(profile, ctx);
    const previous = config;
    config = candidate;
    if (selected && !Object.hasOwn(candidate.profiles, selected)) {
      selected = undefined;
      cancelPending(ctx, "selected profile removed by reload");
      status(ctx);
      ctx.ui.notify("Selected profile removed; choose /hprofile <name>. Direct spawns blocked until selection.", "warning");
    } else if (selected) {
      // Every successful selected-route activation must be pinned on this branch.
      // The commit checks branch history, so existing selections are not duplicated.
      if (!await activate(selected, ctx, { persist: true, keepPending: true })) { config = previous; return; }
      if (pending && !Object.hasOwn(candidate.profiles, pending)) cancelPending(ctx, "profile removed by reload");
    } else ctx.ui.notify("Configuration reloaded; choose /hprofile <name>", "info");
  }

  // Not alt+p: on Windows Pi reserves it for cycling to the previous model and skips extension shortcuts.
  pi.registerShortcut(PROFILE_SHORTCUT, {
    description: "Cycle model routing profile",
    handler: async ctx => { try { await next(ctx); } catch (error) { ctx.ui.notify(message(error), "error"); } },
  });
  pi.registerCommand("hprofile", {
    description: "Select profile, next, status, reload, or manage (create/edit/delete profiles)",
    handler: async (args, ctx) => {
      try {
        const choice = args.trim();
        if (choice === "reload") return await reload(ctx);
        if (choice === "manage") {
          if (!ctx.hasUI) { ctx.ui.notify("/hprofile manage needs the interactive TUI", "warning"); return; }
          return await manage(ctx, {
            load: () => parseConfig(readConfig()),
            write: save,
            reload: () => reload(ctx),
            activate: name => activate(name, ctx),
            selected: () => selected,
            pick: options.pickModel ?? pickModel,
            discover: () => options.discoverRoles?.(ctx) ?? discoverRoles(ctx.cwd, ctx.isProjectTrusted(), getAgentDir()),
          });
        }
        if (choice === "status") {
          const actual = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none";
          const profile = selected && config ? config.profiles[selected] : undefined;
          const fmt = (route: { model: string; thinking: string }) => `${route.model} (${route.thinking})`;
          const parent = profile ? parentRoute(profile) : undefined;
          const roles = profile ? Object.entries(profile.agents).map(([role, route]) => `  ${role}: ${fmt(route)}`).join("\n") : "";
          const routes = profile ? `${profile.default ? `  default: ${fmt(profile.default)}\n` : ""}${roles || "  (no roles configured)"}` : "  unavailable (direct spawns blocked)";
          const fallback = profile?.default ? "the default" : "native routing";
          ctx.ui.notify(`Selected: ${selected ?? "unavailable"}${pending ? `; pending: ${pending}` : ""}\nEffective parent: ${actual} (${pi.getThinkingLevel()})\nConfigured parent: ${parent ? `${fmt(parent.route)} [from ${parent.source}]` : "unavailable"}\nNext direct spawns (explicit model/thinking in the request wins; otherwise):\n${routes}\nExisting agents keep their routes. Unconfigured and unknown roles use ${fallback}. Nested helpers unsupported.`, "info");
          return;
        }
        if (choice === "next") return await next(ctx);
        if (choice) { await activate(choice, ctx); return; }
        if (!config) throw new Error("No valid configuration; use /hprofile reload");
        if (!ctx.hasUI) { ctx.ui.notify(`Profiles: ${config.order.join(", ")}; choose /hprofile <name>`, "info"); return; }
        const answer = await ctx.ui.select("Model routing profile", config.order);
        if (answer) await activate(answer, ctx);
      } catch (error) { ctx.ui.notify(`Profile error: ${message(error)}`, "error"); }
    },
  });
  pi.on("session_start", async (_event, ctx) => { await restore(ctx, true); });
  pi.on("session_tree", async (_event, ctx) => { await restore(ctx, false); });
  pi.on("session_shutdown", async () => {
    shuttingDown = true;
    generation++;
    pending = undefined;
    pendingRouted = false;
    await settleInflight(); // rollback must finish while the SDK still treats this API as valid
  });

  // Navigation cannot be serialized against a switch by the SDK, so it is cancelled with an explanation.
  const cancelWhileApplying = async (_event: unknown, ctx: ExtensionContext) => {
    if (!applying) return;
    ctx.ui.notify("Navigation cancelled: a profile switch is in progress; retry when it completes", "warning");
    return { cancel: true };
  };
  pi.on("session_before_switch", cancelWhileApplying);
  pi.on("session_before_fork", cancelWhileApplying);
  pi.on("session_before_tree", cancelWhileApplying);

  // Safe request boundary: gate on an in-flight switch, then apply a pending intent before the first request.
  pi.on("before_agent_start", async (_event, ctx) => { await applyPending(ctx, true); });
  pi.on("agent_settled", async (_event, ctx) => { await applyPending(ctx, false); });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "agent_spawn") return;
    try {
      if (applying) throw new Error("Profile switch in progress; retry spawn after it completes");
      if (!config || !selected) throw new Error("No activated routing profile; choose /hprofile <name>");
      const profile = config.profiles[selected];
      preflight(profile, ctx);
      const routed = routeSpawn(event.input, profile.agents, profile.default);
      // Pi executes the original input object: mutate its property, not event.input itself.
      event.input.agents = routed.agents;
    } catch (error) { return { block: true, reason: `Profile routing blocked: ${message(error)}` }; }
  });
}

export default function profileCycler(pi: ExtensionAPI): void { registerCycler(pi); }
