import { test } from "node:test";
import assert from "node:assert/strict";
import { ENTRY_TYPE, restoreSelection } from "../src/state.ts";

const entry = (profile: string) => ({ type: "custom", customType: ENTRY_TYPE, data: { version: 1, profile } });
test("restore uses last reachable selection only, branches and windows remain independent", () => {
  const common = [entry("balanced")];
  const left = [...common, entry("claude")];
  const right = [...common, entry("codex")];
  assert.equal(restoreSelection(left), "claude");
  assert.equal(restoreSelection(right), "codex");
  assert.equal(restoreSelection(common), "balanced");
  assert.equal(restoreSelection([]), undefined);
  assert.equal(restoreSelection([{ type: "custom", customType: "unrelated" }]), undefined);
});
test("corrupted latest selection is not silently replaced with an older choice", () => {
  assert.throws(() => restoreSelection([entry("balanced"), { type: "custom", customType: ENTRY_TYPE, data: { version: 5 } }]), /Invalid profile/);
});
