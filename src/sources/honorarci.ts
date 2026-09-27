/**
 * Honorarci.rs – „srpska platforma za honorarne poslove“ (provereno 28.09.2026). Next.js sa javnim JSON API-jem, bez zaštite.
 * Najveći deo sajta su ljudi koji NUDE usluge (časovi, majstori, pisanje radova); poslodavci su u kategoriji „Ponuda poslova“ (~7 aktivnih),
 * a i tu se nađe osoba koja traži posao („Zaposlena sam … tražim dodatni honorarni angažman“ – to obara rules.json, grupa „osoba traži posao“).
 *   lista:  GET https://honorarci.rs/api/ads?category=ponuda-poslova&limit=20[&cursor=<nextCursor>]  -> { items[], nextCursor }
 *           items[]: id, slug, title, city, municipality, worksOnline (radi online / od kuće), worksAllSerbia, priceAmount + priceCurrency +
 *                    priceType ("fixed" | "na_upit"), categoryName, createdAt / renewedAt (ISO, UTC), author.displayName, imageUrl (relativan)
 *   detalj: GET https://honorarci.rs/api/ads/<id>  -> isto + description (pun tekst, bez HTML-a)
 *   web:    https://honorarci.rs/oglasi/<slug>   (/oglas/<…> vraća 308)
 * worksOnline = polje sajta za rad od kuće -> remote; radno vreme nema polje (tekst). Plata: priceAmount (RSD) – period nepoznat, pa ide kroz tekst.
 */
import { CONFIG } from "../config.ts";
import { fetchJson, sleep, toIso, truncate } from "../http.ts";
import { salaryFromDescription } from "../salary.ts";
import { titleRejected } from "../score.ts";
import type { Job, SearchCtx } from "../types.ts";

const BASE = "https://honorarci.rs";
const DEFAULTS = { category: "ponuda-poslova", maxPages: 5, maxDetails: 20, delayMs: 800 };

interface Ad {
  id: number; slug: string; title: string; description?: string; city?: string | null; municipality?: string | null;
  worksOnline?: boolean; worksAllSerbia?: boolean; priceAmount?: number | null; priceCurrency?: string | null; priceType?: string | null;
  categoryName?: string; createdAt?: string; renewedAt?: string | null; imageUrl?: string | null; author?: { displayName?: string } | null;
}

function toJob(a: Ad): Job {
  const place = [a.city, a.municipality].filter(Boolean).join(", ");
  const price = a.priceAmount && a.priceAmount > 0 ? `${a.priceAmount.toLocaleString("sr-RS")} ${a.priceCurrency ?? "RSD"}` : "";
  return {
    source: "honorarci", id: `honorarci:${a.id}`, url: `${BASE}/oglasi/${a.slug}`, title: (a.title ?? "").trim(),
    company: (a.author?.displayName ?? "").trim(),
    companyLogo: a.imageUrl ? `${BASE}${a.imageUrl}` : undefined,
    location: a.worksAllSerbia ? "Cela Srbija" : place,
    remote: a.worksOnline ? "remote" : "unknown",
    employment: [],
    postedAt: toIso(a.renewedAt || a.createdAt),
    description: a.description ? truncate(a.description.trim()) : undefined,
    tags: [a.categoryName ?? "", a.worksOnline ? "Radi online" : "", price ? `cena ${price}` : ""].filter(Boolean),
  };
}

export async function search(ctx: SearchCtx): Promise<Job[]> {
  const o = { ...DEFAULTS, ...((CONFIG as any).honorarci ?? {}) };
  const found = new Map<string, Ad>();
  let cursor: string | number | null = null;
  for (let page = 1; page <= o.maxPages; page++) {
    const url = `${BASE}/api/ads?category=${encodeURIComponent(o.category)}&limit=20${cursor !== null ? `&cursor=${encodeURIComponent(String(cursor))}` : ""}`;
    const res = await fetchJson<{ items?: Ad[]; nextCursor?: string | number | null }>(url, { headers: { Accept: "application/json" } });
    const items = res.items ?? [];
    for (const a of items) if (a?.id && !found.has(String(a.id))) found.set(String(a.id), a);
    ctx.log(`[honorarci] page=${page} results=${items.length}`);
    cursor = res.nextCursor ?? null;
    if (!cursor || items.length === 0) break;
    await sleep(o.delayMs);
  }
  const out: Job[] = [];
  let details = 0;
  for (const a of found.values()) {
    const base = toJob(a);
    if (ctx.isSeen(base.id) || titleRejected(base.title)) { out.push(base); continue; }
    if (details >= o.maxDetails) continue; // ostaje neviđen -> sledeći prolaz
    details++;
    await sleep(o.delayMs);
    try {
      const d = await fetchJson<Ad>(`${BASE}/api/ads/${a.id}`, { headers: { Accept: "application/json" } });
      const job = toJob({ ...a, ...d, author: d.author ?? a.author });
      job.salary = salaryFromDescription(job.description ?? "") ?? undefined;
      out.push(job);
    } catch (e) { ctx.log(`[honorarci] detalj ${a.id}: ${(e as Error).message}`); }
  }
  ctx.log(`[honorarci] ukupno ${found.size} oglasa, ${details} detalja skinuto`);
  return out;
}
