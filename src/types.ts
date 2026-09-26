export type Source = "infostud" | "startuj" | "poslovirs" | "halooglasi" | "nsz" | "jobrack" | "linkedin" | "wwr" | "himalayas" | "jooble";
export type Status = "new" | "favorite" | "applied" | "rejected";
export type SalaryPeriod = "year" | "month" | "week" | "day" | "hour";
export type RemoteType = "remote" | "hybrid" | "onsite" | "unknown";
export type EmploymentKind = "part-time" | "full-time" | "freelance" | "contract" | "temporary" | "internship";
export type MatchLevel = "excellent" | "good" | "possible" | "low";

export interface Salary {
  min: number | null;
  max: number | null;
  currency: string | null;      // ISO kod ("EUR", "RSD"); null = nepoznato
  period: SalaryPeriod | null;  // null = nepoznato
  text?: string;                // sirovi tekst sa sajta
}

/** Oglas kako ga vrati parser sajta (normalizovan, još neocenjen). */
export interface Job {
  source: Source;
  id: string;                   // "<source>:<id sajta>"  (Startuj koristi "infostud:<id>" – isti oglas)
  url: string;                  // direktan link na originalni oglas
  title: string;
  company: string;              // "" = nepoznato
  companyLogo?: string;
  location: string;             // "Beograd" | "Remote — Serbia" | "Anywhere in the World"; "" = nije navedeno
  remote: RemoteType;           // šta sajt kaže (flag/filter); "unknown" -> odlučuje tekst opisa
  employment: EmploymentKind[]; // samo iz polja sajta (ne iz teksta)
  salary?: Salary;
  postedAt: string | null;      // ISO (UTC); null = sajt ne daje datum
  description?: string;         // čist tekst (skraćen na DESCRIPTION_MAX)
  summary?: string;             // kratak sažetak sa sajta (Infostud jobSummary) – inače se pravi iz opisa
  tags: string[];
  locationVerified?: boolean;   // sajt je već filtrirao po zemlji (Himalayas country=RS, LinkedIn location=Serbia)
}

export interface Scoring {
  score: number;
  level: MatchLevel;
  reasons: string[];            // "+40 Srpski jezik", "-40 Full-time" … (za tunovanje i <details> na kartici)
  categories: string[];         // id-jevi kategorija iz rules.json
  badges: string[];             // čipovi za karticu
  reject: string | null;        // tvrdo odbijanje (engleski C1, strani jezik, US only, developer…)
  partTime: boolean;
  serbian: boolean;             // srpski/BHS eksplicitno tražen
  remoteFinal: RemoteType;      // posle teksta opisa
}

export interface AlsoOn { id: string; source: Source; url: string }

/** Oglas u lokalnoj bazi. */
export interface StoredJob extends Job {
  status: Status;
  firstSeen: string;            // ISO – kad ga je scraper prvi put video
  lastSeen: string;             // ISO – poslednji put viđen na sajtu
  salaryText: string;           // "" = nije navedena
  salaryEurMonth: number | null;
  score: number;
  level: MatchLevel;
  reasons: string[];
  categories: string[];
  badges: string[];
  partTime: boolean;
  serbian: boolean;
  remoteFinal: RemoteType;
  alsoOn?: AlsoOn[];            // isti oglas na drugim sajtovima
  hiddenByRules?: boolean;      // status "rejected" je postavio `score --rescore` (ne korisnik) -> sme da se vrati kad pravila opet propuste oglas
}

export interface SourceState { lastFetched: string; summary: string }

export interface Db {
  baselineAt: string | null;    // od kog datuma se oglasi uzimaju (prvi run: sada − lookbackDays)
  lastRun: string | null;
  lastRunSummary: string;
  sources: Record<string, SourceState>;
  blockedCompanies: string[];
  jobs: Record<string, StoredJob>;
}

export interface SourceConfig { enabled: boolean; everyMin: number }

export interface Config {
  port: number;
  lookbackDays: number;
  intervalMin: number;
  minScore: number;
  ntfyTopic: string;
  sources: Record<Source, SourceConfig>;
  infostud: { maxPages: number; maxDetails: number; queries: string[]; remoteOnlyQueries: string[] };
  startuj: { paths: string[]; maxPages: number };
  poslovirs: { maxPages: number; maxDetails: number };
  halooglasi: { maxPages: number; maxDetails: number };
  nsz: { categories: number[]; queries: string[]; maxPages: number; maxDetails: number };
  jobrack: { categories: string[]; maxPages: number; listPages: number; maxDetails: number };
  linkedin: { location: string; maxPages: number; maxDetails: number; queries: string[] };
  wwr: { feeds: string[] };
  himalayas: { country: string; maxPages: number; queries: string[] };
  jooble: { apiKey: string; location: string; queries: string[] };
  blockedCompanies: string[];
  fx: Record<string, number>;
}

/** Pravila ocenjivanja (rules.json). */
export interface RuleGroup { label: string; score: number; patterns: string[] }
export interface Rules {
  thresholds: { excellent: number; good: number; possible: number };
  categories: Array<{ id: string; label: string; weight: number; patterns: string[] }>;
  language: {
    serbianRequired: string[]; serbianRequiredScore: number;
    requireSerbianAd: boolean;    // tvrdo: oglas mora biti napisan na srpskom (BHS); engleski oglasi se odbijaju
    serbianAdWords: string[]; englishAdWords: string[]; serbianAdMinWords: number; serbianAdScore: number;
    basicEnglish: string[]; basicEnglishScore: number;
    englishHardReject: string[]; englishRejectExceptions: string[];
    foreignLanguages: string; foreignTitleScore: number; foreignDescriptionPatterns: string[]; foreignDescriptionScore: number;
  };
  employment: {
    partTime: string[]; partTimeTitle: string[]; partTimeScore: number; flexibleScore: number; fullTimeText: string[]; fullTimeScore: number;
    remoteText: string[]; onsiteText: string[]; remoteScore: number;
    hybridCities: string[]; hybridScore: number; hybridElsewhereScore: number; // hibrid prolazi samo u ovim gradovima I ako je part-time
    onsiteScore: number; unknownRemoteScore: number;
  };
  location: { exclude: string[]; excludeScore: number; include: string[]; includeScore: number };
  negatives: { title: RuleGroup[]; text: RuleGroup[] };
  positives: Array<{ id: string; label: string; score: number; patterns: string[] }>;
}

/** Šta scrape.ts prosleđuje parseru. */
export interface SearchCtx {
  since: Date;
  isSeen: (id: string) => boolean;
  log: (msg: string) => void;
}
