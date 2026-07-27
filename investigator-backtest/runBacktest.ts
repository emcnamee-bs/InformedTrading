// Runs the resolved-market investigator over TWO units, 10 fresh stateless runs each:
//   POSITIVE (corpus_pos.md): facts-only real record -> expect UNEXPLAINED (correct detection)
//   NEGATIVE (corpus_neg.md): identical + a genuine public explanation -> expect EXPLAINED (specificity)
// web_search is disabled, so no leak is possible. Reports per-unit distributions + discrimination.
import { investigateOnce, buildResolvedPrompt, CUTOFF_ISO } from "./resolvedInvestigator";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));
const SNAP = join(DIR, "snapshot.json");
const N = 10;
const UNITS = [
  { key: "pos", label: "POSITIVE (facts-only real record)", corpus: join(DIR, "corpus_pos.md"), expect: "UNEXPLAINED" },
  { key: "neg", label: "NEGATIVE CONTROL (+ public app-ranking explanation)", corpus: join(DIR, "corpus_neg.md"), expect: "EXPLAINED" },
];

function renderRun(unitKey: string, i: number, verdict: string, res: any): string {
  const p = res.parsed || {};
  const src = Array.isArray(p.sources) ? p.sources : [];
  return [
    `# ${unitKey} — run ${i}`,
    ``,
    `- **Verdict:** ${verdict}`,
    ``,
    `## Rationale`,
    p.rationale || "(none parsed)",
    ``,
    `## Sources cited`,
    src.length ? src.map((s: any) => `- ${s}`).join("\n") : "(none)",
    ``,
    `## Full reasoning transcript`,
    "```",
    res.fullText || "(empty)",
    "```",
  ].join("\n");
}

async function runUnit(unit: typeof UNITS[number]) {
  const RUNS = join(DIR, "runs", unit.key);
  mkdirSync(RUNS, { recursive: true });
  const verdicts: string[] = [];
  for (let i = 1; i <= N; i++) {
    process.stdout.write(`[${unit.key}] run ${i}/${N} ... `);
    let res: any;
    try {
      res = await investigateOnce(SNAP, unit.corpus);
    } catch (e: any) {
      console.log(`SDK error: ${String(e?.message || e)}`);
      verdicts.push("ERROR");
      continue;
    }
    const v = res.parsed?.verdict ?? "AMBIGUOUS(parse-error)";
    verdicts.push(v);
    writeFileSync(join(RUNS, `run-${String(i).padStart(2, "0")}.md`), renderRun(unit.key, i, v, res));
    console.log(v);
  }
  const dist: Record<string, number> = {};
  for (const v of verdicts) dist[v] = (dist[v] || 0) + 1;
  return { verdicts, dist };
}

async function main() {
  const results: Record<string, { verdicts: string[]; dist: Record<string, number> }> = {};
  for (const u of UNITS) results[u.key] = await runUnit(u);

  const posCorrect = results.pos.dist["UNEXPLAINED"] || 0;
  const negCorrect = results.neg.dist["EXPLAINED"] || 0;

  const summary = [
    `# SUMMARY — Investigator effectiveness backtest (facts-only + negative control)`,
    ``,
    `**Test unit:** KXLIUSAELIMINATIONW-26JUL03 (Love Island USA Wk5). Same snapshot for both units;`,
    `only the dossier differs. web_search DISABLED; model training cutoff Jan-2026 (season aired later),`,
    `so the outcome is unknowable except via the dossier. Cutoff ${CUTOFF_ISO}. ${N} fresh runs per unit.`,
    ``,
    `## POSITIVE — facts-only real pre-cutoff record (expect UNEXPLAINED)`,
    Object.entries(results.pos.dist).map(([v, n]) => `- ${v}: ${n}`).join("\n"),
    `Order: ${results.pos.verdicts.join(", ")}`,
    `**Detection (UNEXPLAINED): ${posCorrect}/${N}**`,
    ``,
    `## NEGATIVE CONTROL — identical + genuine public explanation (expect EXPLAINED)`,
    Object.entries(results.neg.dist).map(([v, n]) => `- ${v}: ${n}`).join("\n"),
    `Order: ${results.neg.verdicts.join(", ")}`,
    `**Specificity (EXPLAINED): ${negCorrect}/${N}**`,
    ``,
    `## Discrimination`,
    `The investigator ${posCorrect >= 7 && negCorrect >= 7 ? "DISCRIMINATES" : "does NOT cleanly discriminate"}:`,
    `it flags insider on the real record (${posCorrect}/${N} UNEXPLAINED) yet correctly clears the`,
    `concentration when a public catalyst is present (${negCorrect}/${N} EXPLAINED). A high UNEXPLAINED`,
    `rate on BOTH would have meant it just always cries insider.`,
    ``,
    `## The POSITIVE prompt`,
    "```",
    buildResolvedPrompt(SNAP, join(DIR, "corpus_pos.md")),
    "```",
  ].join("\n");
  writeFileSync(join(DIR, "SUMMARY.md"), summary);
  console.log(`\n=== DONE ===`);
  console.log(`POSITIVE detection (UNEXPLAINED): ${posCorrect}/${N}`, results.pos.dist);
  console.log(`NEGATIVE specificity (EXPLAINED): ${negCorrect}/${N}`, results.neg.dist);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
