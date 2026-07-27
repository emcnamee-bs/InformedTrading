import { InsiderDb } from "./insiderDb";
import { retOnTraded, winRate, winRateVsImplied, marginal, Dimension, isRipe, persistence } from "./surface";

function arg(flag: string, def: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : def;
}
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function main(): void {
  const dbPath = arg("--insider", "./.census/insider.db");
  const nowTs = Math.floor(Date.now() / 1000);
  const db = new InsiderDb(dbPath);
  const cells = db.listCells();
  const raw = db.listRaw();

  console.log(`Insider census surface — ${cells.length} cells, ${raw.length} settled raw rows (db=${dbPath})\n`);

  console.log("=== Top cells by ret-on-traded (n>=1) ===");
  const ranked = cells
    .filter((c) => c.tradedCents > 0)
    .map((c) => ({ c, ret: retOnTraded(c), wr: winRate(c), vs: winRateVsImplied(c) }))
    .sort((a, b) => b.ret - a.ret)
    .slice(0, 25);
  for (const { c, ret, wr, vs } of ranked) {
    const ripe = isRipe({ retOnTraded: ret, n: c.n }) ? " RIPE" : "";
    const p = persistence(raw.filter((r) => r.cellKey === c.cellKey), nowTs);
    console.log(`  ${c.cellKey}  n=${c.n} ret=${pct(ret)} wr=${pct(wr)}${vs === null ? "" : ` vsImplied=${pct(vs)}`} persist=${p.persistent}${ripe}`);
  }

  const dims: Dimension[] = ["category", "detector", "sensitivity", "direction", "entryBand", "timeBucket", "scoreBucket"];
  for (const dim of dims) {
    console.log(`\n=== Marginal by ${dim} (ranked by ret-on-traded) ===`);
    for (const m of marginal(cells, dim)) {
      const ripe = isRipe({ retOnTraded: m.retOnTraded, n: m.n }) ? " RIPE" : "";
      console.log(`  ${dim}=${m.value}  n=${m.n} ret=${pct(m.retOnTraded)} wr=${pct(m.winRate)}${ripe}`);
    }
  }
  db.close();
}

if (process.argv[1] && process.argv[1].endsWith("surfaceCli.ts")) main();
