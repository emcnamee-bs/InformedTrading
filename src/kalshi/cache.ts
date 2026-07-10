import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function pathFor(dir: string, key: string): string {
  return join(dir, `${key.replace(/[^a-zA-Z0-9_.-]/g, "_")}.jsonl`);
}

export function readCache<T>(dir: string, key: string): T[] | null {
  const p = pathFor(dir, key);
  if (!existsSync(p)) return null;
  const text = readFileSync(p, "utf8").trim();
  if (text === "") return [];
  return text.split("\n").map((line) => JSON.parse(line) as T);
}

export function writeCache<T>(dir: string, key: string, rows: T[]): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(pathFor(dir, key), rows.map((r) => JSON.stringify(r)).join("\n"));
}
