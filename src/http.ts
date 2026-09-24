import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { UA } from "./config.ts";

const execFileAsync = promisify(execFile);

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Hostovi za koje je Node fetch dobio Cloudflare challenge -> dalje idu direktno preko curl-a. */
const curlHosts = new Set<string>();

function looksLikeCloudflareChallenge(status: number, body: string): boolean {
  return (status === 403 || status === 503) && /Just a moment|cf-chl|challenge-platform/i.test(body);
}

const ACCEPT = "text/html,application/xhtml+xml,application/json,application/rss+xml,*/*;q=0.8";
const LANG = "sr-RS,sr;q=0.9,en-US;q=0.8,en;q=0.7";

/** Minimalna tegla za kolačiće (Poslovi.rs drži filter pretrage u sesiji). */
export class CookieJar {
  private cookies = new Map<string, string>();
  store(res: Response): void {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header(): string { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "); }
}

export interface FetchOpts {
  tries?: number;
  headers?: Record<string, string>;
  jar?: CookieJar;
  method?: "GET" | "POST";
  body?: string;
}

/** Isti trik kao kod stanova: gde Cloudflare blokira Node-ov TLS otisak, curl.exe (System32) često prolazi. */
async function fetchTextViaCurl(url: string): Promise<string> {
  const { stdout } = await execFileAsync("curl.exe", [
    "-sS", "-L", "--compressed", "--max-time", "30", "-A", UA,
    "-H", `Accept-Language: ${LANG}`, "-H", `Accept: ${ACCEPT}`,
    "-w", "\n__HTTP_STATUS__:%{http_code}",
    url,
  ], { maxBuffer: 64 * 1024 * 1024, encoding: "utf8", windowsHide: true });
  const m = stdout.match(/\n__HTTP_STATUS__:(\d+)\s*$/);
  const status = m ? Number(m[1]) : 0;
  const body = m ? stdout.slice(0, m.index) : stdout;
  if (status < 200 || status >= 300) throw new Error(`curl HTTP ${status}`);
  return body;
}

export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const tries = opts.tries ?? 3;
  const host = new URL(url).host;
  let lastErr: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      if (curlHosts.has(host) && !opts.jar && !opts.body) return await fetchTextViaCurl(url);
      const headers: Record<string, string> = { "User-Agent": UA, "Accept": ACCEPT, "Accept-Language": LANG, ...(opts.headers ?? {}) };
      if (opts.jar) { const c = opts.jar.header(); if (c) headers["Cookie"] = c; }
      if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/x-www-form-urlencoded";
      const res = await fetch(url, {
        method: opts.method ?? (opts.body ? "POST" : "GET"),
        headers, body: opts.body, redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
      opts.jar?.store(res);
      const body = await res.text();
      if (looksLikeCloudflareChallenge(res.status, body)) {
        if (opts.jar || opts.body) throw new Error(`Cloudflare challenge (HTTP ${res.status})`);
        curlHosts.add(host);
        return await fetchTextViaCurl(url);
      }
      if (res.status === 429) throw new Error("HTTP 429 (rate limit)");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return body;
    } catch (e) {
      lastErr = e;
      if (i < tries) await sleep(2_000 * i);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchJson<T = any>(url: string, opts: FetchOpts = {}): Promise<T> {
  const body = await fetchText(url, opts);
  try { return JSON.parse(body) as T; } catch { throw new Error(`nije JSON: ${body.slice(0, 120).replace(/\s+/g, " ")}`); }
}

/** JSON objekat/niz koji počinje na `start` u tekstu (npr. `QuidditaEnvironment.serverListData={...};` na halooglasi.com). */
export function extractJson(text: string, start: number): unknown {
  const open = text[start];
  if (open !== "{" && open !== "[") throw new Error("nije početak JSON-a");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") { depth--; if (depth === 0) return JSON.parse(text.slice(start, i + 1)); }
  }
  throw new Error("JSON nije zatvoren");
}

/** `<script id="__NEXT_DATA__">` -> props.pageProps (Infostud). */
export function nextData<T = any>(html: string): T | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1])?.props?.pageProps ?? null; } catch { return null; }
}

// ---------------------------------------------------------------- parsiranje

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&scaron;/g, "š").replace(/&Scaron;/g, "Š").replace(/&ndash;/g, "–").replace(/&mdash;/g, "—")
    .replace(/&eacute;/g, "é").replace(/&amp;/g, "&");
}

/** Opis u bazi se skraćuje; platu iz teksta vaditi PRE skraćivanja. */
export const DESCRIPTION_MAX = 6000;
export const truncate = (text: string, max = DESCRIPTION_MAX) => (text.length > max ? text.slice(0, max) + "…" : text);

/** HTML -> čist tekst. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n").replace(/<li[^>]*>/gi, "• ").replace(/<\/(p|div|li|h\d|ul|ol|tr|section|article)>/gi, "\n").replace(/<[^>]+>/g, ""),
  ).replace(/[ \t ]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

export interface RssItem {
  get(tag: string): string;
  attr(tag: string, name: string): string;
}

/** Minimalan RSS parser: deli po <item> i vadi tagove regexom. */
export function rssItems(xml: string): RssItem[] {
  return xml.split(/<item[\s>]/).slice(1).map((raw) => ({
    get(tag) {
      const m = raw.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
      if (!m) return "";
      const cdata = m[1].match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
      return (cdata ? cdata[1] : decodeEntities(m[1])).trim();
    },
    attr(tag, name) {
      const m = raw.match(new RegExp(`<${tag}\\s[^>]*?${name}="([^"]*)"`));
      return m ? decodeEntities(m[1]) : "";
    },
  }));
}

/** Bilo šta što `new Date()` razume ili unix sekunde -> UTC ISO, inače null. */
export function toIso(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "15.09.2026" | "15.09.2026." | "2026-09-15" -> ISO (ponoć po lokalnom vremenu), inače null. */
export function dateSrToIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) { const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) { const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
  return null;
}

/** "3 days ago" | "1 week ago" | "2 hours ago" | "pre 3 dana" -> ISO (približno), inače null. */
export function relativeToIso(s: string | null | undefined, now = Date.now()): string | null {
  if (!s) return null;
  const m = s.toLowerCase().match(/(\d+)\s*(minute|min|hour|hr|day|week|month|sat|dan|nedelj|mesec)/);
  if (!m) return /just now|upravo|today|danas/i.test(s) ? new Date(now).toISOString() : null;
  const n = Number(m[1]);
  const unit = m[2];
  const ms = /^min/.test(unit) ? 60_000 : /^(hour|hr|sat)/.test(unit) ? 3_600_000 : /^(day|dan)/.test(unit) ? 86_400_000 : /^(week|nedelj)/.test(unit) ? 7 * 86_400_000 : 30 * 86_400_000;
  return new Date(now - n * ms).toISOString();
}
