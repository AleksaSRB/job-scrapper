/**
 * Nacionalna služba za zapošljavanje – zvanični oglasi (provereno 26.09.2026), SSR HTML, ćirilica -> latinizuje se.
 *   lista:  GET https://nsz.gov.rs/employee/jobs/search?search_term=<upit>&page=N   ili  ?category_id[]=<id>&page=N   (20 po strani)
 *           <div class="single-job …" onclick="…/employee/jobs/preview/<id>"> job-title, job-description (poslodavac + grad), „Оглас истиче: dd.mm.yyyy.“
 *           kategorije (category_id): 20 Администрација, 14 Трговина/комерцијала, 17 Менаџмент, 16 Економија, 24 Култура/медији/ПР,
 *           15 Угоститељство/туризам, 12 Архитектура; `keyword` param ne filtrira – radi `search_term`.
 *   detalj: GET https://nsz.gov.rs/employee/jobs/preview/<id>  -> .job-content (opis), .job-location (grupa - grad), .job-requirements tabela:
 *           „Временско трајање огласа: 25.09.2026. - 25.10.2026.“ (prvi datum = objava), „Врста рада“, „Радно време“, „Место рада“,
 *           „Радно искуство“, „Рад на рачунару“, „Језик: Енглески: … Почетни(A1) … Обавезно“ (nivo jezika = zlato za filter engleskog).
 * NSZ agregira i oglase sa Infostud-a i Lako do posla -> duplikati se spajaju po firmi+naslovu.
 * Nema polja za rad od kuće -> tekst; bez pominjanja = iz firme.
 */
import { CONFIG } from "../config.ts";
import { dateSrToIso, decodeEntities, fetchText, htmlToText, sleep, truncate } from "../http.ts";
import { salaryFromDescription } from "../salary.ts";
import { titleHasCategory } from "../score.ts";
import { latinize } from "../text.ts";
import type { EmploymentKind, Job, SearchCtx } from "../types.ts";

const BASE = "https://nsz.gov.rs";
const PAGE_SIZE = 20;
const clean = (s: string | undefined) => latinize(decodeEntities(htmlToText(s ?? ""))).replace(/\s+/g, " ").trim();
const REMOTE_HINT = /od ku[cć]e|remote|na daljinu|online rad|rad preko interneta/i;

function parseList(html: string): Job[] {
  const out: Job[] = [];
  for (const block of html.split(/<div class="single-job/).slice(1)) {
    const id = block.match(/jobs\/preview\/(\d+)/)?.[1];
    const title = clean(block.match(/class="job-title">([\s\S]*?)<\/h3>/)?.[1]);
    if (!id || !title) continue;
    const who = clean(block.match(/class="job-description[^"]*">([\s\S]*?)<\/p>/)?.[1]);
    const logo = block.match(/<img src="([^"]+)"/)?.[1];
    out.push({
      source: "nsz", id: `nsz:${id}`, url: `${BASE}/employee/jobs/preview/${id}`, title,
      company: who, companyLogo: logo && !/logo-nsz/.test(logo) ? `${BASE}${logo}` : undefined,
      location: "", remote: REMOTE_HINT.test(title) ? "remote" : "onsite", employment: [], postedAt: null,
      tags: [clean(block.match(/истиче:\s*([\d.]+)/)?.[1] ? `rok ${block.match(/истиче:\s*([\d.]+)/)![1]}` : "")].filter(Boolean),
    });
  }
  return out;
}

function employmentOf(radnoVreme: string, vrstaRada: string): EmploymentKind[] {
  const rv = radnoVreme.toLowerCase(), vr = vrstaRada.toLowerCase();
  if (/nepuno|skrac/.test(rv)) return ["part-time"];
  if (/puno/.test(rv)) return ["full-time"];
  if (/ugovor o delu/.test(vr)) return ["freelance"];
  if (/privremen|sezon/.test(vr)) return ["temporary"];
  if (/volont/.test(vr)) return ["internship"];
  return [];
}

async function enrich(job: Job): Promise<void> {
  const html = await fetchText(job.url);
  const title = clean(html.match(/class="content-line-title">([\s\S]*?)<\/h2>/)?.[1]);
  if (title) job.title = title;
  const who = clean(html.match(/class="job-description[^"]*">([\s\S]*?)<\/p>/)?.[1]);
  if (who) job.company = who;
  const loc = clean(html.match(/class="job-location">([\s\S]*?)<\/span>\s*<\/span>/)?.[1]);
  const content = htmlToText(html.match(/class="job-content">([\s\S]*?)<div class="job-requirements">/)?.[1] ?? "");
  const rows = [...(html.match(/class="job-requirements">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/)?.[1] ?? "").matchAll(/<div class="table-row">([\s\S]*?)<\/div>\s*<\/div>/g)]
    .map((m) => clean(m[1])).filter(Boolean);
  const row = (label: RegExp) => rows.find((r) => label.test(r))?.replace(/^[^:]*:\s*/, "") ?? "";
  const span = row(/^Vremensko trajanje/i);
  job.postedAt = dateSrToIso(span.match(/(\d{2}\.\d{2}\.\d{4})/)?.[1]) ?? job.postedAt;
  const mesto = row(/^Mesto rada/i).replace(/;\s*$/, "");
  job.location = mesto || loc.split(" - ").pop()?.replace(/;\s*$/, "") || job.location;
  job.employment = employmentOf(row(/^Radno vreme/i), row(/^Vrsta rada/i));
  const text = [latinize(content), ...rows].join("\n").trim();
  if (text) job.description = truncate(text);
  job.remote = REMOTE_HINT.test(`${job.title} ${text}`) ? "remote" : "onsite";
  job.salary = salaryFromDescription(text) ?? undefined;
  const grupa = loc.split(" - ")[0];
  job.tags = [...new Set([...job.tags, grupa, row(/^Vrsta rada/i), row(/^Radno vreme/i)].filter(Boolean))];
}

export async function search(ctx: SearchCtx): Promise<Job[]> {
  const { categories, queries, maxPages, maxDetails } = CONFIG.nsz;
  const found = new Map<string, Job>();
  const plan = [...categories.map((c) => ({ label: `kat ${c}`, qs: `category_id%5B%5D=${c}` })), ...queries.map((q) => ({ label: `q="${q}"`, qs: `search_term=${encodeURIComponent(q)}` }))];
  for (const p of plan) {
    for (let page = 1; page <= maxPages; page++) {
      const jobs = parseList(await fetchText(`${BASE}/employee/jobs/search?${p.qs}&page=${page}`));
      let added = 0;
      for (const j of jobs) if (!found.has(j.id)) { found.set(j.id, j); added++; }
      ctx.log(`[nsz] ${p.label} page=${page} results=${jobs.length} novih_u_listi=${added}`);
      await sleep(500);
      if (jobs.length < PAGE_SIZE || added === 0) break;
    }
  }
  let details = 0;
  for (const j of found.values()) {
    if (ctx.isSeen(j.id) || details >= maxDetails) continue;
    if (!titleHasCategory(j.title) && j.remote !== "remote") continue;
    details++;
    try { await enrich(j); } catch (e) { ctx.log(`[nsz] detalj ${j.id}: ${(e as Error).message}`); }
    await sleep(500);
  }
  ctx.log(`[nsz] ukupno ${found.size} oglasa, ${details} detalja skinuto`);
  return [...found.values()];
}
