/**
 * KlikDoPosla.com – javni JSON feed „za AI agente“ (provereno 27.09.2026), bez Cloudflare-a i bez kolačića:
 *   lista:  GET https://www.klikdoposla.com/ai/jobs.json?page=N  -> { total, page, per_page (75, fiksno), has_more, next_page_url, jobs[] }
 *           cela baza aktivnih oglasa (~230) = 4 zahteva; poređano od najnovijeg po published_at; keš na sajtu ~5 min (generated_at = pravo UTC).
 *           Čita se dok kraj strane nije stariji od `since` (1–4 zahteva).
 *           jobs[]: id, slug („91842-sekretarica“), title, url, published_at (ISO, UTC), expires_on, locations[], categories[],
 *           employment_type („Stalni posao“ | „Posao na odredjeno“ | „Honorarni posao“ | „Dopunski posao“ | „Posao preko zadruge“ | „Posao po projektu“),
 *           working_model[] („remote“ | „hybrid“ | „rad_iz_kancelarije“ – skoro uvek prazno), employer_public_name, education, experience[],
 *           salary_public („470 RSD“ | „80.000 RSD“ | „60000 - 90000 RSD“ | „po dogovoru“ – BEZ jedinice: /sat, /dan se vidi samo na sajtu), apply_url,
 *           description_text – SKRAĆEN na ~500 znakova i sa slepljenim naslovima („administrativni radnikAgenciji“).
 *   id:     broj iz URL-a (slug) – kod ~10 % oglasa `id` iz feeda ≠ broj u URL-u, a URL je ono što korisnik vidi.
 *   detalj: GET https://www.klikdoposla.com/oglasi/<broj>-<slug>
 *           pun tekst u <div class="tab-content textOglasa"> (HTML sa <p>/<li>, do <div class="faq-section">; ponegde „&amp;nbsp;“ -> dekodira se 2×);
 *           <script type="application/ld+json"> {"@type":"JobPosting", description (isti tekst, ali pasusi ponekad slepljeni – rezerva), datePosted,
 *           hiringOrganization{name, logo}, educationRequirements, experienceRequirements};
 *           plata sa jedinicom u traci na dnu: <span class="shrink-0 font-medium text-secondary-color">3.500 RSD/dan</span>.
 *           Skida se samo kad je description_text skraćen, oglas nije viđen, nije stariji od `since`, naslov ga ne obara i sajt ne kaže „iz kancelarije“.
 * Filter „posao od kuće“ na sajtu ne filtrira (vraća iste oglase kao „najnoviji“) -> čita se ceo feed, a ocena radi lokalno.
 * Mapiranje: Honorarni / po projektu -> freelance, Dopunski -> part-time, na odredjeno / preko zadruge -> temporary, Stalni -> [] (stalni ≠ puno radno
 * vreme – odlučuje tekst); working_model remote/hybrid/rad_iz_kancelarije -> remote/hybrid/onsite, prazno -> unknown (odlučuje tekst).
 * Obnovljen oglas zadržava stari published_at (sajt piše „Objavljeno pre 5 dana“ za oglas iz 10.2025) -> scrape.ts ga tretira kao star.
 * Red detalja kao u nsz.ts: neviđeni kandidati preko maxDetails se NE vraćaju (skidaju se sledeći put).
 */
import { CONFIG } from "../config.ts";
import { decodeEntities, fetchJson, fetchText, htmlToText, sleep, toIso, truncate } from "../http.ts";
import { parseSalaryText, salaryFromDescription } from "../salary.ts";
import { titleHasCategory, titleRejected } from "../score.ts";
import { latinize } from "../text.ts";
import type { EmploymentKind, Job, RemoteType, Salary, SalaryPeriod, SearchCtx } from "../types.ts";

const BASE = "https://www.klikdoposla.com";
const DEFAULTS = { maxPages: 6, maxDetails: 25 };
const PAGE_SIZE = 75;
const PAUSE_MS = 700;
/** description_text u feedu je odsečen na 500 znakova (sirovo, sa „&amp;“, „\r\n“ i uvlakama; najviše viđeno 502). Meri se SIROVA dužina:
 *  posle dekodiranja i sažimanja razmaka skraćen tekst ume da padne i na ~420 znakova (provereno 27.09.2026: 3 od 115 skraćenih). */
const SNIPPET_CUT = 490;
const REMOTE_HINT = /od ku[cć]e|remote|na daljinu|daljinsk|online|onlajn|home office/i;
const FLEX_HINT = /honorar|nepun|skra[cć]en|part[- ]?time|pola radnog|fleksibil|dopunsk/i;
/** 403/429/captcha = sajt nas je zaustavio -> kraj izvora za ovaj prolaz (ne baca grešku). */
const BLOCKED = /\b(403|429)\b|captcha|challenge|rate limit/i;

interface FeedJob {
  id?: number; slug?: string; title?: string; url?: string; published_at?: string; expires_on?: string;
  locations?: string[]; employment_type?: string; categories?: string[]; working_model?: string[];
  description_text?: string; employer_public_name?: string; salary_public?: string | null; salary_currency?: string | null;
  education?: string | null; experience?: string[] | null;
}

const clean = (s: unknown) => latinize(decodeEntities(htmlToText(String(s ?? "")))).replace(/\s+/g, " ").trim();
/** „radnikAgenciji“ / „je.Prijave“ -> razmak, da regexi sa \b u rules.json pogađaju i skraćeni tekst iz feeda. */
const unglue = (s: string) => s.replace(/([a-zčćžšđ)])([A-ZČĆŽŠĐ])/g, "$1 $2").replace(/([.!?:])([A-ZČĆŽŠĐ])/g, "$1 $2");
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function employmentOf(type: string): EmploymentKind[] {
  const t = type.toLowerCase();
  if (/dopunsk/.test(t)) return ["part-time"];
  if (/honorar|projekt/.test(t)) return ["freelance"];
  if (/odre[dđ]j?en|zadrug/.test(t)) return ["temporary"];
  return []; // „Stalni posao“ = ugovor na neodređeno, ne govori o satima
}

function remoteOf(models: string[]): RemoteType {
  const s = models.join(" ").toLowerCase();
  if (/remote|od_?ku[cć]e|na_daljinu/.test(s)) return "remote";
  if (/hybrid|hibrid|kombinov/.test(s)) return "hybrid";
  if (/kancelarij|office/.test(s)) return "onsite";
  return "unknown";
}

const MODEL_LABEL: Record<RemoteType, string> = { remote: "Rad od kuće", hybrid: "Hibridno", onsite: "Rad iz kancelarije", unknown: "" };

/** „470 RSD“ bez jedinice: dinari < 1.000 su satnica (minimalac ~371 RSD/h), < 10.000 dnevnica, ostalo mesečno; `unit` sa detalja je jači. */
function salaryOf(pub: string | null | undefined, currency: string | null | undefined, unit?: string): Salary | undefined {
  const raw = String(pub ?? "").trim();
  if (!/\d/.test(raw)) return undefined;
  const s = parseSalaryText(/[A-Za-z]{3}/.test(raw) ? raw : `${raw} ${currency || "RSD"}`);
  if (!s || !s.max) return undefined;
  const u = (unit ?? "").toLowerCase();
  const byUnit: SalaryPeriod | null = /^sat/.test(u) ? "hour" : /^dan/.test(u) ? "day" : /^(mes|mj)/.test(u) ? "month" : /^ned/.test(u) ? "week" : null;
  s.period = byUnit ?? s.period ?? (s.currency === "RSD" ? (s.max < 1_000 ? "hour" : s.max < 10_000 ? "day" : "month") : null);
  s.text = unit ? `${raw}/${unit}` : raw;
  return s;
}

function fromFeed(f: FeedJob): { job: Job; truncated: boolean } | null {
  const url = String(f.url ?? "").split("?")[0];
  const num = url.match(/\/oglasi\/(\d+)/)?.[1] ?? String(f.slug ?? "").match(/^(\d+)/)?.[1] ?? (f.id ? String(f.id) : "");
  const title = clean(f.title);
  if (!num || !title) return null;
  const models = (f.working_model ?? []).map(String);
  const remote = remoteOf(models);
  const type = clean(f.employment_type);
  const company = clean(f.employer_public_name);
  const raw = String(f.description_text ?? "");
  // 2× dekodiranje („&amp;nbsp;“), \r\n -> \n, bez razmaka oko prelaza reda
  const snippet = latinize(unglue(decodeEntities(decodeEntities(raw))))
    .replace(/\r\n?/g, "\n").replace(/[ \t ]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return {
    truncated: raw.length >= SNIPPET_CUT,
    job: {
      source: "klikdoposla",
      id: `klikdoposla:${num}`,
      url: url || `${BASE}/oglasi/${f.slug}`,
      title,
      company,
      location: (f.locations ?? []).map(clean).filter(Boolean).join(", "),
      remote,
      employment: employmentOf(type),
      salary: salaryOf(f.salary_public, f.salary_currency) ?? salaryFromDescription(snippet) ?? undefined,
      postedAt: toIso(f.published_at),
      description: truncate(snippet),
      tags: [...new Set([
        type, MODEL_LABEL[remote], ...(f.categories ?? []).map(clean),
        /zadrug/i.test(company) ? company : "",              // „Omladinska zadruga …“ -> rules.json kazna za zadrugu
        f.expires_on ? `rok ${f.expires_on.slice(8, 10)}.${f.expires_on.slice(5, 7)}.${f.expires_on.slice(0, 4)}` : "",
      ].filter(Boolean))],
    },
  };
}

function jobPosting(html: string): any | null {
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { const j = JSON.parse(m[1]); if (j?.["@type"] === "JobPosting") return j; } catch { /* sledeći blok */ }
  }
  return null;
}

/** HTML -> tekst sa dvostrukim dekodiranjem (sajt ponegde čuva „&amp;nbsp;“). */
const textOf = (html: string) =>
  latinize(decodeEntities(htmlToText(html.replace(/\r\n?/g, "\n")))).replace(/[ \t\u00a0]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/** Tekst oglasa: <div class="tab-content textOglasa"> … do FAQ sekcije / „Konkurišite“ (pravi <p>/<li>; JSON-LD description ume da slepi pasuse). */
function bodyText(html: string): string {
  const start = html.indexOf("textOglasa");
  if (start < 0) return "";
  const from = html.indexOf(">", start) + 1;
  const ends = ["faq-section", "Najčešća pitanja", "Konkurisite na oglas", "Slični poslovi"].map((m) => html.indexOf(m, from)).filter((i) => i > from);
  if (!ends.length) return "";
  const to = html.lastIndexOf("<", Math.min(...ends));
  return to > from ? textOf(html.slice(from, to)) : "";
}

/** Pun tekst sa detalja; false = stranica nema ni tekst oglasa ni JobPosting (promenjen HTML) -> ostaje skraćen tekst iz feeda. */
async function enrich(job: Job): Promise<boolean> {
  const html = await fetchText(job.url, { tries: 2 });
  const ld = jobPosting(html);
  const body = bodyText(html);
  const text = body.length >= 50 ? body : textOf(unglue(String(ld?.description ?? "")).replace(/\r\n?/g, "\n").replace(/\n/g, "<br>"));
  if (!ld && text.length < 50) return false;
  const extra = [ld?.educationRequirements && `Stručna sprema: ${clean(ld.educationRequirements)}`, ld?.experienceRequirements && `Iskustvo: ${clean(ld.experienceRequirements)}`];
  if (text.length >= 50) job.description = truncate([text, ...extra].filter(Boolean).join("\n").trim());
  const org = ld?.hiringOrganization ?? {};
  if (org.name && !job.company) job.company = clean(org.name);
  if (typeof org.logo === "string" && org.logo) job.companyLogo = org.logo;
  // plata sa jedinicom (traka „Konkuriši“ na dnu): „3.500 RSD/dan“, „450 RSD/sat“, „Po dogovoru“
  const pay = html.match(/class="shrink-0 font-medium text-secondary-color">\s*([^<]+?)\s*</)?.[1];
  const unit = pay?.match(/[A-Z]{3}\s*\/\s*([a-zčćšžđ]+)/i)?.[1];
  if (unit && job.salary) job.salary = salaryOf(job.salary.text?.replace(/\/.*$/, ""), job.salary.currency, unit) ?? job.salary;
  job.salary ??= salaryFromDescription(text) ?? undefined;
  return true;
}

export async function search(ctx: SearchCtx): Promise<Job[]> {
  const o = { ...DEFAULTS, ...((CONFIG as any).klikdoposla ?? {}) };
  const since = ctx.since.getTime();
  const found = new Map<string, { job: Job; truncated: boolean }>();
  let blocked = false;
  for (let page = 1; page <= o.maxPages; page++) {
    let data: any;
    try { data = await fetchJson(`${BASE}/ai/jobs.json?page=${page}`); }
    catch (e) {
      const m = errMsg(e);
      if (BLOCKED.test(m)) { ctx.log(`[klikdoposla] sajt blokira (${m}) – staje za ovaj prolaz`); blocked = true; break; }
      if (page === 1) throw e;
      ctx.log(`[klikdoposla] page=${page}: ${m} – staje`); break;
    }
    const jobs: FeedJob[] = Array.isArray(data?.jobs) ? data.jobs : [];
    let unseen = 0;
    for (const f of jobs) {
      const r = fromFeed(f);
      if (!r || found.has(r.job.id)) continue;
      found.set(r.job.id, r);
      if (!ctx.isSeen(r.job.id)) unseen++;
    }
    ctx.log(`[klikdoposla] page=${page} results=${jobs.length} neviđenih=${unseen} (ukupno ${data?.total ?? "?"})`);
    if (!data?.has_more || jobs.length < PAGE_SIZE) break;
    // feed je poređan od najnovijeg: kraj strane stariji od baseline-a = dalje nema ništa novo. (Namerno NE staje na strani bez neviđenih:
    // oglasi koji čekaju detalj mogu biti na sledećoj strani, a cela baza su ~4 zahteva.)
    const oldest = Date.parse(String(jobs[jobs.length - 1]?.published_at ?? ""));
    if (oldest < since) break;
    await sleep(PAUSE_MS);
  }

  const out: Job[] = [];
  const queue: Job[] = [];
  for (const { job, truncated } of found.values()) {
    const old = job.postedAt !== null && Date.parse(job.postedAt) < since;
    // bez detalja: viđen (osveži lastSeen), stariji od baseline-a (scrape.ts ga ionako odbacuje), ceo tekst već u feedu,
    // sajt kaže „iz kancelarije“ (tvrdi uslov pada) ili naslov ionako obara ocenu
    if (ctx.isSeen(job.id) || old || !truncated || job.remote === "onsite" || titleRejected(job.title)) out.push(job);
    else queue.push(job);
  }
  const prio = (j: Job) =>
    j.remote === "remote" || j.remote === "hybrid" ? 0
      : j.employment.includes("part-time") || j.employment.includes("freelance") || REMOTE_HINT.test(`${j.title} ${j.description}`) || FLEX_HINT.test(`${j.title} ${j.description}`) ? 1
        : titleHasCategory(j.title) ? 2 : 3;
  queue.sort((a, b) => prio(a) - prio(b));

  let details = 0, fallback = 0, done = 0;
  for (const j of queue) {
    if (blocked || details >= o.maxDetails) break;
    details++;
    try {
      if (!(await enrich(j))) { fallback++; ctx.log(`[klikdoposla] detalj ${j.id}: nema teksta oglasa ni JSON-LD (promenjen HTML?) – ostaje skraćen tekst`); }
      out.push(j); done++;
    } catch (e) {
      const m = errMsg(e);
      if (BLOCKED.test(m)) { ctx.log(`[klikdoposla] detalj ${j.id}: sajt blokira (${m}) – ostali detalji sledeći put`); blocked = true; break; }
      ctx.log(`[klikdoposla] detalj ${j.id}: ${m}`); // ne vraća se -> ostaje neviđen, pokušava se sledeći put
    }
    await sleep(PAUSE_MS);
  }
  ctx.log(`[klikdoposla] ukupno ${found.size} oglasa, ${details} detalja skinuto${fallback ? ` (${fallback} bez teksta)` : ""}, ${queue.length - done} čeka sledeći prolaz`);
  return out;
}
