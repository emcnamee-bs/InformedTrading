import { existsSync } from "node:fs";
import { SpineReader } from "./spine";
import { InsiderDb } from "./insiderDb";
import { runEntryCycle, EntryFunnel } from "./entry";
import { runSettleCycle } from "./settle";

export interface CensusReader {
  listMarketData: () => ReturnType<SpineReader["listMarketData"]>;
  listSettlements: () => ReturnType<SpineReader["listSettlements"]>;
  close: () => void;
}

/** One census iteration: enter on all firing markets, then settle matured ones. */
export function runOnce(reader: CensusReader, db: InsiderDb, nowTs: number): {
  entry: EntryFunnel; settle: { matched: number; settled: number };
} {
  const entry = runEntryCycle(reader.listMarketData(), db, nowTs);
  const settle = runSettleCycle(reader.listSettlements(), db);
  return { entry, settle };
}

async function main(): Promise<void> {
  const spinePath = process.env.AI1_DB || "/app/state/spine.db";
  const insiderPath = process.env.INSIDER_DB || "/app/state/insider.db";
  const haltPath = process.env.HALT_FILE || "/app/state/HALT-CENSUS";
  const raw = Number(process.env.CENSUS_INTERVAL_SECONDS);
  const intervalMs = (Number.isFinite(raw) && raw > 0 ? raw : 600) * 1000;
  const db = new InsiderDb(insiderPath);
  let stop = false;
  process.on("SIGTERM", () => { stop = true; });
  process.on("SIGINT", () => { stop = true; });
  while (!stop) {
    if (existsSync(haltPath)) { console.error("[census] HALT file present, pausing"); }
    else if (!existsSync(spinePath)) { console.error(`[census] spine not found at ${spinePath}, waiting`); }
    else {
      let reader: SpineReader | null = null;
      try {
        reader = new SpineReader(spinePath); // re-open each cycle to see fresh poller writes
        const nowTs = Math.floor(Date.now() / 1000);
        const r = runOnce(reader, db, nowTs);
        console.error(`[census] entry: analyzed=${r.entry.scanned} entered=${r.entry.entered} pastEvent=${r.entry.pastEvent} | settle: ${r.settle.settled}`);
      } catch (e) {
        console.error("[census] cycle error:", e instanceof Error ? e.message : String(e));
      } finally { if (reader) reader.close(); }
    }
    const t = Date.now();
    while (!stop && Date.now() - t < intervalMs) await new Promise((r) => setTimeout(r, 500));
  }
  db.close();
  console.error("[census] stopped");
}

if (process.argv[1] && process.argv[1].endsWith("runner.ts")) main().catch((e) => { console.error("[census] fatal:", e); process.exit(1); });
