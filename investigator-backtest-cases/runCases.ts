// Runs the case investigator over the 5 labeled-positive historical informed-betting cases,
// N fresh stateless runs each (default N=2; override with RUNS_PER_CASE). Each case is a curated
// pre-cutoff dossier + a flagged anomaly; expected verdict per case.json (all UNEXPLAINED).
// web_search is disabled, so no leak is possible. Reports per-case verdict distributions plus the
// overall detection rate (UNEXPLAINED / total).
//
//   RUNS_PER_CASE=2 node_modules/.bin/tsx investigator-backtest-cases/runCases.ts
//   CASES=case-4-santos RUNS_PER_CASE=1 ... (smoke-test a subset)
import { investigateCase, buildCasePrompt, loadCase } from "./resolvedInvestigator";
import { writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(DIR, "cases");
const N = Math.max(1, parseInt(process.env.RUNS_PER_CASE || "2", 10) || 2);
const ONLY = (process.env.CASES || "").split(",").map((s) => s.trim()).filter(Boolean);

const caseKeys = readdirSync(CASES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()
  .filter((k) => ONLY.length === 0 || ONLY.includes(k));

function renderRun(caseKey: string, i: number, verdict: string, res: any): string {
  const p = res.parsed || {};
  const src = Array.isArray(p.sources) ? p.sources : [];
  return [
    `# ${caseKey} — run ${i}`,
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

async function runCase(caseKey: string) {
  const caseDir = join(CASES_DIR, caseKey);
  const { spec } = loadCase(caseDir);
  const RUNS = join(caseDir, "runs");
  mkdirSync(RUNS, { recursive: true });
  const verdicts: string[] = [];
  for (let i = 1; i <= N; i++) {
    process.stdout.write(`[${caseKey}] run ${i}/${N} ... `);
    let res: any;
    try {
      res = await investigateCase(caseDir);
    } catch (e: any) {
      console.log(`SDK error: ${String(e?.message || e)}`);
      verdicts.push("ERROR");
      continue;
    }
    const v = res.parsed?.verdict ?? "AMBIGUOUS(parse-error)";
    verdicts.push(v);
    writeFileSync(join(RUNS, `run-${String(i).padStart(2, "0")}.md`), renderRun(caseKey, i, v, res));
    console.log(v);
  }
  const dist: Record<string, number> = {};
  for (const v of verdicts) dist[v] = (dist[v] || 0) + 1;
  return { spec, verdicts, dist };
}

async function main() {
  const results: Record<string, { spec: any; verdicts: string[]; dist: Record<string, number> }> = {};
  for (const k of caseKeys) results[k] = await runCase(k);

  const perCase: string[] = [];
  let posHit = 0, posTot = 0, negCorrect = 0, negFP = 0, negTot = 0;
  for (const k of caseKeys) {
    const r = results[k];
    const expected = r.spec.expected;
    const isNeg = expected === "EXPLAINED";
    const correct = r.dist[expected] || 0;
    const runs = r.verdicts.length;
    if (isNeg) { negCorrect += correct; negFP += r.dist["UNEXPLAINED"] || 0; negTot += runs; }
    else { posHit += r.dist["UNEXPLAINED"] || 0; posTot += runs; }
    perCase.push(
      [
        `## ${k} — "${r.spec.name}"`,
        `- Cutoff: ${r.spec.cutoff_iso} · Expected: ${expected} ${isNeg ? "(NEGATIVE control)" : "(labeled positive)"}`,
        `- Flagged anomaly: ${r.spec.anomaly}`,
        r.spec.notes ? `- Notes: ${r.spec.notes}` : ``,
        Object.entries(r.dist).map(([v, n]) => `- ${v}: ${n}`).join("\n"),
        `Order: ${r.verdicts.join(", ")}`,
        `**Correct (verdict == ${expected}): ${correct}/${runs}**`,
      ].filter(Boolean).join("\n"),
    );
  }

  const summary = [
    `# SUMMARY — Explain-away investigator vs. historical cases (positives + negative controls)`,
    ``,
    `**Design:** each case = a flagged anomaly + a curated facts-only pre-cutoff dossier (web_search`,
    `DISABLED, so nothing post-cutoff leaks). POSITIVES (expected UNEXPLAINED) are real confirmed/`,
    `alleged informed-betting cases; NEGATIVE CONTROLS (expected EXPLAINED) are constructed cases where`,
    `a genuine public catalyst accounts for the flagged pattern. ${N} fresh stateless run(s) per case.`,
    ``,
    perCase.join("\n\n"),
    ``,
    `## Overall`,
    `**Sensitivity — positives correctly flagged UNEXPLAINED: ${posHit}/${posTot}**`,
    `**Specificity — negative controls correctly EXPLAINED: ${negCorrect}/${negTot}**`,
    `**False positives on negative controls (UNEXPLAINED): ${negFP}/${negTot}** (remainder = AMBIGUOUS; see per-case)`,
    ``,
    `Read: high sensitivity WITH high specificity = genuine discrimination. High UNEXPLAINED on the`,
    `negatives would mean the rubric over-flags. Positives 2/3/5 were relationship/social-media`,
    `detected in reality (the dossier surfaces that relationship), so they measure relationship`,
    `judgement, not price detection.`,
    ``,
    `## Example prompt (${caseKeys[0] ?? "n/a"})`,
    "```",
    caseKeys.length ? buildCasePrompt(join(CASES_DIR, caseKeys[0])) : "(no cases)",
    "```",
  ].join("\n");
  writeFileSync(join(DIR, "SUMMARY.md"), summary);
  console.log(`\n=== DONE ===`);
  for (const k of caseKeys) console.log(`${k}: ${JSON.stringify(results[k].dist)} (expected ${results[k].spec.expected})`);
  console.log(`Sensitivity (pos UNEXPLAINED): ${posHit}/${posTot}`);
  console.log(`Specificity (neg EXPLAINED): ${negCorrect}/${negTot} | false-pos: ${negFP}/${negTot}`);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
