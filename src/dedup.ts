/**
 * Spajanje istog oglasa sa više sajtova (i repost-ova iste firme):
 *   1. isti id (Startuj/HelloWorld dele Infostud id-jeve -> "infostud:<id>")
 *   2. tačan ključ firma|sortirani-tokeni-naslova ("Serbian Customer Support Agent" ≈ "Customer Support Agent (Serbian)")
 *   3. ista firma + naslovi sa Jaccard ≥ 0.6 po tokenima (fuzzy)
 */
import { jaccard, normCompany, titleTokens } from "./text.ts";
import type { Job, StoredJob } from "./types.ts";

export const FUZZY_MIN = 0.6;

/** Firma je na nekoj od listi sakrivenih (config.json blockedCompanies / db.json blockedCompanies / „sakrij firmu“ u UI-ju). */
export function companyBlocked(company: string, lists: string[][]): boolean {
  const c = normCompany(company);
  return !!c && lists.some((l) => l.some((b) => normCompany(b) === c));
}

export function dedupKey(job: Pick<Job, "company" | "title">): string | null {
  const company = normCompany(job.company);
  if (!company) return null;
  const tokens = titleTokens(job.title);
  return tokens.length ? `${company}|${tokens.join(" ")}` : null;
}

export class DedupIndex {
  private byKey = new Map<string, StoredJob>();
  private byCompany = new Map<string, StoredJob[]>();

  constructor(jobs: Iterable<StoredJob>) { for (const j of jobs) this.add(j); }

  add(j: StoredJob): void {
    const k = dedupKey(j);
    if (k && !this.byKey.has(k)) this.byKey.set(k, j);
    const c = normCompany(j.company);
    if (c) { const arr = this.byCompany.get(c) ?? []; arr.push(j); this.byCompany.set(c, arr); }
  }

  /** Oglas iz baze koji je „isti“ kao `job`, ili undefined. */
  find(job: Job): StoredJob | undefined {
    const k = dedupKey(job);
    if (k) { const exact = this.byKey.get(k); if (exact) return exact; }
    const c = normCompany(job.company);
    if (!c) return undefined;
    const tokens = titleTokens(job.title);
    if (tokens.length < 2) return undefined;
    let best: StoredJob | undefined, bestScore = 0;
    for (const cand of this.byCompany.get(c) ?? []) {
      const s = jaccard(tokens, titleTokens(cand.title));
      if (s >= FUZZY_MIN && s > bestScore) { best = cand; bestScore = s; }
    }
    return best;
  }
}
