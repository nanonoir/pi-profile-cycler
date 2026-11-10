/** Serializes and atomically writes the config; the previous file is kept as `<path>.bak`. */
import { copyFileSync, existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseConfig, type Config, type Profile } from "./config.ts";

export interface StoreFs {
  existsSync(path: string): boolean;
  copyFileSync(from: string, to: string): void;
  writeFileSync(path: string, data: string): void;
  renameSync(from: string, to: string): void;
  rmSync(path: string, options: { force: true }): void;
}
const nodeFs: StoreFs = { existsSync, copyFileSync, writeFileSync: (path, data) => writeFileSync(path, data, "utf8"), renameSync, rmSync };

export function serializeConfig(config: Config): string {
  const profiles: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config.profiles)) {
    const entry: Partial<Profile> = {};
    if (value.default) entry.default = value.default;
    if (value.main) entry.main = value.main;
    if (Object.keys(value.agents).length) entry.agents = value.agents;
    profiles[key] = entry;
  }
  return `${JSON.stringify({ version: config.version, defaultProfile: config.defaultProfile, order: config.order, profiles }, null, 2)}\n`;
}

export function writeConfig(path: string, config: Config, fs: StoreFs = nodeFs): void {
  const text = serializeConfig(config);
  parseConfig(text);
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  try {
    if (fs.existsSync(path)) fs.copyFileSync(path, `${path}.bak`);
    fs.writeFileSync(temp, text);
    fs.renameSync(temp, path);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch { /* keep the original error */ }
    throw error;
  }
}
