export interface LaunchRoute {
  model: string;
  thinking: string;
}

/** What routing needs from a discovered agent: names it answers to and whether it runs outside Pi's model registry. */
export interface AgentIdentity {
  name: string;
  localName?: string;
  aliases?: readonly string[];
  /** Runner is an external CLI/job adapter: its model is a CLI alias, never a Pi registry id. */
  external?: boolean;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** pi-subagents (model-resolution.js:34,:328) treats an empty or exactly `"inherit"` model as no request. */
const explicit = (value: unknown): value is string => typeof value === "string" && value.trim() !== "" && value.trim() !== "inherit";

/** pi-subagents' `subagent` tool: a launch (not a workflow script or a management `action`) names an agent or carries `tasks`/`chain`. */
export function isLaunch(input: unknown): input is Record<string, unknown> {
  return isRecord(input) && input.workflow === undefined && input.action === undefined
    && (typeof input.agent === "string" || Array.isArray(input.tasks) || Array.isArray(input.chain));
}

/** Mirrors pi-subagents `resolveAgentName` (agents.js:450-479): canonical name, then localName, then alias; ambiguity resolves to nothing. */
export function resolveAgent(raw: string, agents: readonly AgentIdentity[]): AgentIdentity | undefined {
  const name = raw.trim();
  for (const matches of [agents.filter(a => a.name === name), agents.filter(a => a.localName === name), agents.filter(a => a.aliases?.includes(name))]) {
    if (matches.length) return matches.length === 1 ? matches[0] : undefined;
  }
  return undefined;
}

/** Profile roles are keyed by simple names: the runtime name, local name or an alias of the resolved agent, else the requested name itself. */
function roleFor(agent: string, routes: Record<string, LaunchRoute>, agents: () => readonly AgentIdentity[]): { role?: string; external: boolean } {
  const found = resolveAgent(agent, agents());
  const keys = found ? [found.name, found.localName, ...(found.aliases ?? [])] : [agent.trim()];
  return { role: keys.find((key): key is string => key !== undefined && Object.hasOwn(routes, key)), external: found?.external === true };
}

export const externalRouteMessage = (role: string, agent: string) =>
  `profile routes ${role}, but ${agent} runs an external CLI whose model is not a Pi model; remove the route`;

/** True when `role` resolves to a discovered agent that runs an external CLI/job adapter. */
export const isExternalRole = (role: string, agents: readonly AgentIdentity[]): boolean => resolveAgent(role, agents)?.external === true;

/**
 * Explicit-wins: a real `model` (not empty or `inherit`; with or without a `:level` suffix) is never touched, so it gets no injected thinking.
 * Otherwise the agent's role route, else `fallback` (profile default), becomes `model` as `<provider>/<id>:<thinking>` —
 * pi-subagents has no per-launch thinking field. External-runner agents never receive the default; a role route for one is an error.
 */
function routeItem(item: unknown, routes: Record<string, LaunchRoute>, fallback: LaunchRoute | undefined, agents: () => readonly AgentIdentity[]): unknown {
  if (!isRecord(item) || typeof item.agent !== "string" || explicit(item.model)) return item;
  const { role, external } = roleFor(item.agent, routes, agents);
  if (role && external) throw new Error(externalRouteMessage(role, item.agent));
  const source = role ? routes[role] : external ? undefined : fallback;
  return source ? { ...item, model: `${source.model}:${source.thinking}` } : item;
}

const routeList = (items: unknown, route: (item: unknown) => unknown): unknown[] | undefined => {
  if (!Array.isArray(items)) return undefined;
  const routed = items.map(route);
  return routed.some((item, index) => item !== items[index]) ? routed : undefined;
};

/**
 * Pure, non-mutating router for the `subagent` input: returns only the top-level properties to change (`model`, `tasks`,
 * `chain`), empty when nothing applies. Workflows, actions and malformed shapes pass through for pi-subagents to handle.
 * `agents` may be a function: it is called at most once, and only when a launch item without an explicit model needs routing.
 */
export function routeSubagent(input: unknown, routes: Record<string, LaunchRoute>, fallback: LaunchRoute | undefined, agents: readonly AgentIdentity[] | (() => readonly AgentIdentity[])): Record<string, unknown> {
  if (!isLaunch(input)) return {};
  let known: readonly AgentIdentity[] | undefined;
  const lookup = () => known ??= typeof agents === "function" ? agents() : agents;
  const route = (item: unknown) => routeItem(item, routes, fallback, lookup);
  const patch: Record<string, unknown> = {};
  const direct = route(input);
  if (direct !== input) patch.model = (direct as Record<string, unknown>).model;
  const tasks = routeList(input.tasks, route);
  if (tasks) patch.tasks = tasks;
  const chain = routeList(input.chain, step => {
    if (!isRecord(step)) return step;
    const parallel = routeList(step.parallel, route);
    const routed = route(step);
    return parallel ? { ...(routed as Record<string, unknown>), parallel } : routed;
  });
  if (chain) patch.chain = chain;
  return patch;
}
