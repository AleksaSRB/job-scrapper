/**
 * Ocena oglasa po pravilima iz rules.json (vidi docs/brief.md §7). Rezultat: skor, nivo, razlozi, čipovi, tvrdo odbijanje.
 * Sve se radi nad tekstom bez dijakritika (text.ts fold), pa pravila važe i za „podrška“ i za „podrska“.
 */
import { CONFIG, RULES } from "./config.ts";
import { compile, fold, latinize, sentenceAround } from "./text.ts";
import type { Job, MatchLevel, RemoteType, Scoring } from "./types.ts";

const L = RULES.language, E = RULES.employment, LOC = RULES.location;

const CATS = RULES.categories.map((c) => ({ ...c, re: compile(c.patterns, `categories.${c.id}`) }));
const SR_REQ = compile(L.serbianRequired, "language.serbianRequired");
const SR_WORDS = compile(L.serbianAdWords, "language.serbianAdWords");
const EN_BASIC = compile(L.basicEnglish, "language.basicEnglish");
const EN_HARD = L.englishHardReject.map((p) => new RegExp(p, "gi"));
const EN_EXC = compile(L.englishRejectExceptions, "language.englishRejectExceptions");
const FOREIGN_TITLE = new RegExp(`\\b(${L.foreignLanguages})`, "i");
const FOREIGN_DESC = compile(L.foreignDescriptionPatterns.map((p) => p.replace(/LANG/g, L.foreignLanguages)), "language.foreignDescriptionPatterns");
const PART_TIME = compile(E.partTime, "employment.partTime");
const REMOTE_TXT = compile(E.remoteText, "employment.remoteText");
const ONSITE_TXT = compile(E.onsiteText, "employment.onsiteText");
const LOC_EXCL = compile(LOC.exclude, "location.exclude");
const LOC_INCL = compile(LOC.include, "location.include");
const NEG_TITLE = RULES.negatives.title.map((g) => ({ ...g, re: compile(g.patterns, `negatives.title.${g.label}`) }));
const NEG_TEXT = RULES.negatives.text.map((g) => ({ ...g, re: compile(g.patterns, `negatives.text.${g.label}`) }));
const POS = RULES.positives.map((g) => ({ ...g, re: compile(g.patterns, `positives.${g.id}`) }));

const firstMatch = (res: RegExp[], text: string): RegExpMatchArray | null => { for (const r of res) { const m = text.match(r); if (m) return m; } return null; };
const quote = (s: string) => `«${s.trim().replace(/\s+/g, " ").slice(0, 60)}»`;
const sign = (n: number) => (n >= 0 ? `+${n}` : String(n));

export function levelOf(score: number): MatchLevel {
  const t = RULES.thresholds;
  return score >= t.excellent ? "excellent" : score >= t.good ? "good" : score >= t.possible ? "possible" : "low";
}

export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(RULES.categories.map((c) => [c.id, c.label]));

/** Naslov pogađa bar jednu kategoriju – parseri po tome biraju za koje (neviđene) oglase vredi skidati detalj. */
export function titleHasCategory(title: string): boolean {
  const t = fold(latinize(title));
  return CATS.some((c) => c.re.some((r) => r.test(t)));
}

export function scoreJob(job: Job): Scoring {
  const title = fold(latinize(job.title));
  const body = fold(latinize(`${job.description ?? ""}\n${job.summary ?? ""}\n${job.tags.join(" ")}`));
  const text = `${title}\n${body}`;
  const loc = fold(latinize(job.location));
  const reasons: string[] = [];
  const badges: string[] = [];
  let score = 0;
  let reject: string | null = null;
  const add = (n: number, why: string) => { score += n; reasons.push(`${sign(n)} ${why}`); };
  const hardReject = (why: string) => { if (!reject) reject = why; reasons.push(`✕ ${why}`); };

  // ---- kategorije (naslov = puna težina, samo opis = 60 %)
  const cats: Array<{ id: string; label: string; pts: number; inTitle: boolean }> = [];
  for (const c of CATS) {
    if (c.re.some((r) => r.test(title))) cats.push({ id: c.id, label: c.label, pts: c.weight, inTitle: true });
    else if (c.re.some((r) => r.test(body))) cats.push({ id: c.id, label: c.label, pts: Math.round(c.weight * 0.6), inTitle: false });
  }
  cats.sort((a, b) => b.pts - a.pts || Number(b.inTitle) - Number(a.inTitle));
  if (cats.length === 0) hardReject("nijedna ciljana kategorija (podrška / administracija / nekretnine / unos podataka …)");
  else {
    add(cats[0].pts, `${cats[0].label}${cats[0].inTitle ? " (naslov)" : " (opis)"}`);
    if (cats.length > 1) add(Math.min(10, 5 * (cats.length - 1)), `još: ${cats.slice(1, 4).map((c) => c.label).join(", ")}`);
  }

  // ---- negativi u naslovu (developer, senior, lekar, vozač, praksa …)
  const assistantTitle = /\b(assistant|asistent\w*|sekretar\w*|secretary|referent\w*)\b/.test(title);
  for (const g of NEG_TITLE) {
    // "Assistant to the Director", "Asistent menadžera" su administrativne pozicije, ne rukovodeće
    if (assistantTitle && g.score > -100 && /senior|rukovod/i.test(g.label)) continue;
    const m = firstMatch(g.re, title);
    if (!m) continue;
    add(g.score, `${g.label} ${quote(m[0])}`);
    if (g.score <= -100) hardReject(`${g.label}: ${quote(m[0])}`);
  }
  if (job.employment.includes("internship")) add(-50, "praksa (polje sajta)");

  // ---- jezik
  const srMatch = firstMatch(SR_REQ, text);
  const serbian = srMatch !== null;
  if (serbian) {
    add(L.serbianRequiredScore, `srpski/BHS se traži ${quote(srMatch![0])}`);
    badges.push(/bcs|bhs|bosn|croat|hrvat|serbo|srpskohrv/i.test(srMatch![0]) ? "BHS" : "Srpski");
  } else {
    const n = SR_WORDS.filter((r) => r.test(text)).length;
    if (n >= L.serbianAdMinWords) { add(L.serbianAdScore, `oglas napisan na srpskom (${n} reči)`); badges.push("Oglas na srpskom"); }
  }
  let englishHit: string | null = null;
  outer: for (const re of EN_HARD) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const sentence = sentenceAround(text, m.index ?? 0);
      if (EN_EXC.some((r) => r.test(sentence))) continue;
      englishHit = m[0]; break outer;
    }
  }
  if (englishHit) hardReject(`traži se napredni engleski ${quote(englishHit)}`);
  else {
    const b = firstMatch(EN_BASIC, text);
    if (b) { add(L.basicEnglishScore, `osnovni engleski dovoljan ${quote(b[0])}`); badges.push("Osnovni engleski"); }
  }
  if (!serbian) {
    const ft = title.match(FOREIGN_TITLE);
    if (ft) { add(L.foreignTitleScore, `strani jezik u naslovu ${quote(ft[0])}`); hardReject(`traži se strani jezik: ${quote(ft[0])}`); }
    else {
      const fd = firstMatch(FOREIGN_DESC, body);
      if (fd) { add(L.foreignDescriptionScore, `strani jezik obavezan ${quote(fd[0])}`); hardReject(`traži se strani jezik: ${quote(fd[0])}`); }
    }
  }

  // ---- radno vreme
  const ptMatch = firstMatch(PART_TIME, text);
  let partTime = false;
  if (job.employment.includes("part-time")) { add(E.partTimeScore, "part-time (polje sajta)"); badges.push("Part-time"); partTime = true; }
  else if (job.employment.includes("freelance") || job.employment.includes("contract")) { add(E.flexibleScore, `${job.employment.includes("freelance") ? "honorarno/freelance" : "ugovor"} (polje sajta)`); badges.push(job.employment.includes("freelance") ? "Honorarno" : "Ugovor"); partTime = true; }
  else if (job.employment.includes("full-time")) {
    if (ptMatch) { add(E.flexibleScore, `full-time, ali pominje fleksibilnost ${quote(ptMatch[0])}`); badges.push("Fleksibilno"); partTime = true; }
    else { add(E.fullTimeScore, "full-time (polje sajta)"); badges.push("Full-time"); }
  } else if (ptMatch) { add(E.partTimeScore, `part-time / fleksibilno ${quote(ptMatch[0])}`); badges.push("Part-time"); partTime = true; }
  else if (job.employment.includes("temporary")) badges.push("Privremeno");

  // ---- remote
  let remoteFinal: RemoteType = job.remote;
  if (job.remote === "remote") { add(E.remoteScore, "remote (filter/polje sajta)"); badges.push("Remote"); }
  else if (job.remote === "hybrid") { add(E.hybridScore, "hibrid (polje sajta)"); badges.push("Hibrid"); }
  else if (job.remote === "onsite") { add(E.onsiteScore, "rad iz firme (polje sajta)"); badges.push("Iz firme"); }
  else {
    const r = firstMatch(REMOTE_TXT, text);
    if (r) { add(E.remoteScore, `remote ${quote(r[0])}`); badges.push("Remote"); remoteFinal = "remote"; }
    else {
      const o = firstMatch(ONSITE_TXT, text);
      if (o) { add(E.onsiteScore, `rad iz firme ${quote(o[0])}`); badges.push("Iz firme"); remoteFinal = "onsite"; }
      else add(E.unknownRemoteScore, "nejasno da li je remote");
    }
  }

  // ---- lokacija
  const ex = firstMatch(LOC_EXCL, `${loc}\n${text}`);
  if (ex) { add(LOC.excludeScore, `lokacija isključuje Srbiju ${quote(ex[0])}`); hardReject(`lokacija isključuje Srbiju: ${quote(ex[0])}`); }
  else if (job.locationVerified) add(LOC.includeScore, "sajt već filtrira: dostupno iz Srbije");
  else { const inc = firstMatch(LOC_INCL, `${loc}\n${text}`); if (inc) add(LOC.includeScore, `lokacija ${quote(inc[0])}`); }

  // ---- ostali negativi u tekstu
  for (const g of NEG_TEXT) { const m = firstMatch(g.re, text); if (m) add(g.score, `${g.label} ${quote(m[0])}`); }

  // ---- pozitivi
  for (const g of POS) {
    if (g.id === "serbia-eligible" && (job.locationVerified || ex)) continue;
    const m = firstMatch(g.re, text);
    if (!m) continue;
    add(g.score, `${g.label} ${quote(m[0])}`);
    if (g.id === "entry") badges.push("Bez iskustva");
    if (g.id === "training") badges.push("Obuka");
  }

  for (const c of cats.slice(0, 3)) badges.push(c.label);
  reasons.push(`= ${score}`);
  return { score, level: levelOf(score), reasons, categories: cats.map((c) => c.id), badges: [...new Set(badges)], reject, partTime, serbian, remoteFinal };
}

/** Razlog zbog kog se oglas ne prikazuje (tvrdo odbijanje ili skor ispod praga), ili null. */
export function hideReason(s: Scoring): string | null {
  if (s.reject) return s.reject;
  if (s.score < CONFIG.minScore) return `skor ${s.score} < ${CONFIG.minScore}`;
  return null;
}
