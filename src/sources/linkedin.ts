/**
 * LinkedIn Jobs – javni „guest“ API bez logovanja (provereno 19.09.2026, IP iz Srbije):
 *   lista:  GET https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=<q>&location=Serbia&f_WT=2&f_TPR=r<sekunde>&start=<0,10,20…>
 *           HTML fragment, 10 <li> po strani: data-entity-urn="urn:li:jobPosting:<id>", base-search-card__title, __subtitle (firma),
 *           job-search-card__location, <time datetime="YYYY-MM-DD">, base-card__full-link href, img data-delayed-url (logo)
 *           f_WT=2 = remote, f_JT=P = part-time, f_TPR=r432000 = poslednjih 5 dana
 *   detalj: GET https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/<id>  -> description__text, description__job-criteria-text
 *           (Seniority level, Employment type, Job function, Industries)
 * Rizik: rate limit (HTTP 429) posle većeg broja zahteva -> mali broj upita, pauze, detalj samo za neviđene; 429 prekida izvor.
 */
import { CONFIG } from "../config.ts";
import { decodeEntities, fetchText, htmlToText, sleep, toIso, truncate } from "../http.ts";
import { parseSalaryText, salaryFromDescription } from "../salary.ts";
import type { EmploymentKind, Job, SearchCtx } from "../types.ts";

const API = "https://www.linkedin.com/jobs-guest/jobs/api";
const clean = (s: string | undefined) => decodeEntities(htmlToText(s ?? "")).replace(/\s+/g, " ").trim();

function parseList(html: string): Job[] {
  const out: Job[] = [];
  for (const li of html.split(/<li>/).slice(1)) {
    const id = li.match(/urn:li:jobPosting:(\d+)/)?.[1];
    const title = clean(li.match(/base-search-card__title"[^>]*>([\s\S]*?)<\/h3>/)?.[1]);
    if (!id || !title) continue;
    const href = li.match(/class="base-card__full-link[^"]*"\s+href="([^"?]+)/)?.[1] ?? `https://www.linkedin.com/jobs/view/${id}`;
    out.push({
      source: "linkedin", id: `linkedin:${id}`, url: decodeEntities(href), title,
      company: clean(li.match(/base-search-card__subtitle"[^>]*>([\s\S]*?)<\/h4>/)?.[1]),
      companyLogo: li.match(/data-delayed-url="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&"),
      location: clean(li.match(/job-search-card__location"[^>]*>([\s\S]*?)<\/span>/)?.[1]),
      remote: "remote", employment: [], locationVerified: true,
      salary: parseSalaryText(clean(li.match(/job-search-card__salary-info"[^>]*>([\s\S]*?)<\/span>/)?.[1])) ?? undefined,
      postedAt: toIso(li.match(/<time[^>]*datetime="([^"]+)"/)?.[1]),
      tags: [],
    });
  }
  return out;
}

function employmentOf(s: string): EmploymentKind[] {
  const t = s.toLowerCase();
  if (t.includes("part")) return ["part-time"];
  if (t.includes("full")) return ["full-time"];
  if (t.includes("contract")) return ["contract"];
  if (t.includes("temporary")) return ["temporary"];
  if (t.includes("intern")) return ["internship"];
  return [];
}

async function enrich(job: Job): Promise<void> {
  const id = job.id.split(":")[1];
  const html = await fetchText(`${API}/jobPosting/${id}`, { tries: 2 });
  const desc = html.match(/description__text[^"]*"[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? html.match(/class="show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
  const text = htmlToText(desc);
  if (text) job.description = truncate(text);
  const criteria = [...html.matchAll(/description__job-criteria-subheader"[^>]*>([\s\S]*?)<\/h3>\s*<span[^>]*description__job-criteria-text[^>]*>([\s\S]*?)<\/span>/g)]
    .map((m) => [clean(m[1]), clean(m[2])] as const);
  for (const [k, v] of criteria) {
    if (/employment type/i.test(k)) job.employment = employmentOf(v);
    else if (/seniority/i.test(k) && v && !/not applicable/i.test(v)) job.tags.push(v);
    else if (/job function/i.test(k) && v) job.tags.push(...v.split(/,\s*|\s+and\s+/).slice(0, 3));
  }
  job.salary ??= salaryFromDescription(text) ?? undefined;
}

export async function search(ctx: SearchCtx): Promise<Job[]> {
  const { location, maxPages, maxDetails, queries } = CONFIG.linkedin;
  const found = new Map<string, Job>();
  // prozor: od baseline-a, ali najviše lookbackDays (scraper radi svakih sat vremena, seen.json pamti viđene – dalje nema smisla)
  const tpr = Math.min(Math.max(7, CONFIG.lookbackDays) * 86_400, Math.max(86_400, Math.round((Date.now() - ctx.since.getTime()) / 1000) + 3600));
  let rateLimited = false;
  for (const q of queries) {
    for (let page = 0; page < maxPages && !rateLimited; page++) {
      const url = `${API}/seeMoreJobPostings/search?keywords=${encodeURIComponent(q)}&location=${encodeURIComponent(location)}&f_WT=2&f_TPR=r${tpr}&start=${page * 10}`;
      let jobs: Job[] = [];
      try { jobs = parseList(await fetchText(url, { tries: 2 })); }
      catch (e) {
        const msg = (e as Error).message;
        if (/429/.test(msg)) { rateLimited = true; ctx.log(`[linkedin] rate limit (429) – prekidam ovaj prolaz`); break; }
        if (!/HTTP 400/.test(msg)) ctx.log(`[linkedin] q="${q}" page=${page}: ${msg}`);
        break; // 400 = nema (više) rezultata
      }
      for (const j of jobs) if (!found.has(j.id)) found.set(j.id, j);
      ctx.log(`[linkedin] q="${q}" start=${page * 10} results=${jobs.length}`);
      await sleep(1_200);
      if (jobs.length < 10) break;
    }
    if (rateLimited) break;
  }
  let details = 0;
  for (const j of found.values()) {
    if (rateLimited || ctx.isSeen(j.id) || details >= maxDetails) continue;
    if (j.postedAt !== null && new Date(j.postedAt) < ctx.since) continue;
    details++;
    try { await enrich(j); }
    catch (e) { const msg = (e as Error).message; ctx.log(`[linkedin] detalj ${j.id}: ${msg}`); if (/429/.test(msg)) rateLimited = true; }
    await sleep(1_500);
  }
  ctx.log(`[linkedin] ukupno ${found.size} oglasa, ${details} detalja skinuto${rateLimited ? " (prekinuto: 429)" : ""}`);
  return [...found.values()];
}
