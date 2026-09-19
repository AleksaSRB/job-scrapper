/**
 * We Work Remotely – zvaničan RSS po kategoriji (provereno 19.09.2026):
 *   https://weworkremotely.com/categories/<remote-customer-support-jobs|remote-sales-and-marketing-jobs|all-other-remote-jobs|…>.rss
 *   <title> je "Firma: Pozicija"; <region> (Anywhere in the World / Europe Only / USA Only…), <type> (Full-Time/Contract), <category>,
 *   <description> ceo HTML opis, <pubDate>, media:content logo. Plate nema kao polje – vadi se iz teksta.
 */
import { CONFIG } from "../config.ts";
import { fetchText, htmlToText, rssItems, sleep, toIso, truncate } from "../http.ts";
import { salaryFromDescription } from "../salary.ts";
import type { EmploymentKind, Job, SearchCtx } from "../types.ts";

function employmentOf(type: string): EmploymentKind[] {
  const t = type.toLowerCase();
  if (t.includes("part")) return ["part-time"];
  if (t.includes("full")) return ["full-time"];
  if (t.includes("contract") || t.includes("freelance")) return ["contract"];
  return [];
}

export async function search(ctx: SearchCtx): Promise<Job[]> {
  const out = new Map<string, Job>();
  let failed = 0;
  for (const feed of CONFIG.wwr.feeds) {
    try {
      const items = rssItems(await fetchText(`https://weworkremotely.com/categories/${feed}.rss`));
      let n = 0;
      for (const it of items) {
        const link = it.get("link") || it.get("guid");
        const full = it.get("title");
        if (!link || !full) continue;
        const sep = full.indexOf(": ");
        const text = htmlToText(it.get("description"));
        const region = it.get("region"), country = it.get("country");
        const job: Job = {
          source: "wwr",
          id: `wwr:${new URL(link).pathname.replace(/\/+$/, "").split("/").pop()}`,
          url: link,
          title: (sep > 0 ? full.slice(sep + 2) : full).trim(),
          company: sep > 0 ? full.slice(0, sep).trim() : "",
          companyLogo: it.attr("media:content", "url") || undefined,
          location: [region, country].filter(Boolean).join(", "),
          remote: "remote",
          employment: employmentOf(it.get("type")),
          salary: salaryFromDescription(text) ?? undefined,
          postedAt: toIso(it.get("pubDate")),
          description: truncate(text),
          tags: [it.get("category"), ...it.get("skills").split(",")].map((s) => s.trim()).filter(Boolean),
        };
        if (!out.has(job.id)) { out.set(job.id, job); n++; }
      }
      ctx.log(`[wwr] ${feed}: ${items.length} stavki, ${n} novih u listi`);
    } catch (e) {
      ctx.log(`[wwr] ${feed}: ${(e as Error).message}`);
      if (++failed === CONFIG.wwr.feeds.length) throw e;
    }
    await sleep(500);
  }
  return [...out.values()];
}
