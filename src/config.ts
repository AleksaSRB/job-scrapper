import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config, Rules } from "./types.ts";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** MOM_JOBS_DATA_DIR: privremena baza za probu bez diranja prave data/. */
export const DATA_DIR = process.env.MOM_JOBS_DATA_DIR || join(ROOT, "data");
export const DB_FILE = join(DATA_DIR, "db.json");
export const SEEN_FILE = join(DATA_DIR, "seen.json");
export const LOCK_FILE = join(DATA_DIR, "scrape.lock");
export const RUN_LOG = join(DATA_DIR, "scraper.log");
export const NEW_LOG = join(DATA_DIR, "new_jobs.log");
export const FILTERED_LOG = join(DATA_DIR, "filtered.log");
export const PUBLIC_DIR = join(ROOT, "public");
export const CONFIG_FILE = join(ROOT, "config.json");
export const RULES_FILE = join(ROOT, "rules.json");

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const DEFAULTS: Config = {
  port: 3003,
  lookbackDays: 5,
  intervalMin: 15,
  minScore: 50,
  ntfyTopic: "",
  sources: {
    infostud: { enabled: true, everyMin: 15 },
    startuj: { enabled: true, everyMin: 30 },
    poslovirs: { enabled: true, everyMin: 30 },
    halooglasi: { enabled: true, everyMin: 30 },
    jobrack: { enabled: true, everyMin: 30 },
    linkedin: { enabled: true, everyMin: 60 },
    wwr: { enabled: true, everyMin: 30 },
    himalayas: { enabled: true, everyMin: 30 },
    jooble: { enabled: false, everyMin: 60 },
  },
  infostud: { maxPages: 2, maxDetails: 40, queries: ["korisnička podrška", "administrativni asistent"], remoteOnlyQueries: [] },
  startuj: { paths: ["/honorarni-poslovi"], maxPages: 1 },
  poslovirs: { maxPages: 8, maxDetails: 30 },
  halooglasi: { maxPages: 15, maxDetails: 40 },
  jobrack: { categories: ["support", "executive-assistant"], maxPages: 1, listPages: 2, maxDetails: 20 },
  linkedin: { location: "Serbia", maxPages: 1, maxDetails: 30, queries: ["customer support"] },
  wwr: { feeds: ["remote-customer-support-jobs"] },
  himalayas: { country: "RS", maxPages: 1, queries: ["serbian"] },
  jooble: { apiKey: "", location: "Srbija", queries: ["korisnička podrška"] },
  blockedCompanies: [],
  fx: { EUR: 1, USD: 0.88, RSD: 0.0085 },
};

function loadConfig(): Config {
  let user: Partial<Config> = {};
  try { user = JSON.parse(readFileSync(CONFIG_FILE, "utf8")); } catch { /* koristi default */ }
  const merge = <K extends keyof Config>(k: K): Config[K] => ({ ...(DEFAULTS[k] as object), ...((user[k] ?? {}) as object) }) as Config[K];
  return {
    ...DEFAULTS, ...user,
    port: Number(process.env.MOM_JOBS_PORT) || user.port || DEFAULTS.port,
    sources: merge("sources"), infostud: merge("infostud"), startuj: merge("startuj"), poslovirs: merge("poslovirs"), halooglasi: merge("halooglasi"),
    jobrack: merge("jobrack"), linkedin: merge("linkedin"), wwr: merge("wwr"), himalayas: merge("himalayas"), jooble: merge("jooble"),
    fx: merge("fx"),
  };
}

function loadRules(): Rules {
  try { return JSON.parse(readFileSync(RULES_FILE, "utf8")) as Rules; } catch (e) { throw new Error(`rules.json: ${(e as Error).message}`); }
}

export const CONFIG: Config = loadConfig();
export const RULES: Rules = loadRules();
export const NTFY_TOPIC: string = process.env.NTFY_TOPIC || CONFIG.ntfyTopic || "";
