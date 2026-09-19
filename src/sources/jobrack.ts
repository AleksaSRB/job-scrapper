/**
 * JobRack – SSR HTML, remote poslovi za Istočnu Evropu (provereno 19.09.2026):
 *   lista:  https://jobrack.eu/jobs?page=N  i  https://jobrack.eu/jobs/category/<support|executive-assistant|sales-marketing|…>?page=N
 *           <a href="https://jobrack.eu/jobs/<slug>" class="list-group-item"> … job-title, company-name, job-posted-time ("3 days ago"),
 *           jobs-category, job-details (snippet), job-tags (Full Time / "2000.00 - 3000.00 USD / Monthly"), img.employer-logo
 *           sortirano od najnovijeg; ~10 po strani
 *   detalj: <div class="job-description …"> … ; plata u .text-with-icon.salary; nema tačnog datuma (samo relativni iz liste)
 */
import { CONFIG } from "../config.ts";
import { decodeEntities, fetchText, htmlToText, relativeToIso, sleep, truncate } from "../http.ts";
import { parseSalaryText, salaryFromDescription } from "../salary.ts";
import type { EmploymentKind, Job, SearchCtx } from "../types.ts";

const BASE = "https://jobrack.eu";

const pick = (block: string, re: RegExp) => { const m = block.match(re); return m ? decodeEntities(htmlToText(m[1])).replace(/\s+/g, " ").trim() : ""; };

function employmentOf(tags: string[]): EmploymentKind[] {
  const t = tags.join(" ").toLowerCase();
  const out: EmploymentKind[] = [];
  if (/part[- ]?time/.test(t)) out.push("part-time");
  else if (/full[- ]?time/.test(t)) out.push("full-time");
  if (/freelance/.test(t)) out.push("freelance");
  if (/contract/.test(t)) out.push("contract");
  if (/intern/.test(t)) out.push("internship");
  return out;
}

function parseList(html: string): Job[] {
  const out: Job[] = [];
  for (const m of html.matchAll(/<a href="(https:\/\/jobrack\.eu\/jobs\/([^"/]+))"\s+class="list-group-item">([\s\S]*?)<\/a>/g)) {
    const [, url, slug, block] = m;
    const title = pick(block, /class="job-title"[^>]*>([\s\S]*?)<\/h2>/);
    if (!title) continue;
    const tags = [...block.matchAll(/<span class="btn btn-xs[^"]*">([\s\S]*?)<\/span>/g)].map((t) => decodeEntities(htmlToText(t[1])).replace(/\s+/g, " ").trim()).filter(Boolean);
    const salaryTag = tags.find((t) => /\d/.test(t));
    const logo = block.match(/class="employer-logo"\s+src="([^"]+)"/)?.[1];
    out.push({
      source: "jobrack", id: `jobrack:${slug}`, url, title,
      company: pick(block, /class="company-name"[^>]*>([\s\S]*?)<\/h4>/),
      companyLogo: logo ? (logo.startsWith("http") ? logo : `${BASE}${logo}`) : undefined,
      location: "Remote — Eastern Europe", remote: "remote",
      employment: employmentOf(tags),
      salary: parseSalaryText(salaryTag) ?? undefined,
      postedAt: relativeToIso(pick(block, /class="job-posted-time[^"]*"[^>]*>([\s\S]*?)<\/span>/)),
      description: pick(block, /class="job-details[^"]*"[^>]*>([\s\S]*?)<\/p>/),
      tags: [pick(block, /class="jobs-category"[^>]*>([\s\S]*?)<\/span>/), ...tags.filter((t) => !/\d/.test(t))].filter(Boolean),
    });
  }
  return out;
}

async function enrich(job: Job): Promise<void> {
  const html = await fetchText(job.url);
  const desc = html.match(/<div class="job-description[^"]*">([\s\S]*?)<\/div>\s*(?:<div class="(?:apply|job-apply|row|col)|<\/section|<footer|<div class="container)/)?.[1]
    ?? html.match(/<div class="job-description[^"]*">([\s\S]*?)(?=<h\d[^>]*>\s*Apply|<a[^>]*apply|<footer)/i)?.[1];
  const text = htmlToText(desc ?? "");
  if (text.length > (job.description?.length ?? 0)) job.description = truncate(text);
  const sal = html.match(/class="text-with-icon salary"[^>]*>([\s\S]*?)<\/(?:p|div|span)>/)?.[1];
  if (sal) job.salary = parseSalaryText(htmlToText(sal).replace(/\s+/g, " ")) ?? job.salary;
  job.salary ??= salaryFromDescription(text) ?? undefined;
  const type = htmlToText(html.match(/class="text-with-icon job-type"[^>]*>([\s\S]*?)<\/(?:p|div|span)>/)?.[1] ?? "").trim();
  if (type && job.employment.length === 0) job.employment = employmentOf([type]);
}

export async function search(ctx: SearchCtx): Promise<Job[]> {
  const { categories, maxPages, listPages, maxDetails } = CONFIG.jobrack;
  const found = new Map<string, Job>();
  const plan: Array<{ url: string; pages: number; label: string }> = [
    { url: `${BASE}/jobs`, pages: listPages, label: "svi" },
    ...categories.map((c) => ({ url: `${BASE}/jobs/category/${c}`, pages: maxPages, label: c })),
  ];
  for (const p of plan) {
    for (let page = 1; page <= p.pages; page++) {
      const jobs = parseList(await fetchText(`${p.url}?page=${page}`));
      for (const j of jobs) if (!found.has(j.id)) found.set(j.id, j);
      ctx.log(`[jobrack] ${p.label} page=${page} results=${jobs.length}`);
      await sleep(500);
      if (jobs.length === 0) break;
      if (jobs.every((j) => j.postedAt !== null && new Date(j.postedAt) < ctx.since)) break; // lista je od najnovijeg
    }
  }
  let details = 0;
  for (const j of found.values()) {
    if (ctx.isSeen(j.id) || details >= maxDetails) continue;
    if (j.postedAt !== null && new Date(j.postedAt) < ctx.since) continue;
    details++;
    try { await enrich(j); } catch (e) { ctx.log(`[jobrack] detalj ${j.id}: ${(e as Error).message}`); }
    await sleep(500);
  }
  ctx.log(`[jobrack] ukupno ${found.size} oglasa, ${details} detalja skinuto`);
  return [...found.values()];
}
