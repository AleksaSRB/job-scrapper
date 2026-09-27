/**
 * OLX.ba (bivši PIK.ba) – kategorija Poslovi, Bosna i Hercegovina, oglasi na BHS (provereno 27.09.2026). Javni JSON API iza Cloudflare-a, bez kolačića i ključa;
 * zaglavlja `x-ratelimit-limit: 60` / `x-ratelimit-remaining` -> najviše 60 zahteva u minutu, zato delayMs ≥ 1100.
 *   lista:  GET https://olx.ba/api/search?category_id=2286&page=N&per_page=40&sort_by=date&sort_order=desc
 *           -> meta.{total (~306), last_page, per_page}, data[].{id, title, date (unix s = poslednje objavljivanje/obnavljanje), category_id, city_id, sponsored},
 *           aggregations.categories[0].sub_categories[].{id, name} (nazivi podkategorija: 2310 Ostali poslovi, 2312 Prodaja/Komercijala …).
 *           BEZ sort_by idu prvo plaćeni (sponsored 2, pa 1), pa ostali; sa sort_by=date&sort_order=desc je lista strogo po `date`. per_page=100 radi, ali sajt koristi 40.
 *           `q=<reč>` pretražuje samo naslov, a filter po atributima (attr=…) se ignoriše -> čita se cela kategorija i ocenjuje lokalno.
 *   gradovi: GET https://olx.ba/api/cities -> data[] (entitet) .cantons[] .cities[].{id, name} (138 gradova) -> city_id iz liste.
 *   detalj: GET https://olx.ba/api/listings/<id> -> title, date, created_at (prvo objavljivanje), additional.description (HTML), user.{username, type ("user"|"shop"), avatar},
 *           cities[].name, country[].name (posao u inostranstvu), category.name, attributes[].{attr_code, value}:
 *           vrsta-zaposlenja (Stalni radni odnos | Rad na određeno vrijeme | Honorarni posao | Sezonski posao | Pripravnički rad | Volontiranje),
 *           radno-vrijeme (Puno radno vrijeme | Pola radnog vremena | Fleksibilno), prethodno-radno-iskustvo (Nije potrebno | 1 godina | … | Preko 5 godina),
 *           mjesecna-neto-plata (Po dogovoru | 1000 do 1500 KM | … | 3000 KM i više; KM = BAM), posao-u-inostranstvu / javni-drzavni-konkurs (true|false).
 *   web:    https://olx.ba/artikal/<id>
 * Polja za rad od kuće nema -> remote samo iz teksta (REMOTE_HINT), inače "unknown" (score.ts čita tekst). Lista ima samo naslov, pa detalj treba svakom
 * neviđenom oglasu kome naslov ne obara ocenu: najviše maxDetails po prolazu, a oni koji nisu stigli se NE vraćaju (ostaju neviđeni za sledeći prolaz).
 * Oglasi se često obnavljaju (nov `date`, isti id) -> strane se čitaju do `since` (ne do „prve viđene“ strane – iza obnovljenih oglasa čekaju neobrađeni),
 * a neviđen oglas stariji od `since` se ne vraća: scrape.ts bi ga ionako odbacio i zauvek označio kao viđen, a obnovljen oglas treba oceniti.
 * Remote oglasi su skoro svi „online posao od kuće“ prodaja/MLM – to kažnjava rules.json; ovde se samo prosleđuje ceo tekst.
 */
import { CONFIG } from "../config.ts";
import { decodeEntities, fetchJson, htmlToText, sleep, toIso, truncate } from "../http.ts";
import { parseSalaryText, salaryFromDescription } from "../salary.ts";
import { titleHasCategory, titleRejected } from "../score.ts";
import { fold, latinize } from "../text.ts";
import type { EmploymentKind, Job, Salary, SearchCtx } from "../types.ts";

const DEFAULTS = { maxPages: 10, perPage: 40, maxDetails: 40, delayMs: 1100 };

const BASE = "https://olx.ba";
const API = `${BASE}/api`;
const CATEGORY_ID = 2286; // Poslovi
const HEADERS = { "Accept": "application/json" };

/**
 * Lokalni oglasnik bez polja za mesto rada: remote samo kad tekst to jasno kaže. Obuhvata sve iz rules.json → remoteText +
 * „Posao se radi putem računala iz vlastite kuće, stana“ (SMS chat operater, 27.09.2026), „Online promotorski posao“, „Rad online“.
 */
const REMOTE_HINT = /od ku[cć]e|remote|na daljinu|daljinsk|work(ing)? from home|home[- ]?(office|based)|\bwfh\b|telework|iz (svog|svoje|vlastitog|vlastite|sopstvenog|sopstvene) (doma|ku[cć]|stana)|rad preko interneta|\bonline (\S+ )?(posao|posla|rad(a|om)?\b|anga[zž]man|saradnj|lekcij|nastav|[cč]asov)|\b(rad|radi|radite|posao) (je )?online\b|onlajn (posao|rad)|odakle god (želite|zelite|hoćete|hocete)/i;
/** Greške posle kojih se izvor prekida za ovaj prolaz (anti-bot / rate limit / promenjen API). */
const BLOCKED = /HTTP (403|429)|captcha|challenge|nije JSON|forbidden|rate limit/i;

const clean = (s: unknown) => latinize(decodeEntities(String(s ?? ""))).replace(/\s+/g, " ").trim();
const idOf = (job: Job) => job.id.split(":")[1];

function employmentOf(vrsta: string, radnoVrijeme: string): EmploymentKind[] {
  const v = fold(vrsta), rv = fold(radnoVrijeme);
  let out: EmploymentKind[] = [];
  if (/pola radnog|nepun|skracen|fleksibil/.test(rv)) out = ["part-time"]; // tvrdi uslov je „part-time ILI fleksibilno“
  else if (/puno radno/.test(rv)) out = ["full-time"];
  // kao halooglasi: honorarno bez nepunog radnog vremena = honorar (ne full-time)
  if (/honorar/.test(v) && !out.includes("part-time")) out = [...out.filter((e) => e !== "full-time"), "freelance"];
  if (/odredjeno|sezon/.test(v)) out.push("temporary");
  if (/pripravni/.test(v)) out.push("internship");
  return out; // „Volontiranje“ ostaje u tagovima (rules.json ga kažnjava)
}

/** „1000 do 1500 KM“ | „3000 KM i više“ -> mesečna neto plata u BAM; „Po dogovoru“ -> undefined. */
function plataOf(value: string): Salary | undefined {
  const s = parseSalaryText(value);
  if (!s || !s.max) return undefined;
  return { ...s, currency: s.currency ?? "BAM", period: "month", text: `${value} neto mesečno` };
}

async function loadCities(get: (url: string) => Promise<any>): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const data = await get(`${API}/cities`);
  for (const entity of data?.data ?? []) for (const canton of entity?.cantons ?? []) for (const c of canton?.cities ?? []) if (c?.id && c?.name) out.set(Number(c.id), clean(c.name));
  return out;
}

function fromItem(it: any, cities: Map<number, string>, categories: Map<number, string>): Job | null {
  const id = Number(it?.id);
  const title = clean(it?.title);
  if (!id || !title) return null;
  const city = cities.get(Number(it?.city_id));
  const category = categories.get(Number(it?.category_id));
  return {
    source: "olxba",
    id: `olxba:${id}`,
    url: `${BASE}/artikal/${id}`,
    title,
    company: "",
    location: city ? `${city}, BiH` : "",
    remote: REMOTE_HINT.test(title) ? "remote" : "unknown",
    employment: [],
    postedAt: toIso(Number(it?.date) || null),
    tags: category ? [category] : [],
  };
}

/** Detalj: ceo opis (HTML -> tekst), atributi (vrsta zaposlenja, radno vrijeme, plata…), grad, oglašivač. */
function enrich(job: Job, d: any): void {
  if (!d || Number(d.id) !== Number(idOf(job))) throw new Error("neočekivan odgovor detalja");
  const attrs = new Map<string, string>();
  for (const a of Array.isArray(d.attributes) ? d.attributes : []) if (a?.attr_code) attrs.set(String(a.attr_code), clean(a.value));
  const attr = (code: string) => attrs.get(code) ?? "";
  const title = clean(d.title);
  if (title) job.title = title;
  const text = latinize(htmlToText(String(d.additional?.description ?? d.short_description ?? "")));
  if (text) job.description = truncate(text);
  job.postedAt = toIso(Number(d.date) || null) ?? job.postedAt;
  const vrsta = attr("vrsta-zaposlenja"), radnoVrijeme = attr("radno-vrijeme"), iskustvo = attr("prethodno-radno-iskustvo");
  const abroad = attr("posao-u-inostranstvu") === "true";
  job.employment = employmentOf(vrsta, radnoVrijeme);
  job.remote = REMOTE_HINT.test(`${job.title}\n${text}`) ? "remote" : "unknown";
  job.salary = plataOf(attr("mjesecna-neto-plata")) ?? salaryFromDescription(text) ?? undefined;
  const user = d.user ?? {};
  job.company = clean(user.username);
  if (user.type === "shop" && /^https?:\/\//.test(String(user.avatar ?? ""))) job.companyLogo = String(user.avatar);
  const cities = (Array.isArray(d.cities) ? d.cities : []).map((c: any) => clean(c?.name)).filter(Boolean);
  const countries = (Array.isArray(d.country) ? d.country : []).map((c: any) => clean(c?.name)).filter(Boolean);
  if (abroad && countries.length) job.location = countries.join(", ");
  else if (cities.length) job.location = `${cities.join(", ")}, BiH`;
  else if (countries.length) job.location = countries.join(", ");
  const category = clean(d.category?.name);
  job.tags = [...new Set([
    ...job.tags, category, vrsta, radnoVrijeme, iskustvo && `Radno iskustvo: ${iskustvo}`,
    abroad ? "Posao u inostranstvu" : "", attr("javni-drzavni-konkurs") === "true" ? "Javni konkurs" : "",
  ].filter(Boolean))];
}

export async function search(ctx: SearchCtx): Promise<Job[]> {
  const o = { ...DEFAULTS, ...((CONFIG as any).olxba ?? {}) };
  let last = 0;
  /** Svi zahtevi ka olx.ba idu kroz ovo -> najmanje delayMs između dva zahteva (limit 60/min). */
  const get = async (url: string): Promise<any> => {
    const wait = last + o.delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    try { return await fetchJson(url, { headers: HEADERS }); } finally { last = Date.now(); }
  };

  let cities = new Map<number, string>();
  try { cities = await loadCities(get); } catch (e) {
    const msg = (e as Error).message;
    ctx.log(`[olxba] gradovi: ${msg}`);
    if (BLOCKED.test(msg)) { ctx.log("[olxba] blokirano – prekidam za ovaj prolaz"); return []; }
  }

  const since = ctx.since.getTime();
  const categories = new Map<number, string>();
  const found = new Map<string, Job>();
  let lastPage = 1;
  for (let page = 1; page <= Math.min(lastPage, o.maxPages); page++) {
    let data: any;
    try {
      data = await get(`${API}/search?category_id=${CATEGORY_ID}&page=${page}&per_page=${o.perPage}&sort_by=date&sort_order=desc`);
    } catch (e) {
      const msg = (e as Error).message;
      if (page === 1 && !BLOCKED.test(msg)) throw e;
      ctx.log(`[olxba] strana ${page}: ${msg} – prekidam za ovaj prolaz`);
      break;
    }
    if (!Array.isArray(data?.data)) { ctx.log(`[olxba] strana ${page}: neočekivan odgovor (anti-bot ili promenjen API) – prekidam`); break; }
    lastPage = Number(data.meta?.last_page ?? 1);
    for (const c of data.aggregations?.categories?.[0]?.sub_categories ?? []) if (c?.id && c?.name) categories.set(Number(c.id), clean(c.name));
    const items: any[] = data.data;
    let added = 0, unseen = 0;
    for (const it of items) {
      const j = fromItem(it, cities, categories);
      if (!j || found.has(j.id)) continue;
      found.set(j.id, j); added++;
      if (!ctx.isSeen(j.id)) unseen++;
    }
    const oldest = toIso(Number(items.at(-1)?.date) || null);
    ctx.log(`[olxba] page=${page}/${lastPage} results=${items.length} novih_u_listi=${added} neviđenih=${unseen} (ukupno ${data.meta?.total ?? "?"}, najstariji ${oldest?.slice(0, 10) ?? "?"})`);
    if (items.length < o.perPage || added === 0 || (oldest && new Date(oldest).getTime() < since)) break;
  }

  const out: Job[] = [];
  const queue: Job[] = [];
  let old = 0;
  for (const j of found.values()) {
    if (ctx.isSeen(j.id)) { out.push(j); continue; }                          // osveži lastSeen
    if (j.postedAt && new Date(j.postedAt).getTime() < since) { old++; continue; } // ostaje neviđen: ako se obnovi, dobija nov datum
    if (titleRejected(j.title)) { out.push(j); continue; }                    // naslov ga ionako obara -> bez detalja
    queue.push(j);
  }
  // prvo remote u naslovu, pa ciljana kategorija, pa ostali (unutar grupe najnoviji prvi – sort je stabilan)
  const prio = (j: Job) => (j.remote === "remote" ? 0 : titleHasCategory(j.title) ? 1 : 2);
  queue.sort((a, b) => prio(a) - prio(b));

  let details = 0;
  for (const j of queue) {
    if (details >= o.maxDetails) break; // ostali ostaju neviđeni -> sledeći prolaz
    details++;
    try {
      enrich(j, await get(`${API}/listings/${idOf(j)}`));
      out.push(j);
    } catch (e) {
      const msg = (e as Error).message;
      if (/HTTP 404/.test(msg)) { out.push(j); continue; } // oglas obrisan u međuvremenu -> ocenjuje se iz liste (da se ne pokušava svaki put)
      ctx.log(`[olxba] detalj ${j.id}: ${msg}`);
      if (BLOCKED.test(msg)) { ctx.log("[olxba] blokirano – prekidam detalje za ovaj prolaz"); break; }
    }
  }
  ctx.log(`[olxba] ukupno ${found.size} oglasa, ${details} detalja skinuto, ${Math.max(0, queue.length - details)} čeka sledeći prolaz, ${old} neviđenih starijih od ${ctx.since.toISOString().slice(0, 10)} preskočeno`);
  return out;
}
