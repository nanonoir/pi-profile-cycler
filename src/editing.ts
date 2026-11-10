/** Pure, immutable edits of a validated config; every result is re-validated and the input is never mutated. */
import { validateConfig, type Config, type Route } from "./config.ts";

export type RouteTarget = "default" | "main" | { role: string };

function draft(config: Config): Config { return structuredClone(config); }
function known(config: Config, name: string): void {
  if (!Object.hasOwn(config.profiles, name)) throw new Error(`unknown profile: ${name}`);
}

/** A new profile needs a route to be valid, so `defaultRoute` is required (it becomes the profile's `default`). */
export function createProfile(config: Config, name: string, defaultRoute?: Route): Config {
  if (Object.hasOwn(config.profiles, name)) throw new Error(`profile already exists: ${name}`);
  if (!defaultRoute) throw new Error(`profile ${name} needs a default route`);
  const next = draft(config);
  next.profiles[name] = { default: { ...defaultRoute }, agents: {} };
  next.order.push(name);
  return validateConfig(next);
}

export function deleteProfile(config: Config, name: string, replacement?: string): Config {
  known(config, name);
  if (config.order.length === 1) throw new Error("cannot delete the last profile");
  const next = draft(config);
  delete next.profiles[name];
  next.order = next.order.filter(key => key !== name);
  if (config.defaultProfile === name) {
    if (replacement === undefined) throw new Error(`deleting the default profile ${name} requires a replacement`);
    if (replacement === name || !Object.hasOwn(next.profiles, replacement)) throw new Error(`unknown replacement profile: ${replacement}`);
    next.defaultProfile = replacement;
  }
  return validateConfig(next);
}

export function setDefaultProfile(config: Config, name: string): Config {
  known(config, name);
  return validateConfig({ ...draft(config), defaultProfile: name });
}

/** Set a route, or remove it when `route` is undefined. Removal must keep `main` or `default` defined. */
export function setRoute(config: Config, profile: string, target: RouteTarget, route: Route | undefined): Config {
  known(config, profile);
  const next = draft(config);
  const entry = next.profiles[profile];
  if (typeof target === "object") {
    if (route) entry.agents[target.role] = { ...route }; else delete entry.agents[target.role];
  } else if (route) entry[target] = { ...route };
  else delete entry[target];
  return validateConfig(next);
}
