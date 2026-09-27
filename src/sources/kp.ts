/**
 * KupujemProdajem – kategorija Poslovi, categoryId=2546 (provereno 27.09.2026). Next.js SSR; Node fetch sa Chrome UA + Accept-Language sr-RS
 * prolazi bez Cloudflare-a (curl nije potreban). OGRANIČENJE: dva puta zaredom posle ~33 otvorena DETALJA (razmak 1,3 s) sajt je uključio
 * „areYouHuman“ na ~7 min (vidi anti-bot); strane liste / pretrage se ne broje (36 zaredom prošlo, detalj posle toga OK) -> maxDetails 25.
 *   lista:  GET https://www.kupujemprodajem.com/pretraga?categoryId=2546&page=N&order=posted%20desc   (30 po strani, ~515 aktivnih = ~18 strana)
 *           `<script id="__NEXT_DATA__">` -> props.initialReduxState.search { total, pages, adsIds[], byId[id] }  (NIJE pageProps – helper nextData() ne važi)
 *           byId: id, name (naslov, ponekad ćirilica), postedRaw „YYYY-MM-DD HH:MM:SS“ (LOKALNO beogradsko vreme), postedDays („pre 3 dana“),
 *           groupId/groupName (21 grupa, vidi SKIP ispod), location („Beograd | Zvezdara“), descriptionSnippetDecoded (~60 znakova), adUrl (relativan),
 *           hasImage/smallImage, isTopSearch (plaćena promocija: ~12 STARIJIH oglasa na vrhu 1. strane, ne ponavljaju se dalje u listi).
 *           Oglas traje 30 dana; „Obnovi“ ga vraća na vrh sa novim postedRaw i ISTIM id-jem (pola aktivnih je obnovljeno).
 *   ključna reč: &keywords=<kw>&keywordsScope=description – labavo, po rečima, bez obzira na dijakritike
 *           („od kuće“ = „rad od kuće“ = „od kuce“ -> isti 12 oglasa, pa se „rad od kuće“ ne šalje posebno; „nepuno“ i „skraćeno“ -> 0).
 *   detalj: GET https://www.kupujemprodajem.com + adUrl  (kratak /oglas/<id> vraća 404) -> initialReduxState.ad.byId[id] { name, description (HTML),
 *           postedRaw, location, ownerName (naziv firme / korisnika), declarationType, photos[].thumbnail, adValidUntil „YYYY-MM-DD“,
 *           jobApplicationType (email/phone/link) }. Poslovi NEMAJU strukturisana polja (adAttributes je prazan, nema radnog vremena ni mesta rada):
 *           „Rad od kuće“, „Fleksibilno radno vreme“ su redovi u opisu (lista „Šta nudimo“) -> kratki takvi redovi idu u tags, a remote="remote"
 *           samo kad naslov ili takav samostalan red jasno kaže rad od kuće; inače "unknown" i ocena čita tekst. Emotikone sajt šalje kao „?“ -> brišu se.
 *   anti-bot: initialReduxState.antiBot { antiBotHumanCheck, areYouHumanError, captchaSiteKey } + modal.activeModal="areYouHuman".
 *           Normalno je sve prazno; blokiran: captchaSiteKey="6Lc0…" (reCAPTCHA), detalj ima ad.byId[id] = {} (bez opisa), lista i dalje vraća podatke.
 *           Bilo šta od toga (ili HTTP 429/403) = stop za ovaj prolaz, vraća se ono što je već obrađeno (ništa se ne baca).
 * Prolaz: lista od najnovijeg dok ne naiđe strana bez neviđenih (redovnih) oglasa ili oglas stariji od ctx.since (maxPages). Novih oglasa je
 * ~18 dnevno, pa je obično dovoljno 2 strane + detalj za svaki neviđen oglas kome naslov ne obara ocenu (titleRejected -> bez detalja).
 * Zaostatak (više neviđenih kandidata nego maxDetails – prvi prolaz, posle pauze): tada i po jedna strana za svaku ključnu reč (opis) i detalj
 * po prioritetu: 1) pogodak ključne reči ili nagoveštaj u naslovu/snippetu, 2) naslov pogađa kategoriju, 3) ostali – od NAJSTARIJEG ka najnovijem;
 * oglasi iz grupa fizičkih/terenskih poslova (skipGroups) bez nagoveštaja se tada vraćaju bez detalja.
 * Red za detalje (kao nsz): kad se maxDetails potroši, neobrađeni se NE vraćaju (ostaju neviđeni) – a ni jeftini oglasi NOVIJI od tog reza, da bi
 * neobrađeni uvek ostali na vrhu liste i sledeći prolaz do njih stigao (inače bi 1. strana bila sva viđena i čitanje bi tu stalo).
 * Oglasi stariji od ctx.since se ne vraćaju (ostaju neviđeni: kad ga obnove, dođe na vrh sa novim datumom i tada se oceni).
 */
import { CONFIG } from "../config.ts";
import { decodeEntities, fetchText, htmlToText, sleep, truncate } from "../http.ts";
import { salaryFromDescription } from "../salary.ts";
import { titleHasCategory, titleRejected } from "../score.ts";
import { fold, latinize } from "../text.ts";
import type { Job, SearchCtx } from "../types.ts";

const BASE = "https://www.kupujemprodajem.com";
const CATEGORY = 2546;
const PAGE_SIZE = 30;

const DEFAULTS = {
  maxPages: 20,
  maxDetails: 25,  // sajt blokira posle ~33 detalja u kratkom roku; zaostatak od ~100 kandidata se tako skine za 4–5 prolaza, posle 0–2 detalja po satu
  delayMs: 1300,
  keywords: ["od kuće", "online", "na daljinu", "remote", "honorarno", "honorarni", "fleksibilno", "part time", "preko interneta", "pola radnog"],
  keywordsAlways: false, // false = ključne reči samo kad ima zaostatka (više neviđenih nego maxDetails); true = svaki prolaz (+10 zahteva)
  // grupe bez šanse za rad od kuće – pri zaostatku detalj samo uz nagoveštaj (ključna reč / naslov / snippet) ili naslov iz ciljane kategorije:
  // 2548 Bezbednost i zaštita, 2549 Čuvanje i nega dece i odraslih, 2550 Medicina i farmacija, 2551 Fizički poslovi, 2552 Građevinarstvo,
  // 2553 Higijena, 2554 Priprema hrane, 2555 Majstori, 2557 Nega i lepota, 2558 Poljoprivreda, 2559 Prevoz i dostava, 2560 Proizvodnja,
  // 2561 Skladištenje i logistika, 2564 Ugostiteljstvo.  Uvek se čitaju: 2547 Administracija, 2556 Marketing i promocija, 2562 Trgovina i prodaja,
  // 2563 Turizam, 2565 Ostali poslovi, 2566 IT, 2597 Omladinski i studentski poslovi.
  skipGroups: [2548, 2549, 2550, 2551, 2552, 2553, 2554, 2555, 2557, 2558, 2559, 2560, 2561, 2564],
};

const clean = (s: unknown) => latinize(decodeEntities(htmlToText(String(s ?? "")))).replace(/\s+/g, " ").trim();
/** Nagoveštaj u naslovu/snippetu/ključnoj reči (nad fold tekstom) -> detalj ide prvi. */
const HINT = /od kuce|na daljinu|\bremote\b|preko interneta|\bonline\b|onlajn|home office|honorar|nepun\w* radn|part[- ]?time|skracen\w* radn|fleksibiln|pola radnog|freelance|dodatn\w* zarad/;
/** Naslov jasno kaže rad od kuće („Call operater-Rad od kuce“). */
const REMOTE_TITLE = /\bod kuce\b|na daljinu|\bremote\b|rad online|online rad|preko interneta|home office|work from home/;
/** Kratak red opisa koji je sam za sebe pogodnost („Rad od kuće“, „Fleksibilno radno vreme“, „Honorarni posao“). */
const PERK = /od kuce|na daljinu|\bremote\b|\bonline\b|preko interneta|home office|fleksibiln|honorar|part[- ]?time|pola radnog|nepun\w* radn|skracen\w* radn/;
/** …a od takvih redova samo ovi znače remote (ne „mogućnost rada od kuće“, ne „delimično od kuće“). */
const REMOTE_PERK = /^(rad (od kuce|na daljinu|online|preko interneta)|posao od kuce|remote|online|home office)$/;

interface Ad { job: Job; siteId: string; groupId: number; snippet: string; promo: boolean; prio: number; todo: boolean }

// ---------------------------------------------------------------- parsiranje

/** Beogradsko vreme (CET/CEST) -> UTC, nezavisno od vremenske zone računara. */
const BG = (() => {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Belgrade", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  } catch { return null; }
})();

/** Koliko je Beograd ispred UTC-a u trenutku t (ms). */
function bgOffset(t: number): number {
  const p = Object.fromEntries(BG!.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
}

/** „2026-09-17 12:44:23“ (Beograd) -> „2026-09-17T10:44:23.000Z“; loš format -> null. */
function postedToIso(raw: unknown): string | null {
  const m = String(raw ?? "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map((x) => Number(x ?? 0));
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  if (!BG) { const local = new Date(y, mo - 1, d, h, mi, s); return Number.isNaN(local.getTime()) ? null : local.toISOString(); }
  let t = wall - bgOffset(wall);
  t = wall - bgOffset(t); // drugi krug – tačno i oko prelaska na letnje/zimsko vreme
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** „Beograd | Zvezdara“ -> „Beograd, Zvezdara“. */
const locationOf = (s: unknown) => clean(s).split(/\s*\|\s*/).filter(Boolean).join(", ");
/** Sličica oglasa (najčešće logo firme); prazan oglas daje „https://images.kupujemprodajem.comundefined“. */
const imageOf = (u: unknown) => (typeof u === "string" && /^https:\/\/images\.kupujemprodajem\.com\/photos\//.test(u) ? u : undefined);

/** Ceo `__NEXT_DATA__` -> props.initialReduxState (ili null). */
function reduxState(html: string): any {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1])?.props?.initialReduxState ?? null; } catch { return null; }
}

/** Neprazno polje antiBot/softBlock -> razlog, inače "". */
function antiBot(state: any): string {
  const ab = state?.antiBot ?? {};
  const full = (v: unknown) => (v && typeof v === "object" ? Object.keys(v).length > 0 : Boolean(v));
  if (full(ab.antiBotHumanCheck) || full(ab.areYouHumanError) || full(ab.captchaSiteKey) || state?.modal?.activeModal === "areYouHuman") {
    return `anti-bot provera „areYouHuman“ (captchaSiteKey ${ab.captchaSiteKey ? "postavljen" : "prazan"})`;
  }
  const sb = state?.meta?.softBlockError;
  if (sb?.reason || state?.meta?.isBlacklistMode) return `blokada (${sb?.reason || "blacklist"})`;
  return "";
}

/** HTML opisa -> tekst; „?“ na početku reda je emotikon koji sajt ne ume da pošalje. */
function descriptionText(html: string): string {
  return latinize(htmlToText(html)).replace(/^([ \t]*(?:•[ \t]*)?)\?+[ \t]*/gm, "$1").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Kratki samostalni redovi opisa sa pogodnostima (remote / honorarno / fleksibilno). */
function perksOf(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^[\s•\-–*✓✔·>]+|[\s.,;:!]+$/g, "").trim();
    if (line.length < 4 || line.length > 50 || !PERK.test(fold(line))) continue;
    if (!out.some((p) => fold(p) === fold(line))) out.push(line);
    if (out.length >= 6) break;
  }
  return out;
}

function fromList(a: any): Ad | null {
  const siteId = String(a?.id ?? "");
  const title = clean(a?.name);
  if (!/^\d+$/.test(siteId) || !title || !a?.adUrl) return null;
  const snippet = clean(a.descriptionSnippetDecoded).replace(/\s*\.{3}$/, "…");
  return {
    siteId, groupId: Number(a.groupId ?? 0), snippet, promo: Boolean(a.isTopSearch || a.isTop || a.isPriority), prio: -1, todo: false,
    job: {
      source: "kp", id: `kp:${siteId}`, url: `${BASE}${String(a.adUrl).split("?")[0]}`, title, company: "",
      companyLogo: a.hasImage ? imageOf(a.smallImage) : undefined,
      location: locationOf(a.location ?? a.locationName),
      remote: REMOTE_TITLE.test(fold(title)) ? "remote" : "unknown",
      employment: [],
      postedAt: postedToIso(a.postedRaw),
      description: snippet,
      tags: [clean(a.groupName)].filter(Boolean),
    },
  };
}

const listAds = (s: any): Ad[] => (Array.isArray(s?.adsIds) ? s.adsIds : []).map((id: unknown) => fromList(s.byId?.[String(id)])).filter((a: Ad | null): a is Ad => a !== null);

function applyDetail(job: Job, a: any): void {
  const title = clean(a.name);
  if (title) job.title = title;
  const text = descriptionText(String(a.description ?? ""));
  if (text) job.description = truncate(text);
  job.postedAt = postedToIso(a.postedRaw) ?? job.postedAt;
  const loc = locationOf(a.location);
  if (loc) job.location = loc;
  const owner = clean(a.ownerName);
  if (owner) job.company = owner;
  job.companyLogo = imageOf(a.photos?.[0]?.thumbnail) ?? job.companyLogo;
  const perks = perksOf(text);
  if (REMOTE_TITLE.test(fold(job.title)) || perks.some((p) => REMOTE_PERK.test(fold(p)))) job.remote = "remote";
  job.salary = salaryFromDescription(text) ?? undefined;
  const until = String(a.adValidUntil ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  job.tags = [...new Set([...job.tags, ...perks, until ? `rok ${until[3]}.${until[2]}.${until[1]}` : ""].filter(Boolean))];
}

// ---------------------------------------------------------------- pretraga

const listUrl = (page: number) => `${BASE}/pretraga?categoryId=${CATEGORY}&page=${page}&order=posted%20desc`;
const keywordUrl = (kw: string) => `${BASE}/pretraga?categoryId=${CATEGORY}&keywords=${encodeURIComponent(kw)}&keywordsScope=description&order=posted%20desc`;

type Loaded = { state: any } | { blocked: string };

/** Strana -> redux stanje, ili { blocked } kad sajt traži proveru / vrati 429–403. Ostale greške se bacaju. */
async function load(url: string): Promise<Loaded> {
  let html: string;
  try { html = await fetchText(url, { tries: 2 }); } catch (e) {
    const msg = (e as Error).message;
    if (/\b(429|403)\b|rate limit|captcha|challenge/i.test(msg)) return { blocked: msg };
    throw e;
  }
  const state = reduxState(html);
  if (!state) {
    if (/captcha|are you human|da li ste (ljudsko bi|čovek|covek)|robot/i.test(html)) return { blocked: "captcha (nema __NEXT_DATA__)" };
    throw new Error("__NEXT_DATA__ / initialReduxState nije pronađen (promenjen sajt?)");
  }
  const why = antiBot(state);
  return why ? { blocked: why } : { state };
}

export async function search(ctx: SearchCtx): Promise<Job[]> {
  const o = { ...DEFAULTS, ...((CONFIG as any).kp ?? {}) };
  const skip = new Set<number>((o.skipGroups ?? []).map(Number));
  const since = ctx.since.getTime();
  const isOld = (j: Job) => j.postedAt !== null && new Date(j.postedAt).getTime() < since;
  const ads = new Map<string, Ad>();  // sve iz liste + ključnih reči (redosled: lista od najnovijeg, pa promocije / ključne reči)
  const region: string[] = [];        // redovna lista (bez plaćenih promocija), od najnovijeg ka najstarijem
  const inRegion = new Set<string>();
  const hinted = new Set<string>();   // pogodak ključne reči u opisu
  let blocked = "";
  let requests = 0;

  const get = async (url: string, what: string): Promise<any | null> => {
    if (blocked) return null;
    if (requests++) await sleep(o.delayMs);
    const r = await load(url);
    if ("blocked" in r) { blocked = r.blocked; ctx.log(`[kp] ${what}: ${blocked} – stajem za ovaj prolaz`); return null; }
    return r.state;
  };

  // ---- lista, od najnovijeg
  let pages = 1;
  for (let page = 1; page <= Math.min(o.maxPages, pages); page++) {
    let state: any;
    try { state = await get(listUrl(page), `strana ${page}`); } catch (e) {
      if (page === 1) throw e;
      ctx.log(`[kp] strana ${page}: ${(e as Error).message}`); break;
    }
    if (!state) break;
    const s = state.search ?? {};
    pages = Number(s.pages ?? 1) || 1;
    const list = listAds(s);
    let unseen = 0, promo = 0, older = false;
    for (const a of list) {
      const known = ads.get(a.job.id);
      if (!known) ads.set(a.job.id, a);
      if (a.promo) { promo++; continue; }
      if (known) known.promo = false;
      if (!inRegion.has(a.job.id)) { inRegion.add(a.job.id); region.push(a.job.id); }
      if (!ctx.isSeen(a.job.id)) unseen++;
      if (isOld(a.job)) older = true;
    }
    ctx.log(`[kp] page=${page}/${pages} results=${list.length} promo=${promo} neviđenih=${unseen}${older ? " (stigao do ctx.since)" : ""} (ukupno ${s.total ?? "?"})`);
    if (list.length < PAGE_SIZE || unseen === 0 || older) break;
  }

  // ---- zaostatak = više neviđenih kandidata nego maxDetails (prvi prolaz, posle pauze). Tada: ključne reči za prioritet + preskakanje
  //      fizičkih grupa. Inače (~18 novih oglasa dnevno) se skida detalj za svaki neviđen oglas kome naslov ne obara ocenu, pa ključne reči
  //      ne donose ništa novo (nov ili obnovljen oglas je ionako na vrhu liste) – ne šalje se 10 upita na sat bez potrebe.
  const candidates = [...ads.values()].filter((a) => !ctx.isSeen(a.job.id) && !isOld(a.job) && !titleRejected(a.job.title)).length;
  const backlog = candidates > o.maxDetails;
  const keywords: string[] = backlog || o.keywordsAlways ? o.keywords : [];
  if (!keywords.length && !blocked) ctx.log(`[kp] ${candidates} neviđenih kandidata ≤ maxDetails ${o.maxDetails} -> bez ključnih reči, detalj za svaki`);

  // ---- ključne reči (opis): nagoveštaj za prioritet + oglasi van pročitanih strana
  for (const kw of keywords) {
    let state: any;
    try { state = await get(keywordUrl(kw), `„${kw}“`); } catch (e) { ctx.log(`[kp] „${kw}“: ${(e as Error).message}`); continue; }
    if (!state) break;
    const list = listAds(state.search ?? {});
    let extra = 0;
    for (const a of list) { hinted.add(a.job.id); if (!ads.has(a.job.id)) { ads.set(a.job.id, a); extra++; } }
    ctx.log(`[kp] „${kw}“: ${list.length} oglasa (${extra} van pročitane liste)`);
  }

  // ---- šta treba detalj: prio -1 = ne treba, 0 = nagoveštaj, 1 = kategorija u naslovu, 2 = ostali
  const out: Job[] = [];
  let todo = 0;
  for (const a of ads.values()) {
    if (ctx.isSeen(a.job.id)) { out.push(a.job); continue; } // osveži lastSeen
    if (isOld(a.job)) continue;
    a.todo = true; todo++;
    const t = a.job.title;
    const hint = hinted.has(a.job.id) || HINT.test(fold(`${t} ${a.snippet}`));
    a.prio = titleRejected(t) ? -1 : hint ? 0 : titleHasCategory(t) ? 1 : backlog && skip.has(a.groupId) ? -1 : 2;
  }

  let details = 0, fetched = 0, cheap = 0;
  const tried = new Set<string>();
  const canFetch = () => !blocked && details < o.maxDetails;
  const detail = async (a: Ad): Promise<boolean> => {
    tried.add(a.job.id);
    details++;
    try {
      const state = await get(a.job.url, `detalj ${a.job.id}`);
      if (!state) return false;
      const ad = state.ad?.byId?.[a.siteId];
      if (!ad?.name || ad.isAdDeleted) { ctx.log(`[kp] detalj ${a.job.id}: oglas nije u __NEXT_DATA__ (uklonjen?)`); return false; }
      applyDetail(a.job, ad);
      fetched++;
      return true;
    } catch (e) { ctx.log(`[kp] detalj ${a.job.id}: ${(e as Error).message}`); return false; }
  };

  // 1) nagoveštaj pa kategorija – bilo gde u listi
  const first = [...ads.values()].filter((a) => a.todo && a.prio >= 0 && a.prio <= 1).sort((x, y) => x.prio - y.prio);
  for (const a of first) { if (!canFetch()) break; if (await detail(a)) out.push(a.job); }

  // 2) redovna lista od najstarijeg: posle reza (potrošen maxDetails) ništa novije se ne vraća, da neobrađeni ostanu na vrhu liste
  let cut = false;
  for (let i = region.length - 1; i >= 0; i--) {
    const a = ads.get(region[i])!;
    if (!a.todo || tried.has(a.job.id) || cut) continue;
    if (a.prio < 0) { out.push(a.job); cheap++; continue; }
    if (!canFetch()) { cut = true; continue; }
    if (await detail(a)) out.push(a.job);
  }

  // 3) plaćene promocije i pogoci ključnih reči van pročitane liste
  for (const a of ads.values()) {
    if (!a.todo || inRegion.has(a.job.id) || tried.has(a.job.id)) continue;
    if (a.prio < 0) { out.push(a.job); cheap++; continue; }
    if (canFetch() && await detail(a)) out.push(a.job);
  }

  const waiting = todo - out.filter((j) => !ctx.isSeen(j.id)).length;
  ctx.log(`[kp] ukupno ${ads.size} oglasa (${todo} neviđenih u periodu): ${fetched}/${details} detalja skinuto, ${cheap} bez detalja (naslov/grupa), ${waiting} čeka sledeći prolaz${blocked ? ` – PREKINUTO: ${blocked}` : ""}`);
  return out;
}
