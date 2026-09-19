import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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

function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 1));
  renameSync(tmp, file);
}

// ---------------------------------------------------------------- db.json
export function loadDb(): Db {
  try {
    const db = JSON.parse(readFileSync(DB_FILE, "utf8")) as Db;
    if (db && typeof db === "object" && db.jobs) {
      db.sources ??= {};
      db.blockedCompanies ??= [];
      db.baselineAt ??= null;
      return db;
    }
  } catch { /* nova baza */ }
  return { baselineAt: null, lastRun: null, lastRunSummary: "", sources: {}, blockedCompanies: [], jobs: {} };
}

export function saveDb(db: Db): void {
  writeJsonAtomic(DB_FILE, db);
}

// ---------------------------------------------------------------- seen.json: id -> datum objave kad smo ga prvi put videli
export type SeenMap = Map<string, string | null>;

export function loadSeen(): SeenMap {
  try {
    return new Map(Object.entries(JSON.parse(readFileSync(SEEN_FILE, "utf8")) as Record<string, string | null>));
  } catch { return new Map(); }
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
