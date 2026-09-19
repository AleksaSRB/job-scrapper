/**
 * Poslovi Infostud – Next.js SSR, `__NEXT_DATA__` (provereno 19.09.2026):
 *   lista:  GET https://poslovi.infostud.com/oglasi-za-posao?q=<upit>&page=N[&workPlaceTypes=remote]   (30 po strani)
 *           pageProps.initialSearchResults { totalPrimaryItems, page, jobs.primary[] }
 *           polja: id, title, companyName, logo, location, workFromHome, hybridWork, onlineViewDate "DD.MM.YYYY", salary, url,
 *                  textAdSnippet, jobSummary.summary, primaryCategory.name
 *   detalj: GET https://poslovi.infostud.com/posao/x/y/<id>   (slug nije bitan) -> pageProps.job
 *           textAd (HTML), datePosted "YYYY-MM-DD", employmentType.nameSr, workingHours.nameSr, unformattedSalary{from,to,currency,type}
 * Filteri (id-jevi iz facets-a): workPlaceTypes=remote|hybrid|on-site, workingHours=5 (nepuno) | 7 (puno), employmentTypes=9 (honorarno).
 * `sort` se ignoriše (Premium prvo) -> uz `onlineAfterDate=YYYY-MM-DD` (od baseline-a, max 7 dana) lista je dovoljno mala da stane u maxPages.
 * Startuj i HelloWorld dele istu bazu i iste id-jeve -> id "infostud:<id>" je zajednički.
 */
import { CONFIG } from "../config.ts";
import { fetchText, htmlToText, nextData, sleep, truncate, dateSrToIso } from "../http.ts";
import { parseSalaryText, salaryFromDescription } from "../salary.ts";
import type { EmploymentKind, Job, RemoteType, SearchCtx, Source } from "../types.ts";

const BASE = "https://poslovi.infostud.com";

interface ListJob {
  id: number; title: string; companyName: string; logo?: string | null; location?: string; url: string;
  workFromHome?: boolean; hybridWork?: boolean; fieldwork?: boolean; onlineViewDate?: string; salary?: string | null;
  textAdSnippet?: string; jobSummary?: { summary?: string } | null; primaryCategory?: { name?: string } | null;
}
interface DetailJob extends ListJob {
  textAd?: string; datePosted?: string; employmentType?: { nameSr?: string } | null; workingHours?: { nameSr?: string } | null;
  unformattedSalary?: { from?: string | number | null; to?: string | number | null; currency?: string | null; type?: string | null; additional?: string | null } | null;
  cities?: Array<{ name?: string } | string>;
}

export const jobId = (id: number | string) => `infostud:${id}`;

function remoteOf(j: ListJob): RemoteType {
  if (j.workFromHome) return "remote";
  if (j.hybridWork) return "hybrid";
  return "onsite";
}

function employmentOf(d: DetailJob): EmploymentKind[] {
  const out: EmploymentKind[] = [];
  const wh = (d.workingHours?.nameSr ?? "").toLowerCase();
  const et = (d.employmentType?.nameSr ?? "").toLowerCase();
  if (wh.includes("nepuno")) out.push("part-time");
  else if (wh.includes("puno")) out.push("full-time");
  if (et.includes("honorar")) out.push("freelance");
  if (et.includes("praksa")) out.push("internship");
  if (et.includes("sezon") || et.includes("privremen")) out.push("temporary");
  return out;
}

/** `salary` je tekst ("neto 70.000 - 200.000 RSD (mesečno)"); `unformattedSalary.from/to` su stringovi u PARAMA ("7000000" = 70.000). */
function salaryOf(d: DetailJob, text: string) {
  const fromText = parseSalaryText(d.salary);
  if (fromText) return fromText;
  const u = d.unformattedSalary;
  const from = Number(u?.from ?? 0) / 100, to = Number(u?.to ?? 0) / 100;
  if (u && (from > 0 || to > 0)) {
    const t = `${u.type ?? ""} ${u.additional ?? ""}`.toLowerCase();
    return { min: from || null, max: to || null, currency: (u.currency || "RSD").toUpperCase(), period: /sat|hour/.test(t) ? "hour" as const : "month" as const, text: d.salary || undefined };
  }
  return salaryFromDescription(text) ?? undefined;
}

/** Oglas iz liste (bez detalja): opis = snippet + AI sažetak sajta. */
export function fromList(j: ListJob, source: Source = "infostud"): Job {
  const snippet = htmlToText(j.textAdSnippet ?? "");
  const summary = j.jobSummary?.summary?.trim() || undefined;
  return {
    source, id: jobId(j.id), url: j.url || `${BASE}/posao/x/y/${j.id}`,
    title: (j.title ?? "").trim(), company: (j.companyName ?? "").trim(),
    companyLogo: j.logo ? (j.logo.startsWith("http") ? j.logo : `${BASE}${j.logo}`) : undefined,
    location: (j.location ?? "").trim(), remote: remoteOf(j), employment: [],
    salary: parseSalaryText(j.salary) ?? undefined,
    postedAt: dateSrToIso(j.onlineViewDate),
    description: truncate([summary, snippet].filter(Boolean).join("\n\n")), summary,
    tags: [j.primaryCategory?.name ?? ""].filter(Boolean),
  };
}

/** Pun oglas sa stranice detalja; null ako je istekao / nema ga. */
export async function fetchDetail(id: number | string, base?: ListJob, source: Source = "infostud"): Promise<Job | null> {
  const html = await fetchText(`${BASE}/posao/x/y/${id}`);
  const pp = nextData<{ job?: DetailJob }>(html);
  const d = pp?.job;
  if (!d || !d.title) return null;
  const text = htmlToText(d.textAd ?? "");
  const job = fromList({ ...(base ?? {}), ...d, workFromHome: base?.workFromHome ?? d.workFromHome, hybridWork: base?.hybridWork ?? d.hybridWork }, source);
  if (!base) {
    // detalj nema workFromHome flag u istom obliku kao lista -> ostavi tekstu opisa da odluči, osim ako lista nije rekla
    job.remote = d.workFromHome ? "remote" : d.hybridWork ? "hybrid" : "unknown";
  }
  job.employment = employmentOf(d);
  job.salary = salaryOf(d, text);
  job.postedAt = dateSrToIso(d.datePosted) ?? job.postedAt;
  job.description = truncate(text || job.description || "");
  if (!job.location && Array.isArray(d.cities)) job.location = d.cities.map((c) => (typeof c === "string" ? c : c?.name ?? "")).filter(Boolean).join(", ");
  const tags = new Set(job.tags);
  for (const t of [d.employmentType?.nameSr, d.workingHours?.nameSr]) if (t) tags.add(t);
  job.tags = [...tags];
  return job;
}

export async function search(ctx: SearchCtx): Promise<Job[]> {
  const { maxPages, maxDetails, queries, remoteOnlyQueries } = CONFIG.infostud;
  const remoteOnly = new Set(remoteOnlyQueries.map((q) => q.toLowerCase()));
  const listed = new Map<string, ListJob>();
  // "" = svi remote oglasi bez upita (ima ih ~90) – hvata i ono što upiti promaše
  const plan: Array<{ q: string; remote: boolean }> = [{ q: "", remote: true }, ...queries.map((q) => ({ q, remote: remoteOnly.has(q.toLowerCase()) }))];
  // sort po datumu ne postoji (Premium prvo), pa se lista sužava na oglase postavljene od baseline-a (najviše lookbackDays unazad) -> ne promiču novi ne-Premium oglasi
  const afterMs = Math.max(ctx.since.getTime(), Date.now() - Math.max(7, CONFIG.lookbackDays) * 86_400_000);
  const after = new Date(afterMs);
  const onlineAfter = `${after.getFullYear()}-${String(after.getMonth() + 1).padStart(2, "0")}-${String(after.getDate()).padStart(2, "0")}`;
  for (const { q, remote } of plan) {
    for (let page = 1; page <= maxPages; page++) {
      const url = `${BASE}/oglasi-za-posao?${q ? `q=${encodeURIComponent(q)}&` : ""}${remote ? "workPlaceTypes=remote&" : ""}onlineAfterDate=${onlineAfter}&page=${page}`;
      const pp = nextData<{ initialSearchResults?: { totalPrimaryItems?: number; jobs?: { primary?: ListJob[] } } }>(await fetchText(url));
      const res = pp?.initialSearchResults;
      const jobs = res?.jobs?.primary ?? [];
      for (const j of jobs) if (j?.id && !listed.has(jobId(j.id))) listed.set(jobId(j.id), j);
      ctx.log(`[infostud] q="${q || "(remote)"}" page=${page} results=${jobs.length} total=${res?.totalPrimaryItems ?? "?"}`);
      await sleep(400);
      if (jobs.length < 30 || (page * 30) >= (res?.totalPrimaryItems ?? 0)) break;
      // ne idi dalje ako je cela strana starija od baseline-a (retko, jer sort nije po datumu, ali štedi zahteve)
      if (jobs.every((j) => { const d = dateSrToIso(j.onlineViewDate); return d !== null && new Date(d) < ctx.since; })) break;
    }
  }
  const out: Job[] = [];
  let details = 0;
  for (const [id, j] of listed) {
    const base = fromList(j);
    const fresh = !ctx.isSeen(id) && (base.postedAt === null || new Date(base.postedAt) >= ctx.since);
    if (fresh && details < maxDetails) {
      details++;
      try {
        const full = await fetchDetail(j.id, j);
        out.push(full ?? base);
      } catch (e) { ctx.log(`[infostud] detalj ${j.id}: ${(e as Error).message}`); out.push(base); }
      await sleep(350);
    } else out.push(base);
  }
  ctx.log(`[infostud] ukupno ${out.length} oglasa, ${details} detalja skinuto`);
  return out;
}
