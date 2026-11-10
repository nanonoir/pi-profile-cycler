import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Profile, Route } from "./config.ts";

export type RegisteredModel = NonNullable<ReturnType<ExtensionContext["modelRegistry"]["find"]>>;

export function resolveRoute(route: Route, ctx: ExtensionContext): RegisteredModel {
  const slash = route.model.indexOf("/");
  const model = ctx.modelRegistry.find(route.model.slice(0, slash), route.model.slice(slash + 1));
  const available = ctx.modelRegistry.getAvailable().some(item => `${item.provider}/${item.id}` === route.model);
  if (!model || !available) throw new Error(`Unavailable model: ${route.model}. Check registered models and provider authentication.`);
  const levels = getSupportedThinkingLevels(model);
  if (!levels.includes(route.thinking)) {
    throw new Error(`Unsupported thinking ${route.thinking} for ${route.model}; supported: ${levels.join(", ")}`);
  }
  return model;
}

export function preflight(profile: Profile, ctx: ExtensionContext): RegisteredModel {
  const model = resolveRoute(profile.main, ctx);
  for (const [role, route] of Object.entries(profile.agents)) {
    try { resolveRoute(route, ctx); }
    catch (error) { throw new Error(`agents.${role}: ${message(error)}`); }
  }
  return model;
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Commit callback runs only after both effective parent settings are verified. */
export async function switchProfile(
  pi: Pick<ExtensionAPI, "setModel" | "setThinkingLevel" | "getThinkingLevel">,
  ctx: ExtensionContext,
  profile: Profile,
  commit: () => void,
  // Pi 1.5.0 gives shortcut handlers a ctx whose `model` is a snapshot; callers pass a live reading.
  currentModel: () => ExtensionContext["model"] = () => ctx.model,
): Promise<void> {
  const target = preflight(profile, ctx);
  const previousModel = currentModel();
  const previousThinking = pi.getThinkingLevel();
  if (!previousModel) throw new Error("No current parent model; cannot guarantee rollback. Select a model first.");
  let attempted = false;
  try {
    attempted = true;
    if (!await pi.setModel(target)) throw new Error(`Authentication unavailable for ${profile.main.model}`);
    pi.setThinkingLevel(profile.main.thinking);
    if (pi.getThinkingLevel() !== profile.main.thinking) throw new Error("Pi clamped the requested thinking level");
    const effective = currentModel();
    if (!effective || effective.provider !== target.provider || effective.id !== target.id) {
      const actual = effective ? `${effective.provider}/${effective.id}` : "none";
      throw new Error(`Pi did not retain the requested parent model (requested ${profile.main.model}, effective ${actual})`);
    }
    commit();
  } catch (error) {
    const failures: string[] = [];
    if (attempted) {
      try { if (!await pi.setModel(previousModel)) failures.push("previous model authentication unavailable"); }
      catch (rollback) { failures.push(message(rollback)); }
      try {
        pi.setThinkingLevel(previousThinking);
        if (pi.getThinkingLevel() !== previousThinking) failures.push("previous thinking was not restored");
      } catch (rollback) { failures.push(message(rollback)); }
      const effective = currentModel();
      if (effective?.provider !== previousModel.provider || effective?.id !== previousModel.id) failures.push("previous model was not restored");
    }
    throw new Error(`${message(error)}${failures.length ? `; ROLLBACK INCOMPLETE: ${failures.join("; ")}` : ""}`);
  }
}
