/**
 * Scraper: jedan prolaz kroz izvore.
 *   node --experimental-strip-types src/scrape.ts           (jedan prolaz; Scheduled Task – svaki izvor se čita kad mu istekne `everyMin`)
 *   node --experimental-strip-types src/scrape.ts --force   (svi izvori odmah; dugme „Skeniraj sad“)
 *   node --experimental-strip-types src/scrape.ts --only infostud,linkedin
 *   node --experimental-strip-types src/scrape.ts --loop    (petlja svakih CONFIG.intervalMin)
 *
 * Baseline: prvi prolaz uzima oglase objavljene u poslednjih `lookbackDays` (config.json) i pamti taj datum u db.json (baselineAt);
 * posle toga se pokazuje samo ono što je novo od tada. Oglasi bez datuma prolaze (računa se kad smo ih prvi put videli).
 *
 * Novi oglas = nije viđen ranije + nije blokirana firma + ocena (rules.json) nije tvrdo odbila + skor ≥ minScore
 *              + nije duplikat (ista firma + sličan naslov) oglasa koji je već u bazi (duplikat postaje link „Isti oglas i na“).
 */
import { appendFileSync, existsSync, rmSync, statSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { CONFIG, LOCK_FILE, NEW_LOG, NTFY_TOPIC } from "./config.ts";
import { companyBlocked, DedupIndex } from "./dedup.ts";
import { sleep } from "./http.ts";
import { fmtSalary, salaryEurMonth } from "./salary.ts";
import { hideReason, scoreJob } from "./score.ts";
import * as halooglasi from "./sources/halooglasi.ts";
import * as himalayas from "./sources/himalayas.ts";
import * as infostud from "./sources/infostud.ts";
import * as jobrack from "./sources/jobrack.ts";
import * as jooble from "./sources/jooble.ts";
import * as linkedin from "./sources/linkedin.ts";
import * as poslovirs from "./sources/poslovirs.ts";
import * as startuj from "./sources/startuj.ts";
import * as wwr from "./sources/wwr.ts";
import { CorruptStoreError, loadDb, loadSeen, log, logFiltered, saveDb, saveSeen, toStored, ts } from "./store.ts";
import type { Job, SearchCtx, Source, StoredJob } from "./types.ts";

const { values: args } = parseArgs({
  options: { force: { type: "boolean", default: false }, loop: { type: "boolean", default: false }, only: { type: "string" } },
});

const SOURCES: Array<{ name: Source; search: (ctx: SearchCtx) => Promise<Job[]> }> = [
  { name: "infostud", search: infostud.search },
  { name: "startuj", search: startuj.search },
  { name: "poslovirs", search: poslovirs.search },
  { name: "halooglasi", search: halooglasi.search },
  { name: "jobrack", search: jobrack.search },
  { name: "wwr", search: wwr.search },
  { name: "himalayas", search: himalayas.search },
  { name: "linkedin", search: linkedin.search },
  { name: "jooble", search: jooble.search },
];

const ONLY = args.only ? new Set(args.only.split(",").map((s) => s.trim()).filter(Boolean)) : null;

/** Task se pali na svakih intervalMin, pa 2 min tolerancije da izvor sa istim periodom ne preskoči svaki drugi put. */
function isDue(lastFetched: string | undefined, everyMin: number): boolean {
  if (!lastFetched) return true;
  return Date.now() - new Date(lastFetched).getTime() >= (everyMin - 2) * 60_000;
}

/** Kartica bez plate dobija platu iz `from` (isti oglas ponovo pročitan ili duplikat sa drugog sajta). */
function adoptSalary(card: StoredJob, from: Job): boolean {
  const text = fmtSalary(from.salary);
  if (card.salaryText || !text) return false;
  card.salary = from.salary; card.salaryText = text; card.salaryEurMonth = salaryEurMonth(from.salary);
  return true;
}

export function fmt(j: StoredJob): string {
  return `[${j.source}] ${j.score} ${j.title} — ${j.company || "?"}${j.salaryText ? ` | ${j.salaryText}` : ""} | ${j.location || "remote"}`;
}

async function notify(fresh: StoredJob[]): Promise<void> {
  if (!NTFY_TOPIC) return;
  const shown = fresh.slice(0, 10);
  let body = shown.map((j) => `${fmt(j)}\n${j.url}`).join("\n\n");
  if (fresh.length > shown.length) body += `\n\n... i još ${fresh.length - shown.length}`;
  try {
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(NTFY_TOPIC)}`, {
      method: "POST", headers: { "Title": `Novi poslovi: ${fresh.length}`, "Tags": "briefcase", "Priority": "default" }, body, signal: AbortSignal.timeout(15_000),
    });
    log(`ntfy (${NTFY_TOPIC}): HTTP ${res.status}`);
  } catch (e) { log(`ntfy greška: ${(e as Error).message}`); }
}

function lockActive(): boolean {
  try { return existsSync(LOCK_FILE) && Date.now() - statSync(LOCK_FILE).mtimeMs < 15 * 60_000; } catch { return false; }
}

export async function runOnce(force: boolean): Promise<void> {
  if (lockActive()) { log("Preskačem: drugi scrape je u toku (data/scrape.lock)"); return; }
  writeFileSync(LOCK_FILE, String(process.pid));
  try {
    const seen = loadSeen();
    const start = loadDb();
    const firstRun = start.lastRun === null;
    if (!start.baselineAt) {
      start.baselineAt = new Date(Date.now() - CONFIG.lookbackDays * 86_400_000).toISOString();
      saveDb(start);
      log(`Prvi prolaz: baseline = poslednjih ${CONFIG.lookbackDays} dana (od ${start.baselineAt})`);
    }
    const since = new Date(start.baselineAt);
    const known = start.jobs;
    const index = new DedupIndex(Object.values(known));
    const fresh: StoredJob[] = [];
    const summary: string[] = [];

    for (const src of SOURCES) {
      const sc = CONFIG.sources[src.name];
      if (ONLY ? !ONLY.has(src.name) : !sc?.enabled) continue;
      if (!ONLY && !force && !isDue(start.sources[src.name]?.lastFetched, sc.everyMin)) continue;

      const batch: StoredJob[] = [];
      const touched = new Map<string, StoredJob>(); // kartice iz baze kojima je promenjen lastSeen / alsoOn / plata
      let line: string;
      const t0 = Date.now();
      try {
        const items = await src.search({ since, isSeen: (id) => seen.has(id) || id in known, log });
        let old = 0, filtered = 0, dupes = 0, blocked = 0;
        const now = new Date().toISOString();
        for (const j of items) {
          const inDb = known[j.id];
          if (inDb) {
            inDb.lastSeen = now; touched.set(inDb.id, inDb);
            if (inDb.status !== "rejected") {
              if (inDb.source !== j.source && inDb.url !== j.url && !(inDb.alsoOn ?? []).some((a) => a.source === j.source)) inDb.alsoOn = [...(inDb.alsoOn ?? []), { id: j.id, source: j.source, url: j.url }];
              if (adoptSalary(inDb, j)) log(`plata dopunjena: ${inDb.id} -> ${inDb.salaryText}`);
            }
            continue;
          }
          if (seen.has(j.id)) continue;
          seen.set(j.id, j.postedAt);
          if (j.postedAt !== null && new Date(j.postedAt) < since) { old++; continue; }
          if (companyBlocked(j.company, [CONFIG.blockedCompanies, start.blockedCompanies])) { blocked++; logFiltered(j, "firma sakrivena"); continue; }
          const scoring = scoreJob(j);
          const why = hideReason(scoring);
          if (why) { filtered++; logFiltered(j, why, scoring); continue; }
          const match = index.find(j);
          if (match) {
            dupes++;
            if (match.status !== "rejected") {
              if (match.source !== j.source && !(match.alsoOn ?? []).some((a) => a.id === j.id)) match.alsoOn = [...(match.alsoOn ?? []), { id: j.id, source: j.source, url: j.url }];
              if (adoptSalary(match, j)) log(`plata preuzeta sa duplikata: ${match.id} -> ${match.salaryText}`);
              touched.set(match.id, match);
            }
            log(`duplikat: ${j.id} ≈ ${match.id} (${match.status})`);
            continue;
          }
          const stored = toStored(j, scoring);
          batch.push(stored);
          known[stored.id] = stored;
          index.add(stored);
        }
        line = `${src.name}: ${items.length} oglasa, ${batch.length} novih${dupes ? `, ${dupes} duplikata` : ""}${filtered ? `, ${filtered} ispod kriterijuma` : ""}${old ? `, ${old} pre baseline-a` : ""}${blocked ? `, ${blocked} sakrivena firma` : ""} (${Math.round((Date.now() - t0) / 1000)}s)`;
      } catch (e) {
        line = `${src.name}: GREŠKA (${(e as Error).message.slice(0, 80)})`;
        log(`GREŠKA ${src.name}: ${(e as Error).message}`);
      }
      summary.push(line);
      log(line);

      // upis posle svakog izvora: ponovo učitaj bazu (server je možda menjao statuse) i dodaj samo promene
      const db = loadDb();
      db.baselineAt ??= start.baselineAt;
      for (const s of batch) if (!db.jobs[s.id]) db.jobs[s.id] = s;
      for (const m of touched.values()) {
        const j = db.jobs[m.id];
        if (!j) continue;
        j.lastSeen = m.lastSeen;
        if (m.alsoOn) j.alsoOn = m.alsoOn;
        if (!j.salaryText && m.salaryText) { j.salary = m.salary; j.salaryText = m.salaryText; j.salaryEurMonth = m.salaryEurMonth; }
      }
      db.sources[src.name] = { lastFetched: new Date().toISOString(), summary: line };
      db.lastRun = new Date().toISOString();
      db.lastRunSummary = SOURCES.map((s) => db.sources[s.name]?.summary).filter(Boolean).join(" | ");
      saveDb(db);
      saveSeen(seen);
      fresh.push(...batch);
    }

    if (summary.length === 0) { log("Nijednom izvoru još nije vreme."); return; }
    if (fresh.length > 0) {
      fresh.sort((a, b) => b.score - a.score);
      log(`NOVI OGLASI: ${fresh.length}`);
      const lines = fresh.map((j) => `${fmt(j)} | ${j.url}`);
      for (const l of lines) console.log("  " + l);
      try { appendFileSync(NEW_LOG, `\n[${ts()}] NOVI OGLASI: ${fresh.length}\n${lines.join("\n")}\n`); } catch { /* ignore */ }
      if (firstRun) log("Prvi prolaz (početno punjenje) – ntfy preskočen.");
      else await notify(fresh);
    } else log("Nema novih oglasa.");
  } finally {
    rmSync(LOCK_FILE, { force: true });
  }
}

async function main(): Promise<void> {
  log(`Start | prag ${CONFIG.minScore} | ${args.loop ? `petlja ${CONFIG.intervalMin} min` : ONLY ? `samo ${[...ONLY].join(", ")}` : args.force ? "svi izvori (--force)" : "jedan prolaz"}`);
  for (;;) {
    try { await runOnce(args.force === true); }
    catch (e) {
      if (e instanceof CorruptStoreError) { log(`STOP: ${e.message} — vrati data/db.json.bak ili obriši oštećen fajl pa pokreni ponovo.`); process.exitCode = 2; break; }
      log(`GREŠKA run: ${(e as Error).message}`);
    }
    if (!args.loop) break;
    await sleep(CONFIG.intervalMin * 60_000);
  }
}

main();
