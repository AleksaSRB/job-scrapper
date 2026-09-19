/**
 * Poslovi.rs – SSR + AJAX lista (provereno 19.09.2026):
 *   GET https://www.poslovi.rs/jobs           (postavlja sesijski kolačić)
 *   GET https://www.poslovi.rs/jobs/jobs_ajax/<offset>  + X-Requested-With  (N je OFFSET u stavkama: 0, 30, 60…; 30 po strani; ~240 aktivnih oglasa)
 *       <a class="item-block" href="/job/<firma>/<slug>-<id>"> … <span title="Rad od kuće"><div class="sticker …">RDK</div></span> (samo remote)
 *       <div class="sticker sticker-new">NOVO</div>, <h4 class="ellipsis-box">naslov</h4>, <h5 class="epl_name_list">firma</h5>,
 *       <span class="status" title="lokacija">, Rok: <span>DD.MM.YYYY</span>, <img src="logo">
 *   Filter po ključnoj reči (POST /jobs_filter) ne utiče na AJAX listu -> čita se cela lista, a naslov/opis se ocenjuju lokalno.
 *   Nema datuma objave (samo rok) -> postedAt = null (računa se kad smo ga prvi put videli).
 *   Detalj: <main><section> … <small class="">Rad od kuće</small> … <span class=""><p>opis…</span> <hr> <h6>Gradovi</h6> <span class="label">grad</span>
 */
import { CONFIG } from "../config.ts";
import { CookieJar, decodeEntities, fetchText, htmlToText, sleep, truncate } from "../http.ts";
import { salaryFromDescription } from "../salary.ts";
import { titleHasCategory } from "../score.ts";
import type { Job, SearchCtx } from "../types.ts";

const BASE = "https://www.poslovi.rs";
const PAGE_SIZE = 30;
const clean = (s: string | undefined) => decodeEntities(htmlToText(s ?? "")).replace(/\s+/g, " ").trim();

function parseList(html: string): Job[] {
  const out: Job[] = [];
  for (const m of html.matchAll(/<a class="item-block"\s+href="(\/job\/[^"]+)">([\s\S]*?)<\/a>\s*<\/div>/g)) {
    const [, path, block] = m;
    const id = path.match(/-(\d+)\/?$/)?.[1];
    const title = clean(block.match(/<h4 class="ellipsis-box">([\s\S]*?)<\/h4>/)?.[1]);
    if (!id || !title) continue;
    const remote = /title="Rad od ku[čc]e"><div class="sticker/.test(block);
    const logo = block.match(/<img src="([^"]+)"/)?.[1];
    out.push({
      source: "poslovirs", id: `poslovirs:${id}`, url: `${BASE}${path}`, title,
      company: clean(block.match(/<h5 class="epl_name_list">([\s\S]*?)<span/)?.[1] ?? block.match(/<h5 class="epl_name_list">([\s\S]*?)<\/h5>/)?.[1]),
      companyLogo: logo && !/_default_logo/.test(logo) ? logo : undefined,
      location: decodeEntities(block.match(/<span class="status" title="([^"]*)"/)?.[1] ?? ""),
      remote: remote ? "remote" : "onsite",
      employment: [],
      postedAt: null,
      tags: [/sticker-new/.test(block) ? "NOVO" : "", remote ? "Rad od kuće" : ""].filter(Boolean),
    });
  }
  return out;
}

async function enrich(job: Job): Promise<void> {
  const html = await fetchText(job.url);
  const main = html.match(/<main>([\s\S]*?)<h6[^>]*>\s*Gradovi/)?.[1] ?? html.match(/<main>([\s\S]*?)<\/main>/)?.[1] ?? "";
  const flags = [...main.matchAll(/<small class="([^"]*)">([\s\S]*?)<\/small>/g)].filter((f) => !/hidden/.test(f[1])).map((f) => clean(f[2]));
  if (flags.some((f) => /rad od ku/i.test(f))) job.remote = "remote";
  const body = main.replace(/<small[\s\S]*?<\/small>/g, "");
  const text = htmlToText(body);
  if (text) job.description = truncate(text);
  const cities = [...html.matchAll(/<span class="label label-primary[^"]*">([\s\S]*?)<\/span>/g)].map((c) => clean(c[1])).filter(Boolean);
  if (cities.length && !job.location) job.location = cities.join(", ");
  job.salary ??= salaryFromDescription(text) ?? undefined;
  job.tags = [...new Set([...job.tags, ...flags.filter((f) => !/rad od ku/i.test(f))])];
}

export async function search(ctx: SearchCtx): Promise<Job[]> {
  const { maxPages, maxDetails } = CONFIG.poslovirs;
  const jar = new CookieJar();
  await fetchText(`${BASE}/jobs`, { jar });
  const found = new Map<string, Job>();
  // N u /jobs_ajax/N je OFFSET u stavkama (ne broj strane): 0, 30, 60 …
  for (let page = 0; page < maxPages; page++) {
    const jobs = parseList(await fetchText(`${BASE}/jobs/jobs_ajax/${page * PAGE_SIZE}`, { jar, headers: { "X-Requested-With": "XMLHttpRequest" } }));
    let added = 0;
    for (const j of jobs) if (!found.has(j.id)) { found.set(j.id, j); added++; }
    ctx.log(`[poslovirs] offset=${page * PAGE_SIZE} results=${jobs.length} novih_u_listi=${added}`);
    await sleep(400);
    if (jobs.length < PAGE_SIZE || added === 0) break; // kraj liste ili se strane ponavljaju
  }
  // detalj samo za neviđene koji imaju šanse (naslov pogađa kategoriju ili je remote) – lista je cela ponuda sajta
  let details = 0;
  for (const j of found.values()) {
    if (ctx.isSeen(j.id) || details >= maxDetails) continue;
    if (j.remote !== "remote" && !titleHasCategory(j.title)) continue;
    details++;
    try { await enrich(j); } catch (e) { ctx.log(`[poslovirs] detalj ${j.id}: ${(e as Error).message}`); }
    await sleep(400);
  }
  ctx.log(`[poslovirs] ukupno ${found.size} oglasa, ${details} detalja skinuto`);
  return [...found.values()];
}
