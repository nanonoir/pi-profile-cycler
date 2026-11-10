import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, fuzzyFilter, Input, Spacer, Text, type KeybindingsManager } from "@earendil-works/pi-tui";
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

const MAX_VISIBLE = 10;

/** Models ordered by provider then id, current route first. */
export function orderModels(models: RegisteredModel[], current?: string): RegisteredModel[] {
  return [...models].sort((a, b) =>
    Number(modelId(b) === current) - Number(modelId(a) === current)
    || a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
}

/** Empty query keeps every model (current first); otherwise fuzzy-ranked over `id provider`. */
export function filterModels(models: RegisteredModel[], query: string, current?: string): RegisteredModel[] {
  const ordered = orderModels(models, current);
  return query.trim() ? fuzzyFilter(ordered, query.trim(), model => `${model.id} ${model.provider}`) : ordered;
}

/** Visible slice [start, end) keeping the selection roughly centered. */
export function visibleWindow(selected: number, total: number, size = MAX_VISIBLE): [number, number] {
  const start = Math.max(0, Math.min(selected - Math.floor(size / 2), total - size));
  return [start, Math.min(start + size, total)];
}

export function modelRow(model: RegisteredModel, selected: boolean, current?: string): string {
  return `${selected ? "→ " : "  "}${modelId(model) === current ? "✓ " : "  "}${modelLabel(model)}`;
}

type Theme = { fg(color: string, text: string): string };

class ModelPickerComponent extends Container {
  private readonly input = new Input();
  private readonly list = new Container();
  private filtered: RegisteredModel[];
  private selected = 0;
  private _focused = false;
  get focused(): boolean { return this._focused; }
  set focused(value: boolean) { this._focused = value; this.input.focused = value; }

  private readonly options: PickModelOptions;
  private readonly theme: Theme;
  private readonly keys: Pick<KeybindingsManager, "matches">;
  private readonly done: (model: RegisteredModel | undefined) => void;
  private readonly requestRender: () => void;

  constructor(options: PickModelOptions, theme: Theme, keys: Pick<KeybindingsManager, "matches">,
    done: (model: RegisteredModel | undefined) => void, requestRender: () => void) {
    super();
    this.options = options; this.theme = theme; this.keys = keys; this.done = done; this.requestRender = requestRender;
    this.filtered = filterModels(options.models, "", options.current);
    this.addChild(new Text(theme.fg("accent", options.title), 0, 0));
    this.addChild(new Spacer(1));
    this.addChild(this.input);
    this.addChild(new Spacer(1));
    this.addChild(this.list);
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.fg("dim", "  type to filter · ↑↓ move · enter select · esc cancel"), 0, 0));
    this.update();
  }

  private update(): void {
    this.list.clear();
    const [start, end] = visibleWindow(this.selected, this.filtered.length);
    for (let i = start; i < end; i++) {
      const row = modelRow(this.filtered[i]!, i === this.selected, this.options.current);
      this.list.addChild(new Text(i === this.selected ? this.theme.fg("accent", row) : row, 0, 0));
    }
    if (start > 0 || end < this.filtered.length)
      this.list.addChild(new Text(this.theme.fg("muted", `  (${this.selected + 1}/${this.filtered.length})`), 0, 0));
    if (!this.filtered.length) this.list.addChild(new Text(this.theme.fg("muted", "  No matching models"), 0, 0));
  }

  handleInput(data: string): void {
    const count = this.filtered.length;
    if (this.keys.matches(data, "tui.select.cancel")) return this.done(undefined);
    if (this.keys.matches(data, "tui.select.confirm")) { if (count) this.done(this.filtered[this.selected]); return; }
    if (this.keys.matches(data, "tui.select.up") || this.keys.matches(data, "tui.select.down")) {
      if (!count) return;
      const step = this.keys.matches(data, "tui.select.up") ? -1 : 1;
      this.selected = (this.selected + step + count) % count;
    } else {
      this.input.handleInput(data);
      this.filtered = filterModels(this.options.models, this.input.getValue(), this.options.current);
      this.selected = 0;
    }
    this.update();
    this.requestRender();
  }
}

/** Model picker used by /hprofile manage: fuzzy search via ctx.ui.custom, plain select as fallback. */
export async function pickModel(ctx: ExtensionContext, options: PickModelOptions): Promise<RegisteredModel | undefined> {
  if (!ctx.hasUI) return undefined;
  if (typeof ctx.ui.custom !== "function") return selectModel(ctx, options);
  try {
    return await ctx.ui.custom<RegisteredModel | undefined>((tui, theme, keys, done) =>
      new ModelPickerComponent(options, theme, keys, done, () => tui.requestRender()));
  } catch {
    return selectModel(ctx, options);
  }
}
