/**
 * OglasZaPosao.rs – WordPress bez Cloudflare-a koji preuzima oglase sa Jooble-a (~98 % oglasa) -> vidimo i oglase koji su samo na Jooble-u
 * (rs.jooble.org je iza Cloudflare-a i NE čita se). Provereno 27.09.2026; sajt je u UTC-u (wp-json: gmt_offset 0).
 *   lista:  GET https://oglaszaposao.rs/wp-json/wp/v2/oglas?per_page=100&page=N&_fields=id,date_gmt,link,title,content,class_list&search=<reč>&after=<ISO>
 *           (zaglavlja X-WP-Total / X-WP-TotalPages; fetchText ih ne vraća -> kraj = manje od 100 stavki). `search` je WP LIKE %reč% po naslovu i
 *           tekstu, više reči = SVE moraju da se pojave (bilo gde, ne kao fraza), bez obzira na kvačice („od kuce“ = „od kuće“) -> „rad od kuće“ je
 *           podskup „od kuće“ i ne traži se posebno. `after` filtrira po datumu na serveru (30 dana: 0–18 pogodaka po reči) = kasniji od since i
 *           danas − windowDays (baseline je fiksan, pa bi se inače svaki put čitala sve veća arhiva). 10 reči × 1 strana = 10 zahteva po prolazu.
 *           Reči pokrivaju remote obrasce iz rules.json (od kuće, na daljinu, remote, home office); „work from home“ i „daljinsk“ 27.09.2026 nisu
 *           dale ništa novo (60 dana), a „home office“ jeste. Provereno nad celim 22-dnevnim prozorom (665 oglasa): nijedan remote oglas nije promakao.
 *           Radni Model (npr. „Remote“ kod direktnih oglasa, ~14 mesečno) postoji samo na detalju, ne u API-ju (acf: []).
 *           content.rendered = samo ~300 znakova Jooble isečka („…“) + <a href="https://rs.jooble.org/jdp/<id>">Pogledajte originalni oglas</a>
 *           (link se izbacuje iz teksta da ne doda srpsku reč „oglas“ engleskom oglasu; ide na kraj opisa kao „Izvor: …“).
 *           class_list: kat_poslova-* (NEPOUZDANO: „Vozač C i E“ -> predavač stranih jezika), lokacija-<slug>, tip_zaposlenja-<slug>
 *           (podrazumevano „puno-radno-vreme“ i kad Jooble oglas kaže nepuno -> NE mapira se u full-time; honorarno -> freelance,
 *           praksa/placena-praksa/pripravnik -> internship, sezonski/ugovor-na-odredeno -> temporary, volonterski -> samo tag).
 *   detalj: GET <link> (https://oglaszaposao.rs/oglas/<slug>/) – ceo tekst ni tu NE postoji (isti isečak), ali ima poslodavca (za spajanje duplikata
 *           sa Infostud/NSZ oglasima po firmi + naslovu): <div class="ozp-job-company-info"> … <h2>Firma</h2>, kartice
 *           <span class="ozp-info-label">Plata | Lokacija | Radni Model | Tip Zaposlenja | Radno Vreme | Rok za Prijavu</span> + ozp-info-value / ozp-info-sub.
 *           „Radni Model: Kancelarijski“ je podrazumevan (i uz „posao od kuće“ u tekstu) -> uzima se samo hibrid/remote.
 *           Skida se samo za kandidate (naslov ne obara ocenu + tekst pominje od kuće/remote + nepuno/honorarno/fleksibilno), najviše maxDetails po prolazu;
 *           kandidati preko limita se NE vraćaju (skidaju se sledeći put, kao u nsz.ts).
 */
import { CONFIG } from "../config.ts";
import { decodeEntities, fetchJson, fetchText, htmlToText, sleep, toIso, truncate } from "../http.ts";
import { parseSalaryText, salaryFromDescription } from "../salary.ts";
import { titleRejected } from "../score.ts";
import { latinize } from "../text.ts";
import type { EmploymentKind, Job, RemoteType, SearchCtx } from "../types.ts";

const BASE = "https://oglaszaposao.rs";
const DEFAULTS = {
  queries: ["od kuće", "na daljinu", "remote", "home office", "online", "honorar", "nepuno", "part time", "pola radnog", "fleksibiln"],
  pagesPerQuery: 2,
  maxDetails: 15,
  windowDays: 21, // `after` = kasniji od (since, danas − windowDays): baseline je fiksan, pa bi se bez ovoga svaki put čitala cela arhiva od baseline-a
};
const PER_PAGE = 100;
const PAUSE_MS = 700;
const BLOCKED = /\b(403|429)\b|captcha|challenge|rate limit/i;
/** Nadskup rules.json remoteText / partTime (kandidat za detalj = tekst ima šanse na oba tvrda uslova). */
const REMOTE_HINT = /od ku[cć]e|\bremote\b|na daljinu|daljinsk|home[- ]?(office|based)|work(ing)? from home|\bwfh\b|telework|\bonline\b|onlajn/i;
const FLEX_HINT = /honorar|nepun|skra[cć]en|part[- ]?time|pola radnog|polovin|fleksibil|flexible|freelance|frilens|contractor|hourly|dodatn\w* (posao|zarad|prihod)|povremen|satnic|\b\d{1,2} ?(h|sat[ai]?|hours|hrs)\b/i;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const clean = (s: unknown) => latinize(decodeEntities(htmlToText(String(s ?? "")))).replace(/\s+/g, " ").trim();
const textOf = (html: string) => latinize(decodeEntities(htmlToText(html))).replace(/[ \t\u00a0]+/g, " ").replace(/\n /g, "\n").replace(/(…\s*){2,}/g, "… ").trim();
const ORIGINAL_LINK = /<a\s[^>]*href="([^"]+)"[^>]*>\s*Pogledajte originalni oglas\s*<\/a>/i;
const titleCase = (slug: string) => slug.split("-").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

const TIP: Record<string, { label: string; employment?: EmploymentKind }> = {
  "honorarno": { label: "Honorarno", employment: "freelance" },
  "praksa": { label: "Praksa", employment: "internship" },
  "placena-praksa": { label: "Plaćena praksa", employment: "internship" },
  "pripravnik": { label: "Pripravnik", employment: "internship" },
  "sezonski": { label: "Sezonski", employment: "temporary" },
  "ugovor-na-odredeno": { label: "Ugovor na određeno", employment: "temporary" },
  "volonterski": { label: "Volonterski" },                // rules.json kažnjava „volonter“
  "ugovor-na-neodredeno": { label: "Ugovor na neodređeno" }, // ništa o satima
  // "puno-radno-vreme": podrazumevana vrednost uvoza sa Jooble-a -> ignoriše se
};

function fromPost(p: any): Job | null {
  const id = Number(p?.id);
  const title = clean(p?.title?.rendered);
  const link = String(p?.link ?? "");
  if (!id || !title || !link) return null;
  const html = String(p?.content?.rendered ?? "");
  const original = decodeEntities(html.match(ORIGINAL_LINK)?.[1] ?? "");
  const text = textOf(html.replace(/<p>\s*<a\s[^>]*>\s*Pogledajte originalni oglas\s*<\/a>\s*<\/p>/gi, "").replace(ORIGINAL_LINK, ""));
  const classes: string[] = Array.isArray(p?.class_list) ? p.class_list.map(String) : [];
  const tips = classes.filter((c) => c.startsWith("tip_zaposlenja-")).map((c) => TIP[c.slice("tip_zaposlenja-".length)]).filter(Boolean);
  const location = classes.filter((c) => c.startsWith("lokacija-")).map((c) => titleCase(c.slice("lokacija-".length))).join(", ");
  return {
    source: "oglaszaposao",
    id: `oglaszaposao:${id}`,
    url: link,
    title,
    company: "",
    location,
    remote: "unknown",
    employment: [...new Set(tips.map((t) => t.employment).filter((e): e is EmploymentKind => !!e))],
    salary: salaryFromDescription(text) ?? undefined,
    postedAt: toIso(p?.date_gmt ? `${p.date_gmt}Z` : null),
    description: truncate(original ? `${text}\n\nIzvor: ${original}` : text),
    tags: [...new Set([...tips.map((t) => t.label), /jooble\./i.test(original) ? "Jooble" : ""].filter(Boolean))],
  };
}

/** Kartice sa detalja: { plata: "1.000 - 1.200 EUR Neto", lokacija: "Novi Beograd, Beograd", "radni model": "Kancelarijski", … } (vrednost + podnaslov). */
function infoCards(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<span class="ozp-info-label">([\s\S]*?)<\/span>([\s\S]*?)<\/div>/g)) {
    const label = clean(m[1]).toLowerCase();
    const val = clean(m[2].match(/class="ozp-info-value[^"]*">([\s\S]*?)<\/(?:span|a)>/)?.[1]);
    const sub = clean(m[2].match(/class="ozp-info-sub">([\s\S]*?)<\/span>/)?.[1]);
    out[label] = sub && sub !== val ? `${val}${label === "lokacija" ? "," : ""} ${sub}` : val;
  }
  return out;
}

async function enrich(job: Job): Promise<void> {
  const html = await fetchText(job.url, { tries: 2 });
  const company = clean(html.match(/<div class="ozp-job-company-info">[\s\S]*?<h2>([\s\S]*?)<\/h2>/)?.[1]);
  if (company) job.company = company;
  const logo = html.match(/<div class="ozp-job-company-info">\s*<img src="([^"]+)"/)?.[1];
  if (logo && !/gravatar\.com/.test(logo)) job.companyLogo = decodeEntities(logo);
  const card = infoCards(html);
  if (card["lokacija"]) job.location = card["lokacija"];
  const model = card["radni model"] ?? "";
  const remote: RemoteType = /ku[cć]|remote|daljin/i.test(model) ? "remote" : /hibrid|hybrid|kombin/i.test(model) ? "hybrid" : "unknown";
  if (remote !== "unknown") job.remote = remote;
  const pay = card["plata"] ?? "";
  if (/\d/.test(pay)) job.salary = parseSalaryText(pay) ?? job.salary;
  // direktni oglasi (bez Jooble-a) imaju i „Radno Vreme: 8-16h“; opis na stranici je isti isečak, osim kod direktnih oglasa gde je pun tekst
  const start = html.indexOf("Opis Posla</h3>");
  const end = start < 0 ? -1 : html.indexOf("ozp-apply-section", start);
  const body = start >= 0 && end > start ? textOf(html.slice(start + "Opis Posla</h3>".length, html.lastIndexOf("<", end)).replace(ORIGINAL_LINK, "")) : "";
  const current = (job.description ?? "").replace(/\n\nIzvor: \S+$/, "");
  const source = job.description?.match(/\n\nIzvor: (\S+)$/)?.[1];
  const text = body.length > current.length + 20 ? body : current;
  job.description = truncate(text + (source ? `\n\nIzvor: ${source}` : ""));
  job.salary ??= salaryFromDescription(text) ?? undefined;
  job.tags = [...new Set([
    ...job.tags,
    card["radno vreme"] ?? "",                                  // „8-16h“ / „4h dnevno“ – bez natpisa, da ne doda srpske reči engleskom oglasu
    /zadrug/i.test(company) ? company : "",                    // „Omladinska zadruga …“ -> rules.json kazna
    card["rok za prijavu"] ? `rok ${card["rok za prijavu"]}` : "",
  ].filter(Boolean))];
}

export async function search(ctx: SearchCtx): Promise<Job[]> {
  const o = { ...DEFAULTS, ...((CONFIG as any).oglaszaposao ?? {}) };
  // dan rezerve pre `since` (scrape.ts ionako odbacuje starije); WP `after` poredi sa datumom objave u vremenu sajta (= UTC)
  const from = Math.max(ctx.since.getTime(), Date.now() - o.windowDays * 86_400_000) - 86_400_000;
  const after = new Date(from).toISOString().slice(0, 19);
  const found = new Map<string, Job>();
  let blocked = false, requests = 0;
  outer: for (const q of o.queries as string[]) {
    for (let page = 1; page <= o.pagesPerQuery; page++) {
      const url = `${BASE}/wp-json/wp/v2/oglas?per_page=${PER_PAGE}&page=${page}&_fields=id,date_gmt,link,title,content,class_list&search=${encodeURIComponent(q)}&after=${after}`;
      if (requests++) await sleep(PAUSE_MS);
      let posts: any[];
      try { posts = await fetchJson<any[]>(url); }
      catch (e) {
        const m = errMsg(e);
        if (BLOCKED.test(m)) { ctx.log(`[oglaszaposao] sajt blokira (${m}) – staje za ovaj prolaz`); blocked = true; break outer; }
        if (requests === 1) throw e;
        ctx.log(`[oglaszaposao] „${q}“ page=${page}: ${m}`); break;
      }
      if (!Array.isArray(posts)) break;
      let added = 0;
      for (const p of posts) { const j = fromPost(p); if (j && !found.has(j.id)) { found.set(j.id, j); added++; } }
      ctx.log(`[oglaszaposao] „${q}“ page=${page} results=${posts.length} novih_u_listi=${added}`);
      if (posts.length < PER_PAGE) break;
    }
  }

  const out: Job[] = [];
  let details = 0, waiting = 0;
  for (const j of found.values()) {
    const hay = `${j.title}\n${j.description}`;
    const candidate = !ctx.isSeen(j.id) && !titleRejected(j.title) && REMOTE_HINT.test(hay) && (FLEX_HINT.test(hay) || j.employment.includes("freelance"));
    if (!candidate) { out.push(j); continue; }
    if (blocked || details >= o.maxDetails) { waiting++; continue; } // ne vraća se -> ostaje neviđen, detalj sledeći put
    details++;
    await sleep(PAUSE_MS);
    try { await enrich(j); }
    catch (e) {
      const m = errMsg(e);
      if (BLOCKED.test(m)) { ctx.log(`[oglaszaposao] detalj ${j.id}: sajt blokira (${m})`); blocked = true; waiting++; continue; }
      ctx.log(`[oglaszaposao] detalj ${j.id}: ${m} – ostaje bez firme`); // detalj ne menja tekst (isti isečak) -> oglas se ipak vraća
    }
    out.push(j);
  }
  ctx.log(`[oglaszaposao] ukupno ${found.size} oglasa, ${details} detalja skinuto${waiting ? `, ${waiting} čeka sledeći prolaz` : ""}`);
  return out;
}
