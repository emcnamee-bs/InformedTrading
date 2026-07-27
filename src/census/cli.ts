import { readFileSync, existsSync } from "node:fs";
import { SpineReader } from "./spine";
import { InsiderDb } from "./insiderDb";
import { runEntryCycle } from "./entry";
import { runSettleCycle } from "./settle";

const USAGE = "usage: npm run census -- [--spine <path>] [--insider <path>]";

export interface CensusCliArgs {
  spinePath: string;
  insiderPath: string;
}

export function parseArgs(argv: string[]): CensusCliArgs {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    spinePath: get("--spine") ?? "./.census/spine.db",
    insiderPath: get("--insider") ?? "./.census/insider.db",
  };
}

/**
 * Minimal `.env` loader (no `dotenv` dependency; matches src/live/cli.ts's loader). Defined
 * locally rather than imported from ../live/cli -- that module's top-level `main()` guard keys
 * off `process.argv[1].endsWith("cli.ts")`, which would also match THIS file's own entrypoint
 * name and fire live/cli's main() as a side effect of import. Never overrides a variable already
 * present in process.env.
 */
export function loadDotEnv(path = ".env"): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf-8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function renderTopCells(db: InsiderDb, limit = 10): void {
  const cells = db
    .listCells()
    .filter((c) => c.tradedCents > 0)
    .map((c) => ({ ...c, ret: c.pnlCents / c.tradedCents }))
    .sort((a, b) => b.ret - a.ret)
    .slice(0, limit);
  if (cells.length === 0) {
    console.log("No settled cells yet.");
    return;
  }
  console.log(`\nTop cells by return-on-traded (pnl_cents/traded_cents):`);
  for (const c of cells) {
    console.log(
      `  ${c.cellKey}  n=${c.n} wins=${c.wins} traded=${c.tradedCents}c pnl=${c.pnlCents}c ret=${(c.ret * 100).toFixed(1)}%`,
    );
  }
}

async function main() {
  // Load .env BEFORE loadConfig() so KALSHI_BASE_URL / REQUESTS_PER_SECOND / CACHE_DIR set
  // there are actually honored. Unconditional: loadDotEnv() never overrides a variable already
  // present in process.env, so this is safe either way.
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  const nowTs = Math.floor(Date.now() / 1000);

  const insiderDb = new InsiderDb(args.insiderPath);

  // spine.db is populated by the production poller (Fast99Follower/agent), not this CLI --
  // Phase 1's local `--hydrate` stand-in is retired now that the real poller schema is read directly.
  const reader = new SpineReader(args.spinePath);
  try {
    const entryFunnel = runEntryCycle(reader.listMarketData(), insiderDb, nowTs);
    console.log(
      `Entry funnel: universe=${entryFunnel.universe} pastEvent=${entryFunnel.pastEvent} sports=${entryFunnel.sports} ` +
        `scanned=${entryFunnel.scanned} fired=${entryFunnel.fired} entered=${entryFunnel.entered}`,
    );

    const settleFunnel = runSettleCycle(reader.listSettlements(), insiderDb);
    console.log(`Settlement: matched=${settleFunnel.matched} settled=${settleFunnel.settled}`);

    renderTopCells(insiderDb);
  } finally {
    reader.close();
    insiderDb.close();
  }
}

// Only run when executed directly (not when imported, e.g. by tests).
if (process.argv[1] && process.argv[1].endsWith("census/cli.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
