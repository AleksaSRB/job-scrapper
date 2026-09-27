/**
 * Proba jednog izvora bez diranja baze (ne čita i ne piše data/db.json ni seen.json):
 *   npm run try -- <izvor> [--days 10] [--show 20] [--json out.json]
 * Pokrene `search()` iz src/sources/<izvor>.ts (svi oglasi kao neviđeni -> skidaju se detalji do maxDetails),
 * oceni svaki oglas po rules.json i ispiše: koliko je palo na kom tvrdom uslovu (srpski / remote / part-time / ostalo) i oglase koji prolaze.
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { hideReason, scoreJob } from "./score.ts";
import type { Job, SearchCtx } from "./types.ts";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: { days: { type: "string", default: "10" }, show: { type: "string", default: "25" }, json: { type: "string" } },
});
const name = positionals[0];
if (!name) { console.error("Upotreba: npm run try -- <izvor> [--days 10] [--show 25] [--json out.json]"); process.exit(1); }

const mod = await import(`./sources/${name}.ts`);
const ctx: SearchCtx = {
  since: new Date(Date.now() - Number(args.days) * 86_400_000),
  isSeen: () => false,
  log: (m) => console.log(`  ${m}`),
};
const t0 = Date.now();
const jobs: Job[] = await mod.search(ctx);

const since = ctx.since.getTime();
const GATES: Array<[string, RegExp]> = [["nije na srpskom", /nije na srpskom/], ["nije remote", /hibrid, nije|iz firme, nije|nigde ne pise da je rad od kuce|nigde ne piše da je rad od kuće/], ["nije part-time", /nije part-time/]];
const failed = new Map<string, number>();
const other = new Map<string, number>();
const pass: Array<{ job: Job; score: number; badges: string[] }> = [];
let old = 0, gatesOk = 0;
for (const j of jobs) {
  if (j.postedAt && new Date(j.postedAt).getTime() < since) { old++; continue; }
  const s = scoreJob(j);
  const x = s.reasons.filter((r) => r.startsWith("✕"));
  const g = GATES.filter(([, re]) => x.some((r) => re.test(r))).map(([k]) => k);
  for (const k of g) failed.set(k, (failed.get(k) ?? 0) + 1);
  if (g.length) continue;
  gatesOk++;
  const why = hideReason(s);
  if (why) { const k = why.replace(/[«(].*$/, "").trim(); other.set(k, (other.get(k) ?? 0) + 1); }
  else pass.push({ job: j, score: s.score, badges: s.badges });
}
console.log(`\n${name}: ${jobs.length} oglasa za ${Math.round((Date.now() - t0) / 1000)} s, ${old} starijih od ${args.days} dana`);
for (const [k, n] of failed) console.log(`  ✕ ${String(n).padStart(4)}  ${k}`);
console.log(`  = ${String(gatesOk).padStart(4)}  prolazi sva 3 tvrda uslova (srpski + remote + part-time), od toga PRIKAZANO ${pass.length}`);
for (const [k, n] of [...other].sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(4)} sklonjeno: ${k}`);
pass.sort((a, b) => b.score - a.score);
for (const p of pass.slice(0, Number(args.show))) console.log(`  ✓ ${String(p.score).padStart(4)}  ${p.job.title} — ${p.job.company || "?"} | ${p.job.location || "?"} | ${p.badges.join(", ")}\n          ${p.job.url}`);
if (args.json) writeFileSync(args.json, JSON.stringify({ total: jobs.length, old, failed: Object.fromEntries(failed), gatesOk, other: Object.fromEntries(other), pass: pass.map((p) => ({ ...p.job, score: p.score })) }, null, 2));
