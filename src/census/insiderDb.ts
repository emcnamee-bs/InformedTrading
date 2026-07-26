import Database from "better-sqlite3";

export interface OpenBet {
  ticker: string; side: "yes" | "no"; cellKey: string;
  entryPriceCents: number; count: number; openedTs: number; closeMs: number;
  category: string; detector: string; sensitivity: string; direction: string;
  entryBand: string; timeBucket: string; scoreBucket: string; anomalyScore: number;
}

export interface CellRow {
  cellKey: string; category: string; detector: string; sensitivity: string; direction: string;
  entryBand: string; timeBucket: string; scoreBucket: string;
  n: number; wins: number; tradedCents: number; pnlCents: number;
}

const MIGRATION = `
CREATE TABLE IF NOT EXISTS insider_open (
  ticker TEXT NOT NULL, side TEXT NOT NULL, cell_key TEXT NOT NULL,
  entry_price_cents INTEGER NOT NULL, count REAL NOT NULL, opened_ts INTEGER NOT NULL, close_ms INTEGER NOT NULL,
  category TEXT, detector TEXT, sensitivity TEXT, direction TEXT,
  entry_band TEXT, time_bucket TEXT, score_bucket TEXT, anomaly_score REAL,
  PRIMARY KEY (ticker, side, cell_key)
);
CREATE TABLE IF NOT EXISTS insider_cell (
  cell_key TEXT PRIMARY KEY, category TEXT, detector TEXT, sensitivity TEXT, direction TEXT,
  entry_band TEXT, time_bucket TEXT, score_bucket TEXT,
  n INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
  traded_cents INTEGER NOT NULL DEFAULT 0, pnl_cents INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS insider_raw (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT, side TEXT, cell_key TEXT,
  entry_price_cents INTEGER, count REAL, won INTEGER, pnl_cents INTEGER,
  anomaly_score REAL, settled_at INTEGER, settle_source TEXT
);
`;

export class InsiderDb {
  private db: Database.Database;
  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 30000");
    this.db.exec(MIGRATION);
  }

  openBet(b: OpenBet): boolean {
    const info = this.db
      .prepare(
        `INSERT OR IGNORE INTO insider_open
         (ticker, side, cell_key, entry_price_cents, count, opened_ts, close_ms,
          category, detector, sensitivity, direction, entry_band, time_bucket, score_bucket, anomaly_score)
         VALUES (@ticker,@side,@cellKey,@entryPriceCents,@count,@openedTs,@closeMs,
          @category,@detector,@sensitivity,@direction,@entryBand,@timeBucket,@scoreBucket,@anomalyScore)`,
      )
      .run(b);
    return info.changes === 1;
  }

  listOpen(): OpenBet[] {
    return this.db.prepare(`SELECT * FROM insider_open`).all().map((r: any) => ({
      ticker: r.ticker, side: r.side, cellKey: r.cell_key, entryPriceCents: r.entry_price_cents,
      count: r.count, openedTs: r.opened_ts, closeMs: r.close_ms, category: r.category, detector: r.detector,
      sensitivity: r.sensitivity, direction: r.direction, entryBand: r.entry_band, timeBucket: r.time_bucket,
      scoreBucket: r.score_bucket, anomalyScore: r.anomaly_score,
    }));
  }

  settle(ticker: string, side: "yes" | "no", won: boolean, settledAt: number, settleSource: string): void {
    const tx = this.db.transaction(() => {
      const rows = this.db.prepare(`SELECT * FROM insider_open WHERE ticker=? AND side=?`).all(ticker, side) as any[];
      for (const r of rows) {
        const traded = Math.round(r.entry_price_cents * r.count);
        const pnl = (won ? Math.round(r.count * 100) : 0) - traded;
        this.db.prepare(
          `INSERT INTO insider_cell
             (cell_key, category, detector, sensitivity, direction, entry_band, time_bucket, score_bucket, n, wins, traded_cents, pnl_cents)
           VALUES (@cell_key,@category,@detector,@sensitivity,@direction,@entry_band,@time_bucket,@score_bucket,1,@w,@traded,@pnl)
           ON CONFLICT(cell_key) DO UPDATE SET
             n = n + 1, wins = wins + @w, traded_cents = traded_cents + @traded, pnl_cents = pnl_cents + @pnl`,
        ).run({
          cell_key: r.cell_key, category: r.category, detector: r.detector, sensitivity: r.sensitivity,
          direction: r.direction, entry_band: r.entry_band, time_bucket: r.time_bucket, score_bucket: r.score_bucket,
          w: won ? 1 : 0, traded, pnl,
        });
        this.db.prepare(
          `INSERT INTO insider_raw (ticker, side, cell_key, entry_price_cents, count, won, pnl_cents, anomaly_score, settled_at, settle_source)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        ).run(r.ticker, r.side, r.cell_key, r.entry_price_cents, r.count, won ? 1 : 0, pnl, r.anomaly_score, settledAt, settleSource);
      }
      this.db.prepare(`DELETE FROM insider_open WHERE ticker=? AND side=?`).run(ticker, side);
    });
    tx();
  }

  listCells(): CellRow[] {
    return this.db.prepare(`SELECT * FROM insider_cell`).all().map((r: any) => ({
      cellKey: r.cell_key, category: r.category, detector: r.detector, sensitivity: r.sensitivity,
      direction: r.direction, entryBand: r.entry_band, timeBucket: r.time_bucket, scoreBucket: r.score_bucket,
      n: r.n, wins: r.wins, tradedCents: r.traded_cents, pnlCents: r.pnl_cents,
    }));
  }

  close(): void { this.db.close(); }
}
