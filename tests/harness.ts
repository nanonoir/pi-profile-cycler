import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerCycler } from "../src/index.ts";
import { parseConfig, type Config, type ThinkingLevel } from "../src/config.ts";
import type { Discovery } from "../src/discovery.ts";
import { serializeConfig } from "../src/store.ts";
import type { RegisteredModel } from "../src/switching.ts";

export interface FakeEvent { toolName?: string; input?: Record<string, unknown> }
type Handler = (event: FakeEvent, ctx: ExtensionContext) => Promise<unknown>;
/** `realStore`: no injected read/write, so the extension uses `$PI_CODING_AGENT_DIR/profile-cycler.json`. */
export function harness(opts: { realStore?: boolean } = {}) {
  let text = readFileSync(new URL("../examples/profile-cycler.json", import.meta.url), "utf8");
  const config = parseConfig(text);
  const ids = [...new Set(Object.values(config.profiles).flatMap(p => [p.main!.model, ...Object.values(p.agents).map(r => r.model)]))];
  const models = ids.map(id => ({ provider: id.slice(0, id.indexOf("/")), id: id.slice(id.indexOf("/") + 1), reasoning: true }) as RegisteredModel);
  let model = models[0];
  let thinking: ThinkingLevel = "medium";
  let idle = true;
  let branch: unknown[] = [];
  let failModel: string | undefined;
  let clamp = false;
  const handlers = new Map<string, Handler>();
  const notifications: string[] = [];
  const statuses: string[] = [];
  const calls: string[] = [];
  let command: ((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;
  let shortcut: ((ctx: ExtensionContext) => Promise<void>) | undefined;
  let answer: string | undefined;
  let gate: Promise<void> | undefined;
  let stale = false;
  let hasUI = true;
  let failWrite = false;
  let discovery: Discovery = { roles: [], diagnostics: [] };
  const script: unknown[] = [];
  const offered: Array<{ title: string; options: string[] }> = [];
  /** Next scripted answer; functions in the script are side effects (e.g. editing the file) run when reached. */
  const take = (): unknown => { let next = script.shift(); while (typeof next === "function") { (next as () => void)(); next = script.shift(); } return next; };
  const writes: string[] = [];
  const violations: string[] = [];
  /** Models the SDK invalidating a replaced runner: any later API/context use is recorded and throws. */
  const live = (what: string) => { if (stale) { violations.push(what); throw new Error(`stale extension API used: ${what}`); } };
  const ctx = {
    get model() { live("ctx.model"); return model; },
    isIdle: () => { live("ctx.isIdle"); return idle; },
    get hasUI() { return hasUI; },
    cwd: "/project",
    isProjectTrusted: () => true,
    sessionManager: { getBranch: () => { live("getBranch"); return branch; } },
    modelRegistry: { find: (provider: string, id: string) => models.find(m => m.provider === provider && m.id === id), getAvailable: () => models },
    ui: {
      notify: (text: string) => { live("notify"); notifications.push(text); },
      setStatus: (_key: string, text: string) => { live("setStatus"); statuses.push(text); },
      select: async (title: string, options: string[]) => {
        offered.push({ title, options: [...options] });
        if (!script.length) return answer;
        const next = take() as string | undefined;
        if (next === undefined) return undefined;
        const found = options.find(option => option === next) ?? options.find(option => option.startsWith(next));
        if (!found) throw new Error(`scripted select "${next}" not in [${options.join(" | ")}] (${title})`);
        return found;
      },
      input: async () => take() as string | undefined,
      confirm: async () => take() === true,
    },
  } as unknown as ExtensionContext;
  const api = {
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    registerCommand: (_name: string, options: { handler: typeof command }) => { command = options.handler; },
    registerShortcut: (_key: string, options: { handler: typeof shortcut }) => { shortcut = options.handler; },
    setModel: async (next: RegisteredModel) => {
      live("setModel");
      calls.push(`${next.provider}/${next.id}`);
      if (gate) { const wait = gate; gate = undefined; await wait; }
      live("setModel(resume)");
      if (next.id === failModel) return false;
      const previousModel = model;
      model = next;
      // Like Pi: model_select fires only on an actual change.
      if (previousModel !== next) await handlers.get("model_select")?.({ model: next, previousModel } as FakeEvent, ctx);
      return true;
    },
    getThinkingLevel: () => { live("getThinkingLevel"); return thinking; },
    setThinkingLevel: (next: ThinkingLevel) => { live("setThinkingLevel"); thinking = clamp && next === "low" ? "medium" : next; },
    appendEntry: (customType: string, data: unknown) => { live("appendEntry"); branch.push({ type: "custom", customType, data }); },
  } as unknown as ExtensionAPI;
  registerCycler(api, {
    ...(opts.realStore ? {} : {
      readConfig: () => text,
      writeConfig: (next: Config) => { if (failWrite) throw new Error("disk full"); text = serializeConfig(next); writes.push(text); },
    }),
    // Scripted answer is a `provider/id`; undefined cancels.
    pickModel: async (_ctx, options) => {
      const next = take() as string | undefined;
      if (next === undefined) return undefined;
      const found = options.models.find(m => `${m.provider}/${m.id}` === next);
      if (!found) throw new Error(`scripted model ${next} not offered (${options.title})`);
      return found;
    },
    discoverRoles: () => discovery,
  });
  return {
    api, ctx, config, violations, writes, offered, text: () => text,
    /** Queue answers consumed in order by select (label or label prefix), input, confirm (true/false) and the model picker (provider/id); `undefined` = Esc. */
    script: (...answers: unknown[]) => { script.push(...answers); },
    scriptLeft: () => script.length,
    setDiscovery: (value: Discovery) => { discovery = value; },
    setUI: (value: boolean) => { hasUI = value; },
    failWrite: (value: boolean) => { failWrite = value; },
    invalidate: () => { stale = true; }, models, notifications, statuses, calls,
    emit: async (name: string, event: FakeEvent = {}) => handlers.get(name)?.(event, ctx),
    command: async (args: string) => command!(args, ctx as ExtensionCommandContext),
    // Like Pi 1.5.0 interactive mode: the shortcut ctx's `model` is frozen at keypress time.
    shortcut: async () => shortcut!(Object.create(ctx, { model: { value: model } }) as ExtensionContext),
    setIdle: (value: boolean) => { idle = value; },
    setBranch: (value: unknown[]) => { branch = value; },
    branch: () => branch,
    setText: (value: string) => { text = value; },
    setAnswer: (value: string | undefined) => { answer = value; },
    failModel: (id: string | undefined) => { failModel = id; },
    setClamp: (value: boolean) => { clamp = value; },
    /** The next setModel call suspends until the returned release function is called (deterministic race). */
    deferSetModel: () => { let release!: () => void; gate = new Promise<void>(resolve => { release = resolve; }); return release; },
    model: () => model,
    thinking: () => thinking,
  };
}
