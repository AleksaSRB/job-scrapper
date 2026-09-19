/**
 * Dijagnostika ocene (ne skida ništa sa sajtova):
 *   npm run score -- --all                 tabela svih oglasa iz baze: skor | nivo | status | naslov (po trenutnom rules.json)
 *   npm run score -- <deo id-a ili naslova> pun razlog ocene za taj oglas
 *   npm run score -- --rescore             ponovo oceni sve oglase u bazi po trenutnom rules.json i upiši (statusi ostaju);
 *                                          oglasi koji sad padnu ispod praga dobijaju status "rejected" (favoriti/aplicirani ostaju)
 * Oglase koje je filter ranije ODBIO nema u bazi (samo u data/filtered.log) – da se ponovo procene, obriši data/seen.json.
 */
import { CONFIG } from "./config.ts";
import { hideReason, scoreJob } from "./score.ts";
import { loadDb, saveDb } from "./store.ts";

const args = process.argv.slice(2);
const db = loadDb();
const jobs = Object.values(db.jobs);

if (args.includes("--rescore")) {
  let hidden = 0, restored = 0, changed = 0;
  for (const j of jobs) {
    const s = scoreJob(j);
    if (s.score !== j.score) changed++;
    Object.assign(j, { score: s.score, level: s.level, reasons: s.reasons, categories: s.categories, badges: s.badges, partTime: s.partTime, serbian: s.serbian, remoteFinal: s.remoteFinal });
    const hide = hideReason(s);
    if (j.status === "new" && hide) { j.status = "rejected"; j.hiddenByRules = true; hidden++; }
    else if (j.status === "rejected" && j.hiddenByRules && !hide) { j.status = "new"; delete j.hiddenByRules; restored++; } // sakrila su ga pravila, ne korisnik
  }
  saveDb(db);
  console.log(`Ponovo ocenjeno ${jobs.length} oglasa, ${changed} promenjenih skorova, ${hidden} novih sklonjeno ispod praga ${CONFIG.minScore}, ${restored} vraćeno u nove.`);
} else if (args.includes("--all") || args.length === 0) {
  for (const j of jobs.sort((a, b) => b.score - a.score)) console.log(`${String(j.score).padStart(4)} ${j.level.padEnd(9)} ${j.status.padEnd(8)} ${j.source.padEnd(9)} ${j.title} — ${j.company} (${j.id})`);
  console.log(`\n${jobs.length} oglasa u bazi.`);
} else {
  const q = args.join(" ").toLowerCase();
  const hits = jobs.filter((j) => j.id.toLowerCase().includes(q) || j.title.toLowerCase().includes(q));
  if (!hits.length) { console.log("Nema takvog oglasa u bazi."); process.exit(1); }
  for (const j of hits) {
    const s = scoreJob(j);
    console.log(`\n${j.title} — ${j.company} [${j.source}] ${j.url}\n  status: ${j.status} | u bazi: ${j.score} | sada: ${s.score} (${s.level})${s.reject ? ` | ODBIJEN: ${s.reject}` : ""}`);
    for (const r of s.reasons) console.log(`  ${r}`);
    console.log(`  čipovi: ${s.badges.join(", ")}`);
  }
}
