/**
 * Startuj Infostud – SSR HTML (provereno 19.09.2026). Ista baza oglasa kao poslovi.infostud.com (isti id-jevi),
 * ali sa listama koje nas zanimaju: /honorarni-poslovi, /poslovi-za-mlade (+ ?page=N).
 *   lista: <div class="px-4 job-card-item" id="job-<id>"> … <a href="/posao/<slug>-<id>" … data-job_employment_type_id="8">
 *          <h2>naslov</h2> <h3>firma</h3>
 * Detalj se čita sa Infostud-a (/posao/x/y/<id>, isti JSON), pa je id "infostud:<id>" – Infostud i Startuj se ne dupliraju.
 */
import { CONFIG } from "../config.ts";
import { decodeEntities, fetchText, sleep } from "../http.ts";
import type { Job, SearchCtx } from "../types.ts";
import { fetchDetail, jobId } from "./infostud.ts";

const BASE = "https://startuj.infostud.com";

export async function search(ctx: SearchCtx): Promise<Job[]> {
  const { paths, maxPages } = CONFIG.startuj;
  const found = new Map<string, { id: string; title: string; company: string; honorarni: boolean }>();
  for (const path of paths) {
    for (let page = 1; page <= maxPages; page++) {
      const html = await fetchText(`${BASE}${path}${page > 1 ? `?page=${page}` : ""}`);
      let n = 0;
      for (const m of html.matchAll(/id="job-(\d+)"[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/g)) {
        const id = jobId(m[1]);
        if (found.has(id)) continue;
        found.set(id, { id: m[1], title: decodeEntities(m[2]).replace(/\s+/g, " ").trim(), company: decodeEntities(m[3]).replace(/\s+/g, " ").trim(), honorarni: path.includes("honorarni") });
        n++;
      }
      ctx.log(`[startuj] ${path} page=${page} novih_u_listi=${n}`);
      await sleep(400);
      if (n === 0 || !html.includes(`?page=${page + 1}`)) break;
    }
  }
  const out: Job[] = [];
  for (const [id, f] of found) {
    if (ctx.isSeen(id)) continue; // već u bazi/viđen preko Infostud-a ili ranije
    try {
      const job = await fetchDetail(f.id, undefined, "startuj");
      if (!job) continue;
      if (f.honorarni) job.tags = [...job.tags, "honorarni posao (Startuj)"];
      else job.tags = [...job.tags, "poslovi za mlade (Startuj)"];
      out.push(job);
    } catch (e) { ctx.log(`[startuj] detalj ${f.id}: ${(e as Error).message}`); }
    await sleep(350);
  }
  ctx.log(`[startuj] ${found.size} u listama, ${out.length} neviđenih sa detaljem`);
  return out;
}
