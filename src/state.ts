import { isRecord } from "./routing.ts";

// Persisted in session files: keep the original id so existing sessions still restore their profile.
export const ENTRY_TYPE = "pi-agents-profile-cycler";
export interface Selection {
  version: 1;
  profile: string;
}

/** Only the active branch is accepted, never the session's entire entry list. */
export function restoreSelection(branch: readonly unknown[]): string | undefined {
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index];
    if (!isRecord(entry) || entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
    if (!isRecord(entry.data) || entry.data.version !== 1 || typeof entry.data.profile !== "string") {
      throw new Error("Invalid profile selection in active session branch");
    }
    return entry.data.profile;
  }
  return undefined;
}
