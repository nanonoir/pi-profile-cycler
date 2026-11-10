export interface SpawnRoute {
  model: string;
  thinking: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Profile is authoritative; a supplied unknown profile never falls back to name. */
export function roleFor(agent: Record<string, unknown>, routes: Record<string, SpawnRoute>): string | undefined {
  const role = typeof agent.profile === "string" ? agent.profile : agent.name;
  return typeof role === "string" && Object.hasOwn(routes, role) ? role : undefined;
}

const explicit = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/**
 * Pure, atomic patch (explicit-wins): role route, else `fallback` (profile default), fills model/thinking only where
 * the request omits them. An explicit model without explicit thinking gets no injected thinking: the route's level
 * was chosen for the route's model, so mavam's own resolution decides instead.
 */
export function routeSpawn(input: unknown, routes: Record<string, SpawnRoute>, fallback?: SpawnRoute): Record<string, unknown> {
  if (!isRecord(input) || !Array.isArray(input.agents)) {
    throw new Error("agent_spawn.agents must be an array (incompatible runtime input)");
  }
  const agents = input.agents.map((agent: unknown, index: number) => {
    if (!isRecord(agent)) throw new Error(`agent_spawn.agents[${index}] must be an object`);
    const role = roleFor(agent, routes);
    const source = role ? routes[role] : fallback;
    if (!source || explicit(agent.model)) return { ...agent };
    return { ...agent, model: source.model, thinking: explicit(agent.thinking) ? agent.thinking : source.thinking };
  });
  return { ...input, agents };
}
