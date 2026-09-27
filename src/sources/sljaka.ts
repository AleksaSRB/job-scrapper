/**
 * Šljaka.com – WordPress + tema Noo JobMonster, RSS (provereno 27.09.2026). Traži pun Chrome User-Agent (kratak „Mozilla/5.0“ -> HTTP 406);
 * fetchText šalje UA iz config.ts. Sajt je u UTC-u (wp-json: gmt_offset 0) -> pubDate „+0000“ je pravo UTC vreme.
 *   glavni: GET https://sljaka.com/poslovi/feed/?paged=N   standardni WP RSS za post type noo_job: 10 oglasa po strani, najnoviji prvi, ~10 KB;
 *           <item> title, link (https://sljaka.com/poslovi/<slug>/), pubDate, guid (?post_type=noo_job&p=<id>), description (kratko),
 *           content:encoded (pun HTML oglasa), job:company, job:type, job:address, job:closing („decembar 4, 2026“), job:category („Prodaja,Ugostiteljstvo“).
 *   rezerva: GET https://sljaka.com/?feed=job_feed   feed teme: SVI oglasi (~1.100, 6 MB / 1 MB gzip), <job-list-item> umesto <item>, pubDate bez dana
 *           („ 25 Sep 2026 13:31:35 +0000“), pokvareni CDATA krajevi „]>“ (npr. <job_type><![CDATA[Puno radno vreme]></job_type>), nema guid-a.
 *           Parametri WP Job Manager-a (search_keywords, job_types, posts_per_page) se IGNORIŠU (isti 6 MB) -> koristi se samo ako glavni ne radi,
 *           i onda se zadržavaju oglasi sa pubDate >= since.
 *   Postoje i feed-ovi po tipu (/tip-posla/remote/feed/, /tip-posla/polaradnogvremena/feed/) – nisu potrebni, glavni feed ima sve tipove.
 *   id: WP post id iz guid-a (link je ponekad bez sluga: https://sljaka.com/?post_type=noo_job&p=21065); u rezervnom job_feed-u nema guid-a
 *       -> slug iz linka (ako se to ikad desi, ponovljeni oglasi se hvataju kao duplikati po firmi + naslovu).
 * job:type (može više, zarezom): „Puno radno vreme“ -> full-time, „Pola radnog vremena“ -> part-time, „Freelance“ -> freelance,
 *   „Rad po ugovoru o delu / privremenim poslovima“ -> freelance (kao nsz.ts: ugovor o delu = honorarno), „Praksa“ -> internship,
 *   „Rad od kuće (remote)“ -> remote. Ostalo: remote = unknown (odlučuje tekst). Pun tekst je već u feedu -> detalji se ne skidaju.
 * Aktivnost sajta je pala posle 04.2026 (~70 oglasa mesečno) -> u stabilnom radu 1 zahtev po prolazu.
 */
import { CONFIG } from "../config.ts";
import { decodeEntities, fetchText, htmlToText, sleep, toIso, truncate } from "../http.ts";
import { salaryFromDescription } from "../salary.ts";
import { latinize } from "../text.ts";
import type { EmploymentKind, Job, RemoteType, SearchCtx } from "../types.ts";

const BASE = "https://sljaka.com";
const DEFAULTS = { maxPages: 10 };
const PAGE_SIZE = 10;
const PAUSE_MS = 700;
const BLOCKED = /\b(403|406|429)\b|captcha|challenge|rate limit/i;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const clean = (s: string) => latinize(decodeEntities(htmlToText(s))).replace(/\s+/g, " ").trim();
const list = (s: string) => s.split(",").map((x) => clean(x)).filter(Boolean);

/** Stavke oba feed-a (<item> i <job-list-item>). */
function splitItems(xml: string): string[] {
  return xml.split(/<(?:item|job-list-item)(?:\s[^>]*)?>/).slice(1).map((raw) => raw.split(/<\/(?:item|job-list-item)>/)[0]);
}

/** Vrednost taga; CDATA sa ispravnim („]]>“) ili pokvarenim („]>“) krajem; bez CDATA -> XML entiteti se dekodiraju. */
function field(raw: string, ...tags: string[]): string {
  for (const tag of tags) {
    const m = raw.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
    if (!m) continue;
    const v = m[1].trim();
    const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)(?:\]\]>|\]>)?$/);
    const out = (cdata ? cdata[1] : decodeEntities(v)).trim();
    if (out) return out;
  }
  return "";
}

const MONTHS = ["januar", "februar", "mart", "april", "maj", "jun", "jul", "avgust", "septembar", "oktobar", "novembar", "decembar"];
/** job:closing „oktobar 3, 2026“ -> „3.10.2026“ (kao „rok …“ kod ostalih izvora); nepoznat oblik ostaje kakav jeste. */
function closingDate(s: string): string {
  const m = s.toLowerCase().match(/([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  const mi = m ? MONTHS.indexOf(m[1]) : -1;
  return m && mi >= 0 ? `${m[2]}.${mi + 1}.${m[3]}` : s;
}

function employmentOf(types: string[]): EmploymentKind[] {
  const out = new Set<EmploymentKind>();
  for (const t of types.map((x) => x.toLowerCase())) {
    if (/pola radnog|nepun/.test(t)) out.add("part-time");
    else if (/puno radno/.test(t)) out.add("full-time");
    else if (/freelance|honorar|ugovor|privremen/.test(t)) out.add("freelance");
    else if (/praksa/.test(t)) out.add("internship");
  }
  return [...out];
}

/** WP post id iz guid-a / linka („?post_type=noo_job&p=21065“); job_feed nema guid -> slug iz linka. */
function siteId(raw: string, link: string): string {
  const p = `${field(raw, "guid")} ${link}`.match(/[?&]p=(\d+)/)?.[1];
  if (p) return p;
  let slug = link.match(/\/poslovi\/([^/?#]+)/)?.[1] ?? "";
  try { slug = decodeURIComponent(slug); } catch { /* ostaje kodiran */ }
  return slug;
}

function toJob(raw: string): Job | null {
  const link = field(raw, "link").split("#")[0];
  const id = siteId(raw, link);
  const title = clean(field(raw, "title"));
  if (!id || !title || !/^https?:\/\//.test(link)) return null;
  const types = list(field(raw, "job:type", "job_type"));
  const company = clean(field(raw, "job:company", "company"));
  const html = field(raw, "content:encoded") || field(raw, "description");
  const text = latinize(decodeEntities(htmlToText(html.replace(/\r\n?/g, "\n")))).replace(/[ \t\u00a0]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const remote: RemoteType = types.some((t) => /od ku[cć]e|remote/i.test(t)) ? "remote" : "unknown";
  const closing = closingDate(clean(field(raw, "job:closing", "job_closing")));
  return {
    source: "sljaka",
    id: `sljaka:${id}`,
    url: link,
    title,
    company,
    location: list(field(raw, "job:address", "job_address")).join(", "),
    remote,
    employment: employmentOf(types),
    salary: salaryFromDescription(text) ?? undefined,
    postedAt: toIso(field(raw, "pubDate")),
    description: truncate(text),
    tags: [...new Set([
      ...types, ...list(field(raw, "job:category", "job_category")),
      /zadrug/i.test(company) ? company : "",      // „Omladinska zadruga Tim“ -> rules.json kazna (tekst često kaže „zadruzi“)
      closing ? `rok ${closing}` : "",
    ].filter(Boolean))],
  };
}

export async function search(ctx: SearchCtx): Promise<Job[]> {
  const o = { ...DEFAULTS, ...((CONFIG as any).sljaka ?? {}) };
  const since = ctx.since.getTime();
  const found = new Map<string, Job>();
  let fallback = false;
  for (let page = 1; page <= o.maxPages; page++) {
    let xml: string;
    try { xml = await fetchText(page === 1 ? `${BASE}/poslovi/feed/` : `${BASE}/poslovi/feed/?paged=${page}`); }
    catch (e) {
      const m = errMsg(e);
      if (BLOCKED.test(m)) { ctx.log(`[sljaka] sajt blokira (${m}) – staje za ovaj prolaz`); return [...found.values()]; }
      if (page === 1) { ctx.log(`[sljaka] /poslovi/feed/: ${m} – prelazim na ceo job_feed`); fallback = true; break; }
      ctx.log(`[sljaka] page=${page}: ${m} – staje`); break;
    }
    const items = splitItems(xml);
    const jobs = items.map(toJob).filter((j): j is Job => j !== null);
    if (page === 1 && jobs.length === 0) { ctx.log("[sljaka] /poslovi/feed/ bez oglasa (promenjen feed?) – prelazim na ceo job_feed"); fallback = true; break; }
    let unseen = 0;
    for (const j of jobs) if (!found.has(j.id)) { found.set(j.id, j); if (!ctx.isSeen(j.id)) unseen++; }
    const oldest = Math.min(...jobs.map((j) => (j.postedAt ? Date.parse(j.postedAt) : Infinity)));
    ctx.log(`[sljaka] page=${page} results=${items.length}${jobs.length < items.length ? ` (${items.length - jobs.length} bez naslova/linka)` : ""} neviđenih=${unseen}`);
    // najnoviji prvi: strana bez neviđenih ili sa oglasima starijim od baseline-a = dalje nema ništa novo
    if (items.length < PAGE_SIZE || unseen === 0 || oldest < since) break;
    await sleep(PAUSE_MS);
  }
  if (fallback) {
    await sleep(PAUSE_MS);
    let xml: string;
    try { xml = await fetchText(`${BASE}/?feed=job_feed`); }
    catch (e) {
      const m = errMsg(e);
      if (BLOCKED.test(m)) { ctx.log(`[sljaka] sajt blokira (${m}) – staje za ovaj prolaz`); return []; }
      throw e;
    }
    const all = splitItems(xml).map(toJob).filter((j): j is Job => j !== null);
    for (const j of all) if (!found.has(j.id) && (j.postedAt === null || Date.parse(j.postedAt) >= since)) found.set(j.id, j);
    ctx.log(`[sljaka] job_feed: ${all.length} oglasa u feed-u, ${found.size} od ${ctx.since.toISOString().slice(0, 10)}`);
  }
  ctx.log(`[sljaka] ukupno ${found.size} oglasa`);
  return [...found.values()];
}
