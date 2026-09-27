/**
 * Pagewatch – „večni“ pozivi na sajtovima poslodavaca, bez datuma (provereno 27.09.2026). Agencije za istraživanje tržišta stalno
 * primaju anketare (telefonom od kuće, honorarno), ali to ne objavljuju na oglasnicima – stranica stoji mesecima ista.
 * Svaka stranica iz `pages` = JEDAN oglas sa stalnim id-jem "pagewatch:<key>" i postedAt = null (scrape.ts uzima prvo viđenje kao datum).
 * Unos sa `listUrl` je stranica-spisak: linkovi iz nje koji pogađaju `linkPattern` postaju zasebni oglasi "pagewatch:<key>-<slug linka>"
 * (tako se NOVA radna mesta, npr. na Ipsos /sr-rs/radna-mesta, hvataju sama).
 *
 *   Ipsos (Drupal, iza Cloudflare-a, ali običan fetch prolazi):
 *     GET https://www.ipsos.com/sr-rs/saradnik-za-prikupljanje-podataka-telefonom-anketar-rad-od-kuce
 *         <h1 class="hero__title"><span>SARADNIK ZA  PRIKUPLJANJE PODATAKA TELEFONOM – ANKETAR (RAD OD KUĆE)</span></h1>
 *         tekst: <div class="block-wysiwyg wysiwyg"> … „NUDIMO VAM HONORARNI POSAO KOJI SE RADI OD VAŠE KUĆE (bilo gde na teritoriji
 *         Republike Srbije)“, „gornja granica u pogledu godina ne postoji“ … </div> <section class="block-contact"> (forma, ajax)
 *     GET https://www.ipsos.com/sr-rs/radna-mesta   -> isti block-wysiwyg sa <ul><li><a href="https://www.ipsos.com/sr-rs/<slug>">naslov</a>
 *         Link za CATI je „…-telefonom-istrazivac-rad-od-kuce“ i 301 vodi na „…-anketar-rad-od-kuce“ (<link rel="canonical">), pa se
 *         link iz spiska preskače kad mu je tekst = naslov (ili URL/canonical = URL) neke stranice iz `pages`. Drugi link:
 *         /sr-rs/saradnik-za-rad-na-terenu-istrazivac -> teren (honorarno, fleksibilno, ali nije od kuće).
 *   Open Source (statičan PHP, UTF-8): GET http://www.open-source.rs/ponuda-poslova-sr.php
 *         <h1>STANDARDNA PONUDA POSLOVA:</h1> … „povremeni honorarni posao“, „2.Telefonsko anketiranje … postoji i mogućnost rada od kuće“,
 *         „3. Tajanstveni kupac“ … <strong>PRIJAVITE  SE ZA POSAO!</strong> (posle toga PHP FormMail forma + JS) -> markeri start/kraj.
 *   MASMI (WordPress/Divi): GET https://masmi.rs/karijera/ -> <div class="entry-content"> ima samo „Pogledajte otvorene konkurse“ i
 *         START link na QuestionPro upitnik, nema stranica konkursa (WP REST /wp-json/wp/v2/pages?parent=3494 = [], search „konkurs“ =
 *         samo Karijera) -> vodi se kao SPISAK: čim se u entry-content pojavi link na masmi.rs konkurs, postaje oglas.
 *   Faktor Plus (Joomla + BreezingForms): GET https://www.faktorplus.rs/index.php/zaposlenje-2 -> <title>Kontakt</title>, bez h1;
 *         <section class="bfPageIntro"><h2>Postanite deo Faktor Plus tima</h2> … „1. Anketari za područje Beograda 2. Anketari za područje
 *         Srbije 3. Analitičar 4. Office manager“ </section> <span class="bfErrorMessage"> (forma). Ne piše ni od kuće ni honorarno.
 *   Provereno i NE dodato: ninamedia.rs (ne odgovara – connect timeout), smart-plus.rs (nema stranicu za posao; oglasi idu preko
 *         Infostud-a), houseofwin.net/zaposlenje.php (HTTP 500), ipsos.com/sr-me (Crna Gora).
 *
 * Polja: title = `title` iz konfiguracije ili prvi <h1> ili <title> bez sufiksa sajta („… | Ipsos“); opis = CEO tekst između
 * `contentStart`/`contentEnd` (regex nad sirovim HTML-om; bez njih <main>/<article>/<body> bez nav/header/footer), latinizovan.
 * `remote: "remote"` / `employment` se u konfiguraciji stavljaju SAMO kad tekst stranice to izričito kaže, a `mustMatch` (regex nad
 * fold()-ovanim tekstom) čuva tu tvrdnju: ako stranica prestane to da piše, oglas se ne vraća (log). 404/410 -> preskače se (log).
 * Učtivost: najviše `maxRequests` zahteva po prolazu, `delayMs` između zahteva ka istom hostu, bez ponavljanja (tries 1; sledeći prolaz je
 * za 12 h). Captcha / Cloudflare / 429 -> log i taj host se više ne dira u ovom prolazu. Stranice iz `pages` se čitaju svaki prolaz
 * (to JE ono što se prati – prolaz potvrđuje da je poziv još živ); linkovi iz spiska: viđeni se vraćaju bez skidanja (spisak potvrđuje da
 * postoje), neviđeni se skidaju najviše `maxDetails`, a oni koji nisu stigli se NE vraćaju (ostaju neviđeni za sledeći prolaz).
 * Napomena: scrape.ts viđen id više ne ocenjuje – ako se tekst stranice bitno promeni (npr. Faktor Plus doda „rad od kuće“), promeni `key`.
 */
import { CONFIG } from "../config.ts";
import { decodeEntities, fetchText, htmlToText, sleep, truncate } from "../http.ts";
import { salaryFromDescription } from "../salary.ts";
import { titleRejected } from "../score.ts";
import { fold, latinize } from "../text.ts";
import type { EmploymentKind, Job, SearchCtx } from "../types.ts";

interface PageCommon {
  key: string;                     // deo id-ja – NE menjati (inače oglas ispada nov)
  company: string;
  location?: string;
  remote?: "remote" | "unknown";   // "remote" samo kad tekst stranice izričito kaže rad od kuće
  employment?: EmploymentKind[];   // samo kad tekst stranice izričito kaže (honorarni -> freelance, nepuno -> part-time)
  contentStart?: string;           // regex (i) nad sirovim HTML-om: odavde počinje tekst oglasa
  contentEnd?: string;             // regex (i): ovde se tekst završava
  mustMatch?: string;              // regex (i) nad fold(naslov + tekst): bez pogotka se oglas ne vraća (stranica se promenila)
  tags?: string[];
}
/** Jedna stranica = jedan oglas. */
export interface WatchPage extends PageCommon { url: string; title?: string }
/** Stranica-spisak: svaki link koji pogađa linkPattern je zaseban oglas (contentStart/contentEnd/remote/… važe za te stranice). */
export interface WatchList extends PageCommon { listUrl: string; linkPattern: string; listStart?: string; listEnd?: string }
type Entry = WatchPage | WatchList;

const IPSOS_START = 'class="block-wysiwyg';
const IPSOS_END = 'class="block-contact|</main>';

const DEFAULTS = {
  maxRequests: 10,   // tvrda granica po prolazu (svi hostovi zajedno)
  maxDetails: 4,     // najviše novih stranica iz spiskova po prolazu
  delayMs: 1000,     // pauza između zahteva ka istom hostu
  tries: 1,
  skip: [] as string[],          // key-evi koje ne treba čitati (config.json → pagewatch.skip)
  extraPages: [] as Entry[],     // dodatne stranice iz config.json (dodaju se na `pages`, ne zamenjuju ih)
  pages: [
    {
      key: "ipsos-cati", company: "Ipsos Strategic Marketing", location: "Srbija (bilo gde)",
      url: "https://www.ipsos.com/sr-rs/saradnik-za-prikupljanje-podataka-telefonom-anketar-rad-od-kuce",
      // „NUDIMO VAM HONORARNI POSAO KOJI SE RADI OD VAŠE KUĆE“
      remote: "remote", employment: ["freelance"], mustMatch: "(?=[\\s\\S]*honorar)(?=[\\s\\S]*od (vase )?kuce)",
      contentStart: IPSOS_START, contentEnd: IPSOS_END, tags: ["Rad od kuće", "Honorarni posao", "Telefonsko anketiranje"],
    },
    {
      key: "ipsos", company: "Ipsos Strategic Marketing", location: "Srbija",
      listUrl: "https://www.ipsos.com/sr-rs/radna-mesta", listStart: IPSOS_START, listEnd: "</main>",
      linkPattern: "^https://www\\.ipsos\\.com/sr-rs/[^/?#]+$",
      contentStart: IPSOS_START, contentEnd: IPSOS_END,
    },
    {
      key: "open-source-anketar", company: "Open Source", location: "Srbija",
      url: "http://www.open-source.rs/ponuda-poslova-sr.php",
      // naslov stranice je samo „STANDARDNA PONUDA POSLOVA“; „povremeni honorarni posao“, CATI: „postoji i mogućnost rada od kuće“.
      // Naslov NE sme da sadrži „terensko“ (rules.json negatives.title „terensk“ = -100) – prati se zbog telefonskog dela.
      title: "Anketar – telefonsko anketiranje i tajanstveni kupac (povremeni honorarni posao)",
      employment: ["freelance"], mustMatch: "honorar",
      contentStart: "STANDARDNA PONUDA POSLOVA", contentEnd: "PRIJAVITE\\s+SE\\s+ZA\\s+POSAO",
      tags: ["Honorarni posao", "Telefonsko anketiranje"],
    },
    {
      key: "masmi", company: "MASMI Beograd",
      listUrl: "https://masmi.rs/karijera/", listStart: 'class="entry-content', listEnd: '<footer|id="main-footer"',
      // konkurs bi bio masmi.rs stranica/članak; prijava-anketara je samo forma (CV + captcha), QuestionPro START link je upitnik
      linkPattern: "^https?://(www\\.)?masmi\\.rs/(?!prijava-anketara|en/|wp-)[^?#]*(konkurs|oglas|posao|anketar|saradni|karijera/[^/?#]+)[^?#]*$",
      contentStart: 'class="entry-content', contentEnd: '<footer|id="main-footer"',
    },
    {
      key: "faktorplus-anketari", company: "Faktor Plus", location: "Beograd / Srbija",
      url: "https://www.faktorplus.rs/index.php/zaposlenje-2",
      // <title> je „Kontakt“, a h2 „Postanite deo Faktor Plus tima“ -> naslov iz spiska otvorenih konkursa na stranici
      title: "Anketari za područje Beograda i Srbije (otvoreni konkurs)", mustMatch: "anketar",
      contentStart: "<h2>\\s*Postanite deo Faktor Plus tima", contentEnd: 'class="bfErrorMessage|<section class="bfElemWrap',
    },
  ] as Entry[],
};
type Opts = typeof DEFAULTS;

const MORE_ENTITIES: Record<string, string> = {
  ccaron: "č", Ccaron: "Č", cacute: "ć", Cacute: "Ć", zcaron: "ž", Zcaron: "Ž", dstrok: "đ", Dstrok: "Đ", hellip: "…",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", bdquo: "„", bull: "•", raquo: "»", laquo: "«", reg: "®", copy: "©", euro: "€",
};
const moreEntities = (s: string) => s.replace(/&([A-Za-z]+);/g, (all, n: string) => MORE_ENTITIES[n] ?? all);
const clean = (s: string | undefined) => latinize(decodeEntities(htmlToText(moreEntities(s ?? "")))).replace(/\s+/g, " ").trim();
/** „SARADNIK ZA PRIKUPLJANJE…“ -> „Saradnik za prikupljanje…“ (samo kad je ceo naslov velikim slovima). */
const calmCaps = (t: string) => (t.length > 12 && !/\p{Ll}/u.test(t) ? t.charAt(0) + t.slice(1).toLowerCase() : t);
const normUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
const normTitle = (t: string) => fold(t).replace(/[^a-z0-9]+/g, " ").trim();
const re = (s: string) => new RegExp(s, "i");
/** Pravi anti-bot zid – ne reCAPTCHA u kontakt formi i ne Cloudflare-ov JSD skript `/cdn-cgi/challenge-platform/scripts/jsd/` (ima ga svaka Ipsos stranica). */
const ANTIBOT = /<title>\s*(Just a moment|Attention Required|Access denied|Pardon Our Interruption)|_cf_chl_opt|cf-chl-widget|captcha-delivery\.com/i;

/** Marker usred taga (`class="block-wysiwyg`) -> pomeri se na njegov `<`, da ostatak taga ne završi u tekstu. */
function tagStart(html: string, i: number): number {
  const lt = html.lastIndexOf("<", i);
  return lt >= 0 && lt > html.lastIndexOf(">", i - 1) ? lt : i;
}

/** Region HTML-a između markera; bez markera (ili kad se ne nađu) <main>/<article>/<body> bez navigacije. */
function region(html: string, start: string | undefined, end: string | undefined, warn: (m: string) => void): string {
  if (start) {
    const s = html.match(re(start));
    if (s && s.index !== undefined) {
      const from = tagStart(html, s.index);
      const e = end ? html.slice(s.index + s[0].length).match(re(end)) : null;
      if (end && !e) warn(`kraj «${end}» nije pronađen`);
      return e && e.index !== undefined ? html.slice(from, tagStart(html, s.index + s[0].length + e.index)) : html.slice(from);
    }
    warn(`početak «${start}» nije pronađen (promenjen HTML?) – uzimam <main>/<body>`);
  }
  const box = html.match(/<main[\s>][\s\S]*?<\/main>/i)?.[0] ?? html.match(/<article[\s>][\s\S]*?<\/article>/i)?.[0] ?? html.match(/<body[\s>][\s\S]*<\/body>/i)?.[0] ?? html;
  return box.replace(/<(nav|header|footer|aside)[\s>][\s\S]*?<\/\1>/gi, "");
}

/** Čist tekst regiona: bez skripti, formi-šuma (select/option), komentara; latinica; prazni redovi sažeti. */
function pageText(part: string): string {
  const html = moreEntities(part)
    .replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|noscript|select|svg|iframe|template)[\s>][\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?(strong|b|em|i|span|a|font|u)(\s[^>]*)?>/gi, "");
  return latinize(htmlToText(html)).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).join("\n")
    .replace(/•\s*\n+\s*/g, "• ").replace(/\n+(?=• )/g, "\n").replace(/\n{3,}/g, "\n\n").trim(); // „•\n\nodgovorni“ -> „• odgovorni“
}

/** Naslov: prvi neprazan <h1>, pa <title> bez sufiksa sajta („… | Ipsos“, „Karijera - MASMI BEOGRAD“). */
function titleOf(html: string): string {
  for (const m of html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)) { const t = clean(m[1]).replace(/:$/, ""); if (t.length >= 4) return t; }
  const t = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  return t.replace(/\s+[|–—-]\s+[^|–—-]{1,40}$/, "").trim();
}

const canonicalOf = (html: string) =>
  decodeEntities(html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i)?.[1] ?? html.match(/<meta[^>]+property="og:url"[^>]+content="([^"]+)"/i)?.[1] ?? "");

/** Linkovi sa stranice-spiska (u regionu listStart/listEnd) koji pogađaju linkPattern. */
function listLinks(l: WatchList, html: string, warn: (m: string) => void): Array<{ url: string; text: string }> {
  const box = region(html, l.listStart, l.listEnd, warn);
  const pat = re(l.linkPattern);
  const out = new Map<string, { url: string; text: string }>();
  for (const m of box.matchAll(/<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: string;
    try { url = new URL(decodeEntities(m[1]), l.listUrl).href.replace(/#.*$/, ""); } catch { continue; }
    if (!pat.test(url) || normUrl(url) === normUrl(l.listUrl) || out.has(normUrl(url))) continue;
    out.set(normUrl(url), { url, text: calmCaps(clean(m[2])) });
  }
  return [...out.values()];
}

/** URL ili null (loš canonical / loša adresa iz config.json ne sme da obori ceo izvor). */
function safeUrl(u: string, base?: string): URL | null {
  try { return new URL(u, base); } catch { return null; }
}
/** decodeURIComponent baca URIError na „%zz“ -> tada ostaje sirov segment. */
const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

/** Stabilan deo id-ja iz linka: poslednji segment putanje („saradnik-za-rad-na-terenu-istrazivac“). */
function slugOf(url: string): string {
  const u = new URL(url);
  const seg = u.pathname.split("/").filter(Boolean).pop() ?? "";
  const s = fold(safeDecode(seg + (u.search ? `-${u.search}` : ""))).replace(/\.(php|html?|aspx?)$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (s || fold(u.host).replace(/[^a-z0-9]+/g, "-")).slice(0, 80);
}

const tagsOf = (p: PageCommon) => [...(p.tags ?? [])];

function buildJob(p: PageCommon, id: string, url: string, html: string, title: string, warn: (m: string) => void): Job | null {
  const text = pageText(region(html, p.contentStart, p.contentEnd, warn));
  if (text.length < 40) { warn("stranica nema teksta oglasa – preskačem"); return null; }
  if (p.mustMatch && !re(p.mustMatch).test(fold(`${title}\n${text}`))) { warn(`tekst više ne sadrži «${p.mustMatch}» – preskačem (proveri konfiguraciju)`); return null; }
  return {
    source: "pagewatch", id, url, title, company: p.company, location: p.location ?? "",
    remote: p.remote === "remote" ? "remote" : "unknown",
    employment: [...(p.employment ?? [])],
    salary: salaryFromDescription(text) ?? undefined,
    postedAt: null,
    description: truncate(text),
    tags: tagsOf(p),
  };
}

/** Viđen oglas: scrape.ts mu samo osvežava lastSeen, pa se ne skida ponovo. */
const stub = (p: PageCommon, id: string, url: string, title: string): Job => ({
  source: "pagewatch", id, url, title, company: p.company, location: p.location ?? "",
  remote: p.remote === "remote" ? "remote" : "unknown", employment: [...(p.employment ?? [])], postedAt: null, tags: tagsOf(p),
});

type Got = { html: string } | { fail: "gone" | "blocked" | "budget" | "error" };

export async function search(ctx: SearchCtx): Promise<Job[]> {
  const o: Opts = { ...DEFAULTS, ...((CONFIG as any).pagewatch ?? {}) };
  const entries = [...(o.pages ?? []), ...(o.extraPages ?? [])].filter((e) => e && e.key && !(o.skip ?? []).includes(e.key));
  let left = o.maxRequests, budgetLogged = false;
  const lastHit = new Map<string, number>();
  const blocked = new Set<string>();

  async function get(url: string, label: string): Promise<Got> {
    const host = safeUrl(url)?.host;
    if (!host) { ctx.log(`[pagewatch] ${label}: loša adresa «${url}» – preskačem, proveri konfiguraciju`); return { fail: "error" }; }
    if (blocked.has(host)) return { fail: "blocked" };
    if (left <= 0) { if (!budgetLogged) ctx.log(`[pagewatch] potrošeno ${o.maxRequests} zahteva – ostatak (${label} …) ide sledeći prolaz`); budgetLogged = true; return { fail: "budget" }; }
    const wait = (lastHit.get(host) ?? 0) + o.delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    left--;
    try {
      const html = await fetchText(url, { tries: o.tries });
      if (ANTIBOT.test(html) && htmlToText(html).length < 1500) { blocked.add(host); ctx.log(`[pagewatch] ${label}: anti-bot/captcha na ${host} – host preskočen do sledećeg prolaza`); return { fail: "blocked" }; }
      return { html };
    } catch (e) {
      const msg = (e as Error).message;
      if (/HTTP (404|410)\b/.test(msg)) { ctx.log(`[pagewatch] ${label}: stranica ne postoji (${msg}) – preskačem, proveri konfiguraciju`); return { fail: "gone" }; }
      if (/429|Cloudflare|captcha|HTTP 403/i.test(msg)) { blocked.add(host); ctx.log(`[pagewatch] ${label}: blokirano (${msg}) – ${host} preskočen do sledećeg prolaza`); return { fail: "blocked" }; }
      ctx.log(`[pagewatch] ${label}: ${msg}`);
      return { fail: "error" };
    } finally {
      lastHit.set(host, Date.now());
    }
  }

  const out: Job[] = [];
  const knownUrls = new Set<string>();
  const knownTitles = new Set<string>();
  const remember = (job: Job, ...urls: string[]) => { for (const u of [job.url, ...urls]) if (u) knownUrls.add(normUrl(u)); knownTitles.add(normTitle(job.title)); };

  // 1) pojedinačne stranice – svaki prolaz (prolaz = potvrda da poziv još stoji)
  for (const p of entries.filter((e): e is WatchPage => "url" in e && !!e.url)) {
    const id = `pagewatch:${p.key}`;
    knownUrls.add(normUrl(p.url));
    if (p.title) knownTitles.add(normTitle(p.title));
    const g = await get(p.url, p.key);
    if ("fail" in g) {
      // nije stiglo (budžet / greška / blokada): viđen ostaje živ, neviđen čeka sledeći prolaz; 404/410 = uklonjen
      if (g.fail !== "gone" && ctx.isSeen(id)) out.push(stub(p, id, p.url, p.title ?? p.key));
      continue;
    }
    const title = p.title?.trim() || calmCaps(titleOf(g.html)) || p.key;
    const job = buildJob(p, id, p.url, g.html, title, (m) => ctx.log(`[pagewatch] ${p.key}: ${m}`));
    if (!job) continue;
    remember(job, canonicalOf(g.html));
    out.push(job);
  }

  // 2) stranice-spiskovi – novi linkovi postaju oglasi
  let details = 0, waiting = 0;
  for (const l of entries.filter((e): e is WatchList => "listUrl" in e && !!e.listUrl)) {
    const g = await get(l.listUrl, `${l.key} (spisak)`);
    if ("fail" in g) continue;
    const warn = (m: string) => ctx.log(`[pagewatch] ${l.key}: ${m}`);
    const links = listLinks(l, g.html, warn);
    let seen = 0, fresh = 0, same = 0;
    for (const link of links) {
      if (knownUrls.has(normUrl(link.url)) || (link.text && knownTitles.has(normTitle(link.text)))) { same++; continue; } // već praćena kao zasebna stranica
      const id = `pagewatch:${l.key}-${slugOf(link.url)}`;
      if (ctx.isSeen(id)) { seen++; out.push(stub(l, id, link.url, link.text || l.key)); continue; }
      if (link.text && titleRejected(link.text)) { out.push({ ...stub(l, id, link.url, link.text), description: link.text }); continue; } // naslov ga ionako obara
      if (details >= o.maxDetails || left <= 0) { waiting++; continue; }
      details++;
      const d = await get(link.url, id);
      if ("fail" in d) continue;
      const canon = canonicalOf(d.html);
      if (canon && knownUrls.has(normUrl(canon))) { same++; ctx.log(`[pagewatch] ${id}: isto što i ${canon} – preskačem`); continue; }
      const title = calmCaps(titleOf(d.html)) || link.text || l.key;
      const cu = canon ? safeUrl(canon, link.url) : null;
      const url = cu && cu.host === new URL(link.url).host ? cu.href : link.url;
      const job = buildJob(l, id, url, d.html, title, (m) => ctx.log(`[pagewatch] ${id}: ${m}`));
      if (!job) continue;
      remember(job, link.url);
      out.push(job);
      fresh++;
    }
    ctx.log(`[pagewatch] ${l.key}: spisak ${links.length} linkova (${fresh} skinuto, ${seen} viđenih, ${same} već praćeno)`);
  }
  ctx.log(`[pagewatch] ukupno ${out.length} oglasa, ${o.maxRequests - left} zahteva${waiting ? `, ${waiting} čeka sledeći prolaz` : ""}`);
  return out;
}
