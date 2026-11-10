import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RegisteredModel } from "./switching.ts";

export interface PickModelOptions {
  title: string;
  models: RegisteredModel[];
  /** `provider/id` of the current route, shown first. */
  current?: string;
}

export const modelId = (model: RegisteredModel): string => `${model.provider}/${model.id}`;
export const modelLabel = (model: RegisteredModel): string => `${model.id} · ${model.provider}`;

/** Plain-select fallback: models ordered by provider, current first. Returns undefined on cancel. */
export async function selectModel(ctx: ExtensionContext, options: PickModelOptions): Promise<RegisteredModel | undefined> {
  const models = [...options.models].sort((a, b) =>
    Number(modelId(b) === options.current) - Number(modelId(a) === options.current)
    || a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
  const answer = await ctx.ui.select(options.title, models.map(modelLabel));
  return models.find(model => modelLabel(model) === answer);
}

/** Model picker used by /hprofile manage. Phase 4a replaces this with a fuzzy-search component. */
export async function pickModel(ctx: ExtensionContext, options: PickModelOptions): Promise<RegisteredModel | undefined> {
  return selectModel(ctx, options);
}
