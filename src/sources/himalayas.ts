/**
 * Himalayas – zvaničan JSON search API (provereno 19.09.2026; adapter preuzet iz jobs/ scrapera):
 *   GET https://himalayas.app/jobs/api/search?q=<upit>&country=RS&sort=recent&page=N   (20 po strani)
 * `country=RS` vraća oglase na koje se može konkurisati iz Srbije (uključuje worldwide) -> locationVerified.
 * Polja: title, companyName, companyLogo, employmentType (Full Time/Part Time/Contractor/Freelance/Internship),
 *        minSalary/maxSalary/currency/salaryPeriod, locationRestrictions[], categories[], description (HTML), pubDate (unix), guid, applicationLink.
 */
import { CONFIG } from "../config.ts";
import { fetchJson, htmlToText, sleep, toIso, truncate } from "../http.ts";
import { salaryFromDescription } from "../salary.ts";
import type { EmploymentKind, Job, SalaryPeriod, SearchCtx } from "../types.ts";

const PAGE_SIZE = 20;
const PERIODS: Record<string, SalaryPeriod> = { annual: "year", yearly: "year", monthly: "month", weekly: "week", daily: "day", hourly: "hour" };

interface ApiJob {
  title: string; excerpt?: string; companyName: string; companyLogo?: string; employmentType?: string;
  minSalary: number | null; maxSalary: number | null; salaryPeriod?: string; currency: string | null;
  seniority?: string[]; locationRestrictions?: string[]; categories?: string[]; description?: string; pubDate: number; applicationLink?: string; guid: string;
}
interface ApiPage { jobs?: ApiJob[]; offset?: number; limit?: number; totalCount?: number }

function jobId(guid: string): string {
  const m = guid.match(/\/companies\/([^/]+)\/jobs\/([^/?#]+)/);
  return m ? `himalayas:${m[1]}/${m[2]}` : `himalayas:${guid}`;
}

function employmentOf(t: string | undefined): EmploymentKind[] {
  const s = (t ?? "").toLowerCase();
  if (s.includes("part")) return ["part-time"];
  if (s.includes("full")) return ["full-time"];
  if (s.includes("contract")) return ["contract"];
  if (s.includes("freelance")) return ["freelance"];
  if (s.includes("intern")) return ["internship"];
  if (s.includes("temp")) return ["temporary"];
  return [];
}

function toJob(j: ApiJob): Job {
  const locs = j.locationRestrictions ?? [];
  const hasSalary = (j.minSalary ?? 0) > 0 || (j.maxSalary ?? 0) > 0;
  const text = htmlToText(j.description || j.excerpt || "");
  return {
    source: "himalayas",
    id: jobId(j.guid),
    url: j.applicationLink || j.guid,
    title: j.title.trim(),
    company: j.companyName?.trim() ?? "",
    companyLogo: j.companyLogo || undefined,
    location: locs.length ? locs.slice(0, 4).join(", ") + (locs.length > 4 ? ` +${locs.length - 4}` : "") : "Worldwide",
    remote: "remote",
    employment: employmentOf(j.employmentType),
    salary: hasSalary
      ? { min: j.minSalary || null, max: j.maxSalary || null, currency: j.currency, period: PERIODS[(j.salaryPeriod ?? "").toLowerCase()] ?? null }
      : salaryFromDescription(text) ?? undefined,
    postedAt: toIso(j.pubDate),
    description: truncate(text),
    tags: [...(j.categories ?? []).map((c) => c.replace(/-/g, " ")), ...(j.seniority ?? [])],
    locationVerified: true,
  };
}

export async function search(ctx: SearchCtx): Promise<Job[]> {
  const { country, maxPages, queries } = CONFIG.himalayas;
  const out = new Map<string, Job>();
  for (const q of queries) {
    for (let page = 1; page <= maxPages; page++) {
      const url = `https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q)}${country ? `&country=${country}` : ""}&sort=recent&page=${page}`;
      const res = await fetchJson<ApiPage>(url);
      const jobs = (res.jobs ?? []).map(toJob);
      for (const j of jobs) if (!out.has(j.id)) out.set(j.id, j);
      ctx.log(`[himalayas] q="${q}" page=${page} results=${jobs.length} total=${res.totalCount ?? "?"}`);
      await sleep(500);
      const lastPage = jobs.length === 0 || (typeof res.totalCount === "number"
        ? (res.offset ?? (page - 1) * PAGE_SIZE) + (res.limit ?? PAGE_SIZE) >= res.totalCount
        : jobs.length < PAGE_SIZE);
      const reachedOld = jobs.some((j) => j.postedAt !== null && new Date(j.postedAt) < ctx.since);
      if (lastPage || reachedOld || jobs.every((j) => ctx.isSeen(j.id))) break;
    }
  }
  return [...out.values()];
}
