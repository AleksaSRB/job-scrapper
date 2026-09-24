/**
 * Halooglasi – sekcija Posao (provereno 24.09.2026). Sajt je iza Cloudflare-a koji blokira Node-ov TLS otisak,
 * ali propušta curl.exe -> fetchText sam prelazi na curl posle prvog challenge-a (isti trik kao kod stanova).
 *   lista:  GET https://www.halooglasi.com/posao-pretraga?u_poslednjih_h=<sati>&page=N
 *           `QuidditaEnvironment.serverListData={ TotalCount, TotalPages, Ads[] }` (20 po strani); Ads[].ListHTML je HTML-escape-ovan:
 *           courses-title (naslov + link), courses-subtitle (firma), course-description (kratak opis), <li> rok / radni odnos / lokacija
 *           lista NEMA datum objave (ValidFrom je null) -> uzima se iz detalja
 *   detalj: `QuidditaEnvironment.CurrentClassified={ ValidFrom, TextHtml, AdvertiserLogoUrl, OtherFields{ radno_vreme_s ("Puno/Nepuno radno vreme"),
 *           plata_d + plata_d_unit_s ("RSD/mesečno"), gradovi_ss[], naziv_poslodavca_s, grupa_zanimanja_s, nudimo_s, radno_iskustvo_s, o_poslodavcu_s } }`
 *           ValidFrom ima "Z" ali je LOKALNO vreme (isto kao kod stanova) -> parsira se bez Z.
 * Nema polja za rad od kuće -> ocena to čita iz teksta. Filter po ključnoj reči postoji (search_text), ali je lista za 10 dana mala (~230),
 * pa se čita cela i ocenjuje lokalno; detalj se skida samo za neviđene oglase čiji naslov pogađa kategoriju ili tekst pominje od kuće/honorarno/nepuno.
 */
import { CONFIG } from "../config.ts";
import { decodeEntities, extractJson, fetchText, htmlToText, sleep, truncate } from "../http.ts";
import { salaryFromDescription } from "../salary.ts";
import { titleHasCategory } from "../score.ts";
import type { EmploymentKind, Job, Salary, SearchCtx } from "../types.ts";

const BASE = "https://www.halooglasi.com";
const PAGE_SIZE = 20;
const clean = (s: string | undefined) => decodeEntities(htmlToText(s ?? "")).replace(/\s+/g, " ").trim();
/** Lokalni oglasnik bez polja za mesto rada: ako tekst ne pominje rad od kuće, posao je iz firme. */
const REMOTE_HINT = /od ku[cć]e|remote|na daljinu|online rad|rad preko interneta/i;
const remoteOf = (text: string) => (REMOTE_HINT.test(text) ? "remote" : "onsite") as const;

function grab(html: string, marker: string): any {
  const i = html.indexOf(marker);
  if (i < 0) throw new Error(`${marker} nije pronađen (promenjen HTML?)`);
  return extractJson(html, i + marker.length);
}

function employmentOf(s: string | undefined): EmploymentKind[] {
  const t = (s ?? "").toLowerCase();
  if (t.includes("nepuno") || t.includes("skraćeno") || t.includes("skraceno")) return ["part-time"];
  if (t.includes("honorar")) return ["freelance"];
  if (t.includes("puno")) return ["full-time"];
  return [];
}

/** plata_d=70000 + plata_d_unit_s="RSD/mesečno" -> Salary. */
function salaryOf(of: any): Salary | undefined {
  const n = Number(of?.plata_d ?? 0);
  if (!n || n <= 0) return undefined;
  const unit = String(of?.plata_d_unit_s ?? "RSD/mesečno");
  const currency = unit.match(/^[A-Za-z]{3}/)?.[0]?.toUpperCase() ?? "RSD";
  const period = /sat|hour/i.test(unit) ? "hour" as const : /dan|day/i.test(unit) ? "day" as const : /god|year/i.test(unit) ? "year" as const : "month" as const;
  return { min: null, max: n, currency, period, text: `${n.toLocaleString("sr-RS")} ${unit}` };
}

function fromList(ad: any): Job {
  const lh = decodeEntities(String(ad.ListHTML ?? ""));
  const li = (label: string) => clean(lh.match(new RegExp(`<li><span>${label}</span>([\\s\\S]*?)</li>`))?.[1]);
  const radniOdnos = li("radni odnos");
  const snippet = clean(lh.match(/class="course-description">([\s\S]*?)<\/p>/)?.[1]);
  return {
    source: "halooglasi",
    id: `halooglasi:${ad.Id}`,
    url: `${BASE}${String(ad.RelativeUrl ?? "").split("?")[0]}`,
    title: clean(lh.match(/class="courses-title">\s*<a[^>]*>([\s\S]*?)<\/a>/)?.[1]) || String(ad.Title ?? "").trim(),
    company: clean(lh.match(/class="courses-subtitle">([\s\S]*?)<\/div>/)?.[1]),
    location: li("lokacija").replace(/^\(|\)$/g, ""),
    remote: remoteOf(`${ad.Title ?? ""} ${snippet}`),
    employment: employmentOf(radniOdnos),
    postedAt: null,
    description: snippet,
    tags: [radniOdnos, li("rok") ? `rok ${li("rok")}` : ""].filter(Boolean),
  };
}

async function enrich(job: Job): Promise<void> {
  const ad = grab(await fetchText(job.url), "QuidditaEnvironment.CurrentClassified=");
  const of = ad.OtherFields ?? {};
  const vf = String(ad.ValidFrom ?? "").replace(/Z$/, "");
  if (vf) { const d = new Date(vf); if (!Number.isNaN(d.getTime())) job.postedAt = d.toISOString(); }
  const parts = [ad.TextHtml, of.radno_iskustvo_s && `Iskustvo: ${of.radno_iskustvo_s}`, of.nudimo_s && `Nudimo: ${of.nudimo_s}`, of.o_poslodavcu_s && `O poslodavcu: ${of.o_poslodavcu_s}`, of.napomena_s]
    .filter(Boolean).map((h) => htmlToText(String(h)));
  const text = parts.join("\n\n").trim();
  if (text) job.description = truncate(text);
  job.remote = remoteOf(`${ad.Title ?? ""} ${text}`);
  if (ad.Title) job.title = String(ad.Title).trim();
  if (of.naziv_poslodavca_s) job.company = clean(String(of.naziv_poslodavca_s));
  if (Array.isArray(of.gradovi_ss) && of.gradovi_ss.length) job.location = of.gradovi_ss.join(", ");
  if (ad.AdvertiserLogoUrl) job.companyLogo = String(ad.AdvertiserLogoUrl).replace(/^\/\//, "https://");
  const emp = employmentOf(of.radno_vreme_s);
  if (emp.length) job.employment = emp;
  job.salary = salaryOf(of) ?? salaryFromDescription(text) ?? undefined;
  job.tags = [...new Set([...job.tags, of.grupa_zanimanja_s, of.radno_vreme_s].filter(Boolean).map(String))];
}

export async function search(ctx: SearchCtx): Promise<Job[]> {
  const { maxPages, maxDetails } = CONFIG.halooglasi;
  const hours = Math.min(Math.max(7, CONFIG.lookbackDays) * 24, Math.max(24, Math.ceil((Date.now() - ctx.since.getTime()) / 3_600_000) + 1));
  const found = new Map<string, Job>();
  let totalPages = 1;
  for (let page = 1; page <= Math.min(totalPages, maxPages); page++) {
    const data = grab(await fetchText(`${BASE}/posao-pretraga?u_poslednjih_h=${hours}&page=${page}`), "QuidditaEnvironment.serverListData=");
    totalPages = Number(data.TotalPages ?? 1);
    const ads: any[] = data.Ads ?? [];
    let added = 0;
    for (const ad of ads) { const j = fromList(ad); if (j.title && !found.has(j.id)) { found.set(j.id, j); added++; } }
    ctx.log(`[halooglasi] page=${page}/${totalPages} results=${ads.length} novih_u_listi=${added} (poslednjih ${hours} h, ukupno ${data.TotalCount ?? "?"})`);
    await sleep(600);
    if (ads.length < PAGE_SIZE || added === 0) break;
  }
  let details = 0;
  for (const j of found.values()) {
    if (ctx.isSeen(j.id) || details >= maxDetails) continue;
    const hint = /od ku[cć]e|honorar|nepuno|remote|online/i.test(`${j.description ?? ""} ${j.tags.join(" ")}`);
    if (!hint && !titleHasCategory(j.title)) continue;
    details++;
    try { await enrich(j); } catch (e) { ctx.log(`[halooglasi] detalj ${j.id}: ${(e as Error).message}`); }
    await sleep(600);
  }
  ctx.log(`[halooglasi] ukupno ${found.size} oglasa, ${details} detalja skinuto`);
  return [...found.values()];
}
