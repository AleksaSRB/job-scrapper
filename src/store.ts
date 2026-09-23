import { appendFileSync, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { DATA_DIR, DB_FILE, FILTERED_LOG, RUN_LOG, SEEN_FILE } from "./config.ts";
import { fmtSalary, salaryEurMonth } from "./salary.ts";
import { firstSentences } from "./text.ts";
import type { Db, Job, Scoring, StoredJob } from "./types.ts";

mkdirSync(DATA_DIR, { recursive: true });

export function ts(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Log preko 5 MB se skloni u `<log>.1` (prethodni .1 se briše) – laptop ne sme da se puni godinama. */
const LOG_MAX = 5 * 1024 * 1024;
function rotate(file: string): void {
  try {
    if (existsSync(file) && statSync(file).size > LOG_MAX) { rmSync(`${file}.1`, { force: true }); renameSync(file, `${file}.1`); }
  } catch { /* ignore */ }
}
rotate(RUN_LOG);
rotate(FILTERED_LOG);

export function log(msg: string): void {
  const line = `[${ts()}] ${msg}`;
  console.log(line);
  try { appendFileSync(RUN_LOG, line + "\n"); } catch { /* ignore */ }
}

/** Oglasi koje je ocena odbila – sa razlogom i celim skorom (prvo mesto za tunovanje rules.json). */
export function logFiltered(job: Job, reason: string, scoring?: Scoring): void {
  const detail = scoring ? ` | ${scoring.reasons.join("; ")}` : "";
  try { appendFileSync(FILTERED_LOG, `[${ts()}] ${job.source} | ${job.title} | ${job.company || "?"} | ${reason}${detail} | ${job.url}\n`); } catch { /* ignore */ }
}

/**
 * Atomičan upis JSON-a: tmp fajl + fsync + rename; postojeći (ispravan) fajl se pre zamene kopira u `<file>.bak`.
 * Bez fsync-a rename posle nestanka struje / restarta ume da ostavi prazan fajl (viđeno 19.09.2026 na drugom scraperu:
 * db.json prazan → scraper krenuo od nule → izgubljeni svi favoriti/odbačeni). Zato fsync + backup + strogo učitavanje.
 */
function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = openSync(tmp, "w");
  try { writeSync(fd, JSON.stringify(value, null, 1)); fsyncSync(fd); } finally { closeSync(fd); }
  if (existsSync(file)) { try { copyFileSync(file, `${file}.bak`); } catch { /* backup nije kritičan */ } }
  renameSync(tmp, file);
}

export class CorruptStoreError extends Error {}

/**
 * Učitava JSON; `undefined` samo ako fajl NE POSTOJI (prva upotreba). Ako postoji a ne može da se parsira (prazan/oštećen),
 * pokušava `<file>.bak`; ako ni to ne valja, baca CorruptStoreError — nikad tiho prazna baza
 * (scraper prekida run i ne piše preko fajla, server vraća 500 sa porukom).
 */
function loadJsonStrict(file: string, valid: (v: any) => boolean): any {
  if (!existsSync(file)) return undefined;
  let err: unknown;
  for (const f of [file, `${file}.bak`]) {
    if (!existsSync(f)) continue;
    try {
      const v = JSON.parse(readFileSync(f, "utf8"));
      if (valid(v)) { if (f !== file) log(`UPOZORENJE: ${file} je oštećen, koristim ${f}`); return v; }
      err = new Error("neočekivan sadržaj");
    } catch (e) { err = e; }
  }
  throw new CorruptStoreError(`${file} postoji ali je oštećen (${(err as Error)?.message ?? "?"}) i nema ispravan .bak — ne pišem preko njega`);
}

// ---------------------------------------------------------------- db.json
export function loadDb(): Db {
  const db = loadJsonStrict(DB_FILE, (v) => v && typeof v === "object" && v.jobs && typeof v.jobs === "object") as Db | undefined;
  if (!db) return { baselineAt: null, lastRun: null, lastRunSummary: "", sources: {}, blockedCompanies: [], jobs: {} };
  db.sources ??= {};
  db.blockedCompanies ??= [];
  db.baselineAt ??= null;
  return db;
}

export function saveDb(db: Db): void {
  writeJsonAtomic(DB_FILE, db);
}

// ---------------------------------------------------------------- seen.json: id -> datum objave kad smo ga prvi put videli
export type SeenMap = Map<string, string | null>;

export function loadSeen(): SeenMap {
  const v = loadJsonStrict(SEEN_FILE, (x) => x && typeof x === "object" && !Array.isArray(x)) as Record<string, string | null> | undefined;
  return new Map(Object.entries(v ?? {}));
}

export function saveSeen(seen: SeenMap): void {
  writeJsonAtomic(SEEN_FILE, Object.fromEntries(seen));
}

export function toStored(j: Job, s: Scoring): StoredJob {
  const now = new Date().toISOString();
  return {
    ...j,
    summary: j.summary || firstSentences(j.description),
    status: "new", firstSeen: now, lastSeen: now,
    salaryText: fmtSalary(j.salary), salaryEurMonth: salaryEurMonth(j.salary),
    score: s.score, level: s.level, reasons: s.reasons, categories: s.categories, badges: s.badges,
    partTime: s.partTime, serbian: s.serbian, remoteFinal: s.remoteFinal,
  };
}
