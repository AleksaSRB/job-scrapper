/**
 * Jooble – sajt rs.jooble.org je iza Cloudflare challenge-a (curl i Node padaju, provereno 19.09.2026),
 * pa se koristi samo zvaničan API sa ključem: POST https://jooble.org/api/<key>  {keywords, location, page}
 *   -> { totals, jobs: [{ id, title, location, snippet, salary, source, type, link, company, updated }] }
 * Ključ se traži besplatno na https://jooble.org/api/about i upisuje u config.json -> jooble.apiKey; dok ga nema, izvor je isključen.
 * NAPOMENA: API nije testiran uživo (nema ključa) – ako i on vraća Cloudflare stranu, izvor ostaje isključen.
 */
import { CONFIG } from "../config.ts";
import { fetchText, htmlToText, sleep, toIso, truncate } from "../http.ts";
import { parseSalaryText } from "../salary.ts";
import type { EmploymentKind, Job, SearchCtx } from "../types.ts";

interface ApiJob { id: number | string; title: string; location?: string; snippet?: string; salary?: string; source?: string; type?: string; link: string; company?: string; updated?: string }

function employmentOf(t: string | undefined): EmploymentKind[] {
  const s = (t ?? "").toLowerCase();
  if (/part|nepuno|honorar/.test(s)) return ["part-time"];
  if (/full|puno/.test(s)) return ["full-time"];
  if (/contract|ugovor/.test(s)) return ["contract"];
  return [];
}

export async function search(ctx: SearchCtx): Promise<Job[]> {
  const { apiKey, location, queries } = CONFIG.jooble;
  if (!apiKey) throw new Error("jooble.apiKey nije podešen u config.json (ključ: https://jooble.org/api/about)");
  const out = new Map<string, Job>();
  for (const q of queries) {
    const body = await fetchText(`https://jooble.org/api/${encodeURIComponent(apiKey)}`, {
      method: "POST", body: JSON.stringify({ keywords: q, location, page: 1 }), headers: { "Content-Type": "application/json" }, tries: 2,
    });
    let res: { totals?: number; jobs?: ApiJob[] };
    try { res = JSON.parse(body); } catch { throw new Error(`nije JSON: ${body.slice(0, 100).replace(/\s+/g, " ")}`); }
    const jobs = res.jobs ?? [];
    for (const j of jobs) {
      const id = `jooble:${j.id}`;
      if (out.has(id)) continue;
      const text = htmlToText(j.snippet ?? "");
      out.set(id, {
        source: "jooble", id, url: j.link, title: (j.title ?? "").trim(), company: (j.company ?? "").trim(),
        location: (j.location ?? "").trim(), remote: "unknown", employment: employmentOf(j.type),
        salary: parseSalaryText(j.salary) ?? undefined, postedAt: toIso(j.updated),
        description: truncate(text), tags: [j.source ?? ""].filter(Boolean),
      });
    }
    ctx.log(`[jooble] q="${q}" results=${jobs.length} total=${res.totals ?? "?"}`);
    await sleep(800);
  }
  return [...out.values()];
}
