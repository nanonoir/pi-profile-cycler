import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { filterModels, modelRow, pickModel, visibleWindow } from "../src/model-picker.ts";
import type { RegisteredModel } from "../src/switching.ts";

const make = (provider: string, id: string) => ({ provider, id }) as RegisteredModel;
const models = [make("anthropic", "claude-opus-4"), make("anthropic", "claude-sonnet-4"), make("openrouter", "claude-opus-4"), make("openai", "gpt-5")];
const options = { title: "Pick", models, current: "openai/gpt-5" };
const theme = { fg: (_color: string, text: string) => text };
const keys = new KeybindingsManager(TUI_KEYBINDINGS);
const labels = (list: RegisteredModel[]) => list.map(m => `${m.provider}/${m.id}`);

/** ctx whose custom() builds the component with fakes and feeds it keys; `selectAnswer` serves the fallback. */
function fakeCtx(input: string[] | undefined, extra: Record<string, unknown> = {}) {
  let renders = 0;
  const ctx = {
    hasUI: true,
    ui: {
      select: async () => "gpt-5 · openai",
      custom: input && (async (factory: Function) => new Promise(resolve => {
        const component = factory({ requestRender: () => renders++ }, theme, keys, resolve);
        const frame = () => component.render(80).join("\n");
        assert.ok(frame().includes("claude-opus-4"));
        for (const key of input) component.handleInput(key);
      })),
      ...extra,
    },
  } as unknown as ExtensionContext;
  return { ctx, renders: () => renders };
}

test("empty query keeps all models with the current route first", () => {
  assert.deepEqual(labels(filterModels(models, "", "openai/gpt-5")), ["openai/gpt-5", "anthropic/claude-opus-4", "anthropic/claude-sonnet-4", "openrouter/claude-opus-4"]);
});

test("query filters fuzzily across id and provider", () => {
  assert.deepEqual(labels(filterModels(models, "opu")), ["anthropic/claude-opus-4", "openrouter/claude-opus-4"]);
  assert.deepEqual(labels(filterModels(models, "openrouter")), ["openrouter/claude-opus-4"]);
  assert.deepEqual(filterModels(models, "zzzz"), []);
});

test("rows mark selection and current route; window scrolls around selection", () => {
  assert.equal(modelRow(models[3]!, true, "openai/gpt-5"), "→ ✓ gpt-5 · openai");
  assert.equal(modelRow(models[0]!, false, "openai/gpt-5"), "    claude-opus-4 · anthropic");
  assert.deepEqual(visibleWindow(0, 25), [0, 10]);
  assert.deepEqual(visibleWindow(12, 25), [7, 17]);
  assert.deepEqual(visibleWindow(24, 25), [15, 25]);
  assert.deepEqual(visibleWindow(0, 3), [0, 3]);
});

test("typing, arrows and enter return the chosen model", async () => {
  const { ctx, renders } = fakeCtx([..."opu", "\x1b[B", "\r"]);
  assert.deepEqual(await pickModel(ctx, options), models[2]);
  assert.ok(renders() > 0);
});

test("enter without typing returns the first row (current route)", async () => {
  assert.deepEqual(await pickModel(fakeCtx(["\r"]).ctx, options), models[3]);
});

test("escape cancels and enter on no match is ignored", async () => {
  assert.equal(await pickModel(fakeCtx([..."zzzz", "\r", "\x1b"]).ctx, options), undefined);
});

test("empty result renders a hint", async () => {
  let frame = "";
  const ctx = { hasUI: true, ui: { custom: async (factory: Function) => {
    const component = factory({ requestRender() {} }, theme, keys, () => {});
    for (const key of "zzzz") component.handleInput(key);
    frame = component.render(80).join("\n");
    return undefined;
  } } } as unknown as ExtensionContext;
  await pickModel(ctx, options);
  assert.match(frame, /No matching models/);
});

test("falls back to plain select when custom is missing or throws", async () => {
  assert.deepEqual(await pickModel(fakeCtx(undefined).ctx, options), models[3]);
  const throwing = fakeCtx(["\r"], { custom: async () => { throw new Error("no tui"); } });
  assert.deepEqual(await pickModel(throwing.ctx, options), models[3]);
});

test("without UI nothing is picked", async () => {
  assert.equal(await pickModel({ hasUI: false, ui: {} } as unknown as ExtensionContext, options), undefined);
});
