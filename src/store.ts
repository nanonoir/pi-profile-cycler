/** Serializes and atomically writes the config; the previous file is kept as `<path>.bak`. */
import { closeSync, copyFileSync, existsSync, fsyncSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseConfig, type Config, type Profile } from "./config.ts";

export interface StoreFs {
  existsSync(path: string): boolean;
  copyFileSync(from: string, to: string): void;
  openSync(path: string, flags: "w"): number;
  writeSync(fd: number, buffer: Uint8Array, offset: number, length: number): number;
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
    try {
      // writeSync may write fewer bytes than requested; loop until the whole file is on disk.
      const bytes = Buffer.from(text, "utf8");
      for (let offset = 0; offset < bytes.length;) {
        const written = fs.writeSync(fd, bytes, offset, bytes.length - offset);
        if (!(written > 0)) throw new Error("Config write made no progress");
        offset += written;
      }
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(temp, path);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch { /* keep the original error */ }
    throw error;
  }
}
