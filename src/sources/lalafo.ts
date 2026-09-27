/**
 * Lalafo.rs – oglasnik, kategorija „Tražim saradnike (slobodna radna mesta)“ (provereno 27.09.2026). JSON API, bez kolačića i Cloudflare-a,
 * ali sa OBAVEZNIM zaglavljima `country-id: 11`, `device: pc`, `language: sr_RS`, `Accept: application/json` (bez `device` -> HTTP 417).
 *   lista:  GET https://lalafo.rs/api/search/v3/feed/search?category_id=2109&per-page=50&page=N&sort_by=newest
 *           -> _meta.{totalCount (~174), pageCount (~4), perPage}, items[].{id, title (= prvih ~70 znakova opisa), description (CEO tekst, isti kao u detalju),
 *           city, city_alias, category_id (podkategorija -> CATEGORIES), created_time / updated_time (unix s), price + currency (polje „Plata od“), user.username}
 *           sort_by=newest = created_time opadajuće; obnovljen oglas dobija NOV created_time uz stari id (npr. 69512903 iz 2020. sa datumom 21.09.2026).
 *           U ovom feed-u NEMA `url` (ima ga samo detalj) i params[] je uvek prazan.
 *   link:   https://lalafo.rs/<city_alias>/ads/<bilo-koji-slug>-id-<id>  -> 301 na kanonski link oglasa (slug se pravi iz naslova).
 *   detalj: GET https://lalafo.rs/api/search/v3/feed/details/<id>  -> isto + url + params[] {name, value}: „Radno vreme“ (Fleksibilno radno vreme | Skraćeno radno vreme |
 *           Noćna smena | Rad po smenama | Radni vikend | 5 on 2 …), „Uzrast“ (Svi uzrasti | 18-29 godina | 30-45 godina | od 46 godina),
 *           „Dinamika isplate“ (Po satu | Dnevno | Nedeljno | Mesečno | Po učinku), „Radno iskustvo“ (Bez iskustva | Iskusan | „Less than 1 year experience“ …),
 *           „Beneficije“, „Znanje jezika“. Sve moguće vrednosti: GET /api/catalog/v3/params/filter?category_id=<podkategorija>.
 *   `q=<reč>` je vektorska (labava) pretraga -> ne koristi se; čita se cela kategorija (~4 strane) i ocenjuje lokalno.
 * Polja za rad od kuće nema -> remote samo iz teksta (REMOTE_HINT), inače "unknown" (score.ts čita tekst). Detalj (radi params = radno vreme)
 * se skida samo za neviđene oglase koji uopšte mogu da prođu tvrdi uslov remote (tekst pominje rad od kuće / online / na daljinu) i kojima naslov
 * ne obara ocenu; ako budžet maxDetails nije dovoljan, ostatak se NE vraća (ostaje neviđen za sledeći prolaz).
 * Neviđen oglas stariji od `since` se ne vraća: scrape.ts bi ga ionako odbacio i zauvek označio kao viđen, a obnovljen oglas (nov datum) treba oceniti.
 * Većina „rad od kuće“ oglasa je MLM/prevara (Limes, Avon, Forever Living, Benable, „žene za rad od kuće“) – to kažnjava rules.json; ovde se samo prosleđuje ceo tekst.
 */
import { CONFIG } from "../config.ts";
import { decodeEntities, fetchJson, htmlToText, sleep, toIso, truncate } from "../http.ts";
import { salaryFromDescription } from "../salary.ts";
import { titleHasCategory, titleRejected } from "../score.ts";
import { fold, latinize } from "../text.ts";
import type { EmploymentKind, Job, Salary, SalaryPeriod, SearchCtx } from "../types.ts";

const DEFAULTS = { maxPages: 6, perPage: 50, maxDetails: 30, delayMs: 800 };

const BASE = "https://lalafo.rs";
const API = `${BASE}/api/search/v3/feed`;
const CATEGORY_ID = 2109; // „Tražim saradnike (slobodna radna mesta)“
const HEADERS = { "Accept": "application/json", "country-id": "11", "device": "pc", "language": "sr_RS" };

/** Podkategorije 2109 (GET /api/catalog/v3/categories/tree, 27.09.2026): [grupa, naziv, { podkategorija: naziv }] -> tag „Grupa / Podkategorija“. */
const GROUPS: Array<[number, string, Record<number, string>]> = [
  [2121, "Taksi, logistika i dostava", { 4817: "Taksisti", 4815: "Kuriri", 4816: "Vozači dostave", 4818: "Vozači kamiona", 4819: "Vozači kamiona na duže relacije", 4820: "Bageristi", 4821: "Traktoristi", 4831: "Ostali poslovi" }],
  [4537, "Šivenje", { 4784: "Krojačice", 4785: "Radnice na krojenju", 4786: "Dizajneri za krojeve", 4787: "Operatori tehničke kontrole", 4788: "Dugmadžije", 4789: "Tehničari", 4790: "Radnice na pakovanju", 4791: "Radnici na peglanju", 4792: "Ostali poslovi" }],
  [2125, "Saloni lepote", { 4903: "Eksperti za manikir", 4896: "Frizeri", 4897: "Šminkeri", 4898: "Kozmetičari", 4899: "Eksperti za trepavice", 4904: "Eksperti za obrve", 4900: "Maseri", 4901: "Administratori", 4902: "Ostali poslovi" }],
  [2114, "Hoteli, kafići, restorani", { 4867: "Kuvari", 4868: "Barmeni", 4869: "Šankeri", 4870: "Somelijeri", 4871: "Konobari", 4872: "Radnici za pranje posuđa", 4873: "Čistačice, tehničko osoblje", 4874: "Radnici u upravi, menadžeri", 4875: "Hostese, recepcionari", 4876: "Radnici na postavljanju nargila", 4877: "Sobarice", 4878: "Garderoberi", 4879: "Radnice u perionici", 4880: "Portiri", 2116: "Ostali poslovi" }],
  [2119, "Administrativno osoblje", { 2136: "HR menadžeri, regruteri", 4953: "Ofis menadžeri, sekretarice", 4954: "Asistenti", 2111: "Računovođe", 2131: "Pravnici", 2113: "Bankarstvo i osiguranje", 4955: "Ostali poslovi" }],
  [2118, "Građevinski poslovi", { 2124: "Majstori za razne popravke", 4929: "Vodoinstalateri", 4930: "Fasaderi, radnici na završnim radovima", 4931: "Zidari", 4932: "Proizvođači nameštaja, stolari", 6413: "Drvodelje", 4933: "Monteri", 4934: "Nadzornici, brigadiri", 4935: "Montažeri", 4936: "Zavarivači", 4937: "Inženjeri, projektanti", 4938: "Radnici na betoniranju", 4939: "Rukovodioci specijalizovanih mašina", 4940: "Ostali poslovi" }],
  [2137, "Posao u inostranstvu", { 4914: "Pomoć u kući i čišćenje", 4915: "Saloni lepote", 4916: "Građevinarstvo i proizvodnja", 4917: "Poljoprivreda", 4918: "Hoteli, kafići, restorani", 4919: "Taksi, logistika i dostava", 4920: "Ostali poslovi" }],
  [2127, "Pomoć u kući i čišćenje", { 2128: "Čistačice, tehničko osoblje", 2123: "Čistači ulica i baštovani", 4822: "Dadilje", 4823: "Kućne pomoćnice" }],
  [2117, "IT, računari i mreže", {}],
  [2126, "Medicina i farmacija", {}],
  [2141, "Nekretnine", {}],
  [2122, "Obrazovanje, nauka", {}],
  [2133, "Bezbednost i obezbeđenje", {}],
  [2132, "Prodaja, rad s klijentima", { 4956: "Operateri u kol centru", 4854: "Menadžeri prodaje", 4855: "Radnici na kasi", 4856: "Konsultanti prodaje", 4857: "Promoteri", 4858: "Agenti prodaje", 4859: "Merčandajzeri", 4860: "Ostali poslovi u prodaji" }],
  [4832, "Skladište", { 4833: "Menadžer skladišta", 4834: "Asistent u skladištu", 4835: "Radnici na utovaru", 4836: "Magacioneri", 4837: "Menadžeri za obradu dokumenata", 4838: "Ostali poslovi" }],
  [2142, "Ostali poslovi", {}],
  [3086, "Juniori-administratori", {}],
  [3083, "Putovanja i turističke ture", {}],
];
const CATEGORY = new Map<number, string>();
for (const [gid, group, kids] of GROUPS) {
  CATEGORY.set(gid, group);
  for (const [kid, name] of Object.entries(kids)) CATEGORY.set(Number(kid), `${group} / ${name}`);
}

/**
 * Lokalni oglasnik bez polja za mesto rada: remote samo kad tekst to jasno kaže. Obuhvata sve iz rules.json → remoteText
 * (inače bi oglas koji score.ts prepozna kao remote ostao bez detalja = bez „Radno vreme“) + „Online promotorski posao“, „Rad online“,
 * „individualne online lekcije … radite odakle god želite“, „iz vlastite kuće, stana“ (primeri iz 27.09.2026 koje stari regex nije hvatao).
 */
const REMOTE_HINT = /od ku[cć]e|remote|na daljinu|daljinsk|work(ing)? from home|home[- ]?(office|based)|\bwfh\b|telework|iz (svog|svoje|vlastitog|vlastite|sopstvenog|sopstvene) (doma|ku[cć]|stana)|rad preko interneta|\bonline (\S+ )?(posao|posla|rad(a|om)?\b|anga[zž]man|saradnj|lekcij|nastav|[cč]asov)|\b(rad|radi|radite|posao) (je )?online\b|onlajn (posao|rad)|odakle god (želite|zelite|hoćete|hocete)/i;
/** Greške posle kojih se izvor prekida za ovaj prolaz (anti-bot / rate limit / promenjen API). */
const BLOCKED = /HTTP (403|417|429)|captcha|challenge|nije JSON|forbidden/i;
/** „Radno iskustvo“ ume da bude na engleskom -> prevod (inače engleske reči u tagovima kvare prepoznavanje jezika oglasa). */
const EXPERIENCE_SR: Record<string, string> = {
  "Less than 1 year experience": "manje od 1 godine iskustva", "1-2 years experience": "1-2 godine iskustva",
  "3-5 years experience": "3-5 godina iskustva", "More than 6 years experience": "više od 6 godina iskustva",
};
const EXPERIENCE_EN = new RegExp(Object.keys(EXPERIENCE_SR).join("|"), "g");

const clean = (s: unknown) => latinize(decodeEntities(String(s ?? ""))).replace(/\s+/g, " ").trim();
/** Opis je čist tekst sa \n; HTML se ne očekuje, ali ako se pojavi – skida se. */
function plain(s: unknown): string {
  const raw = latinize(String(s ?? ""));
  const t = /<\/?[a-z][^>]*>/i.test(raw) ? htmlToText(raw) : decodeEntities(raw);
  return t.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}
/** Detalj vraća apsolutan link, stari feed relativan. */
const absUrl = (u: unknown) => { const s = String(u); return /^https?:\/\//.test(s) ? s : `${BASE}${s.startsWith("/") ? "" : "/"}${s}`; };
const slug = (title: string) => fold(title).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 10).join("-") || "oglas";
const valueOf = (params: any[], name: string) => clean(params.find((p) => fold(String(p?.name ?? "")) === fold(name))?.value);
/**
 * `title` (i <h1> na sajtu) = prvih ~70 znakova opisa, često presečeno usred reči („… sa radom – posao od“, „… garderobe Opis: - Online angažman“)
 * -> prvi red opisa kad je to isti početak teksta i nije predugačak; inače naslov iz API-ja.
 */
function titleOf(apiTitle: string, description: string): string {
  const first = clean(description.split("\n")[0]);
  const t = apiTitle || first.slice(0, 90).trim();
  const ok = first.length >= 8 && first.length <= 120 && !/[:\-–]$/.test(first); // „Restoranu … potrebni radnici:“ je samo uvod u spisak
  return ok && (first.startsWith(t) || t.startsWith(first)) ? first : t;
}

/** „Radno vreme“ iz params -> employment (smene tipa „5 on 2“ ne govore o broju sati -> ništa). */
function employmentOf(radnoVreme: string): EmploymentKind[] {
  const t = fold(radnoVreme);
  if (/skracen|nepun|pola radnog|fleksibil|part/.test(t)) return ["part-time"]; // tvrdi uslov je „part-time ILI fleksibilno“
  if (/puno radno|full/.test(t)) return ["full-time"];
  return [];
}

/** „Dinamika isplate“ -> period plate. */
function periodOf(dinamika: string): SalaryPeriod | null {
  const t = fold(dinamika);
  return /po satu/.test(t) ? "hour" : /dnevno/.test(t) ? "day" : /nedeljno/.test(t) ? "week" : /mesecno/.test(t) ? "month" : null;
}

/** Razuman raspon „Plata od“ u € po periodu – polje često sadrži smeće (1 din, 24 din, cena proizvoda iz pogrešne kategorije). */
const EUR_RANGE: Record<"hour" | "day" | "week" | "month", [number, number]> = { hour: [2, 60], day: [10, 400], week: [50, 2_500], month: [150, 10_000] };
function priceSalary(it: any, period: SalaryPeriod | null): Salary | undefined {
  const n = Number(it?.price ?? 0);
  const currency = String(it?.currency ?? "").toUpperCase();
  const rate = CONFIG.fx[currency];
  if (!(n > 0) || !rate) return undefined;
  const [lo, hi] = EUR_RANGE[period === "year" || period === null ? "month" : period];
  const eur = n * rate;
  if (eur < lo || eur > hi) return undefined;
  const unit = currency === "RSD" ? "din" : currency === "EUR" ? "€" : currency;
  return { min: n, max: null, currency, period, text: `od ${n.toLocaleString("sr-RS")} ${unit}${period === "hour" ? " po satu" : ""}` };
}

function fromItem(it: any): Job | null {
  const id = Number(it?.id);
  const description = plain(it?.description);
  const title = titleOf(clean(it?.title), description);
  if (!id || !title) return null;
  const alias = String(it?.city_alias ?? "").replace(/[^a-z0-9-]/gi, "") || "serbia";
  const category = CATEGORY.get(Number(it?.category_id));
  return {
    source: "lalafo",
    id: `lalafo:${id}`,
    url: it?.url ? absUrl(it.url) : `${BASE}/${alias}/ads/${slug(title)}-id-${id}`,
    title,
    company: clean(it?.user?.username),
    location: clean(it?.city),
    remote: REMOTE_HINT.test(`${title}\n${description}`) ? "remote" : "unknown",
    employment: [],
    salary: priceSalary(it, null) ?? salaryFromDescription(description) ?? undefined,
    postedAt: toIso(Number(it?.created_time) || null) ?? toIso(Number(it?.updated_time) || null),
    description: description ? truncate(description) : undefined,
    tags: category ? [category] : [],
  };
}

/** Detalj: kanonski link + params (radno vreme, uzrast, dinamika isplate…) -> employment, plata, tagovi. */
function enrich(job: Job, d: any): void {
  if (!d || Number(d.id) !== Number(job.id.split(":")[1])) throw new Error("neočekivan odgovor detalja");
  const params: any[] = Array.isArray(d.params) ? d.params : [];
  if (d.url) job.url = absUrl(d.url);
  const fromDetail = plain(d.description);
  const description = fromDetail.length >= (job.description?.length ?? 0) ? fromDetail : job.description ?? ""; // prazan opis u detalju ne briše opis iz liste
  const title = titleOf(clean(d.title), description);
  if (title) job.title = title;
  if (description) job.description = truncate(description);
  const radnoVreme = valueOf(params, "Radno vreme");
  job.employment = employmentOf(radnoVreme);
  const text = `${job.title}\n${description}`;
  job.remote = REMOTE_HINT.test(text) ? "remote" : "unknown";
  job.salary = priceSalary(d, periodOf(valueOf(params, "Dinamika isplate"))) ?? salaryFromDescription(description) ?? undefined;
  const paramTags = params
    .map((p) => { const name = clean(p?.name), value = clean(p?.value).replace(EXPERIENCE_EN, (m) => EXPERIENCE_SR[m] ?? m); return name && value ? `${name}: ${value}` : ""; })
    .filter(Boolean);
  job.tags = [...new Set([...job.tags, ...paramTags])];
}

export async function search(ctx: SearchCtx): Promise<Job[]> {
  const o = { ...DEFAULTS, ...((CONFIG as any).lalafo ?? {}) };
  let last = 0;
  /** Svi zahtevi ka lalafo.rs idu kroz ovo -> najmanje delayMs između dva zahteva. */
  const get = async (url: string): Promise<any> => {
    const wait = last + o.delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    try { return await fetchJson(url, { headers: HEADERS }); } finally { last = Date.now(); }
  };

  const found = new Map<string, Job>();
  let pageCount = 1;
  for (let page = 1; page <= Math.min(pageCount, o.maxPages); page++) {
    let data: any;
    try {
      data = await get(`${API}/search?category_id=${CATEGORY_ID}&per-page=${o.perPage}&page=${page}&sort_by=newest`);
    } catch (e) {
      const msg = (e as Error).message;
      if (page === 1 && !BLOCKED.test(msg)) throw e;
      ctx.log(`[lalafo] strana ${page}: ${msg} – prekidam za ovaj prolaz`);
      break;
    }
    if (!Array.isArray(data?.items)) { ctx.log(`[lalafo] strana ${page}: neočekivan odgovor (anti-bot ili promenjen API) – prekidam`); break; }
    pageCount = Number(data._meta?.pageCount ?? 1);
    let added = 0;
    for (const it of data.items) { const j = fromItem(it); if (j && !found.has(j.id)) { found.set(j.id, j); added++; } }
    ctx.log(`[lalafo] page=${page}/${pageCount} results=${data.items.length} novih_u_listi=${added} (ukupno ${data._meta?.totalCount ?? "?"})`);
    if (data.items.length < o.perPage || added === 0) break;
  }

  const since = ctx.since.getTime();
  const out: Job[] = [];
  const queue: Job[] = [];
  let old = 0;
  for (const j of found.values()) {
    if (ctx.isSeen(j.id)) { out.push(j); continue; }                          // osveži lastSeen
    if (j.postedAt && new Date(j.postedAt).getTime() < since) { old++; continue; } // ostaje neviđen: ako se obnovi, dobija nov datum
    if (j.remote !== "remote" || titleRejected(j.title)) { out.push(j); continue; } // ne može da prođe remote ili ga naslov obara -> bez detalja
    queue.push(j);
  }
  queue.sort((a, b) => Number(titleHasCategory(b.title)) - Number(titleHasCategory(a.title))); // stabilno: ciljana kategorija prva, pa najnoviji

  let details = 0;
  for (const j of queue) {
    if (details >= o.maxDetails) break; // ostali ostaju neviđeni -> sledeći prolaz
    details++;
    try {
      enrich(j, await get(`${API}/details/${j.id.split(":")[1]}`));
      out.push(j);
    } catch (e) {
      const msg = (e as Error).message;
      if (/HTTP 404/.test(msg)) { out.push(j); continue; } // oglas obrisan u međuvremenu -> ocenjuje se iz liste
      ctx.log(`[lalafo] detalj ${j.id}: ${msg}`);
      if (BLOCKED.test(msg)) { ctx.log("[lalafo] blokirano – prekidam detalje za ovaj prolaz"); break; }
    }
  }
  ctx.log(`[lalafo] ukupno ${found.size} oglasa, ${details} detalja skinuto, ${Math.max(0, queue.length - details)} čeka sledeći prolaz, ${old} neviđenih starijih od ${ctx.since.toISOString().slice(0, 10)} preskočeno`);
  return out;
}
