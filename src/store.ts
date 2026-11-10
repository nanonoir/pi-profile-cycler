/** Serializes and atomically writes the config; the previous file is kept as `<path>.bak`. */
import { closeSync, copyFileSync, existsSync, fsyncSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseConfig, type Config, type Profile } from "./config.ts";

export interface StoreFs {
  existsSync(path: string): boolean;
  copyFileSync(from: string, to: string): void;
  openSync(path: string, flags: "w"): number;
  writeSync(fd: number, data: string): unknown;
  fsyncSync(fd: number): void;
  closeSync(fd: number): void;
  renameSync(from: string, to: string): void;
  rmSync(path: string, options: { force: true }): void;
}
const nodeFs: StoreFs = { existsSync, copyFileSync, openSync, writeSync, fsyncSync, closeSync, renameSync, rmSync };

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
    const fd = fs.openSync(temp, "w");
    try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, path);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch { /* keep the original error */ }
    throw error;
  }
}
