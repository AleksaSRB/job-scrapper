/**
 * Plata: parsiranje teksta sa sajta / iz opisa, preračun u €/mes (za sortiranje), tekst za čip.
 * Preuzeto iz jobs/ (QA scraper) i prošireno za srpske oglase: „plata 70.000–90.000 din neto“, „zarada 600€“, „satnica 8 €“.
 * Namerno konzervativno: promašaj = nema čipa; plata se NIKAD ne izmišlja.
 */
import { CONFIG } from "./config.ts";
import type { Salary, SalaryPeriod } from "./types.ts";

const PER_MONTH: Record<SalaryPeriod, number> = { year: 1 / 12, month: 1, week: 52 / 12, day: 21, hour: 160 };

/** Gornja granica plate u €/mes (približno, kursevi iz CONFIG.fx); null = nije navedena / ne može pouzdano. */
export function salaryEurMonth(s: Salary | undefined): number | null {
  if (!s) return null;
  const top = s.max && s.max > 0 ? s.max : s.min;
  if (!top || top <= 0) return null;
  const rate = CONFIG.fx[s.currency ?? ""];
  if (!rate) return null;
  if (s.period === null && top >= 10_000 && top < 25_000 && s.currency !== "RSD") return null; // 12.000 može biti mesečno i godišnje
  // period nije naveden: 8 € je satnica, 600 € mesečno, 45.000 $ godišnje; u dinarima 1.500 je satnica, 80.000 mesečno
  const period: SalaryPeriod = s.period ?? (s.currency === "RSD" ? (top < 5_000 ? "hour" : "month") : top < 100 ? "hour" : top < 10_000 ? "month" : "year");
  return Math.round(top * rate * PER_MONTH[period]);
}

const ISO_CODE = new RegExp(`(?<![A-Za-z])(${Object.keys(CONFIG.fx).join("|")})(?![A-Za-z])`, "i");
const SYMBOLS: Array<[RegExp, string]> = [
  [/\b(din|dinara|rsd)\b/i, "RSD"], [/€|\beur[oa]?\b|\bevr[aoi]?\b/i, "EUR"], [/£/, "GBP"], [/zł/i, "PLN"], [/\bkm\b/i, "BAM"],
  [/US\$/, "USD"], [/CA?\$/, "CAD"], [/AU?\$/, "AUD"], [/(?<![A-Za-z])\$/, "USD"],
];

/** "120,000" | "1.200.000" | "55 000" -> hiljade; "31,2" | "7,500.00" | "5.500,00" -> decimale. */
function toNumber(token: string): number {
  const parts = token.replace(/[\s  ]/g, "").split(/[.,]/);
  if (parts.length === 1) return Number(parts[0]);
  const last = parts[parts.length - 1];
  if (last.length === 3 && parts[0].length <= 3 && parts[0] !== "0") return Number(parts.join(""));
  return Number(`${parts.slice(0, -1).join("")}.${last}`);
}

function periodOf(text: string): SalaryPeriod | null {
  if (/\b(hour|hr|hourly|satnic\w*|po satu|sat|sata|sati)\b|\/\s*h\b/i.test(text)) return "hour";
  if (/\b(month|monthly|mo|mesec\w*|mesecno|mjesec\w*)\b/i.test(text)) return "month";
  if (/\b(week|weekly|nedeljno|sedmicno)\b/i.test(text)) return "week";
  if (/\b(day|daily|dnevno|dnevnic\w*)\b/i.test(text)) return "day";
  if (/\b(year|yearly|annual|annually|annum|yr|godisnje|godina)\b/i.test(text)) return "year";
  return null;
}

/** "$100k – $120k" | "2000.00 - 3000.00 USD / Monthly" | "70.000 - 90.000 din" | "8 € po satu" -> Salary; bez cifara -> null. */
export function parseSalaryText(raw: string | null | undefined): Salary | null {
  if (!raw) return null;
  const text = raw.split("•")[0].trim();
  if (!/\d/.test(text)) return null;
  const currency = text.match(ISO_CODE)?.[1]?.toUpperCase() ?? SYMBOLS.find(([re]) => re.test(text))?.[1] ?? null;
  if (currency === null && text.includes("%")) return null;
  const nums: number[] = [];
  let suffixed = false;
  for (const m of text.matchAll(/(\d{1,3}(?:[   ]\d{3})+|\d+(?:[.,]\d+)*)\s*([kml])?(?![a-z])/gi)) {
    const suffix = (m[2] ?? "").toLowerCase();
    const mult = suffix === "k" ? 1e3 : suffix === "m" ? 1e6 : 1;
    const n = toNumber(m[1]) * mult;
    if (!Number.isFinite(n) || n <= 0) continue;
    if (mult > 1) suffixed = true;
    nums.push(n);
    if (nums.length === 2) break;
  }
  if (nums.length === 0) return null;
  const period = periodOf(text) ?? (suffixed ? "year" : null);
  return { min: Math.min(...nums), max: Math.max(...nums), currency, period, text: raw.trim() };
}

const D_CUR = String.raw`(?:[$€£]|\b(?:USD|EUR|GBP|RSD|CHF)\s?)`;
const D_NUM = String.raw`\d[\d,.]*\d\s?k?(?![\dmb+]|[.,]\d)|\d\s?k?(?![\dmb+]|[.,]\d)`;
const D_TAIL = String.raw`(?:\s?(?:USD|EUR|GBP|RSD|CHF|eur[oa]?|evra|din(?:ara)?|rsd|€|\$))?(?:\s?(?:neto|bruto|net|gross))?(?:\s?(?:\/|per|an?|po|mesecno|mesečno|godisnje|godišnje)\s?(?:hour|hr|year|yr|month|mo|annum|week|satu|sat|mesec\w*|mjesec\w*|nedelj\w*)?)?`;
const DESC_SALARY = new RegExp(
  String.raw`\b(?:salary|compensation|base pay|pay range|pay rate|rate|pay|fee|OTE|plata|zarada|primanja|honorar|satnica|naknada|iznos)\b[^\n$€£]{0,80}?` +
  `(${D_CUR}?\\s?(?:${D_NUM})${D_TAIL}(?:\\s?(?:-|–|—|to|do|and(?: up to)?)\\s?${D_CUR}?\\s?(?:${D_NUM}))?${D_TAIL})` +
  String.raw`(?!\s*(?:sign|bonus|stipend|allowance|budget|referral|godin|year|dan|day))`, "gi");

/** Plata napisana u tekstu opisa („Osnovna plata 75.000 din neto“, „Base salary: $80,000-$100,000 USD annually“). */
export function salaryFromDescription(text: string | undefined): Salary | null {
  if (!text) return null;
  for (const m of text.matchAll(DESC_SALARY)) {
    const s = parseSalaryText(m[1].replace(/[—–]/g, "-"));
    if (!s || !s.max || s.max < 3 || s.max > 2e6) continue;
    if (s.currency === null) continue;                       // „radno vreme 8-16“ i slično – bez valute ne nagađamo
    if (s.period === null && s.max < 100 && s.currency !== "RSD") s.period = "hour"; // "€8" u kontekstu plate = satnica
    if (s.period === null && s.max < 3_000 && s.currency === "RSD") continue; // premalo za bilo šta
    return s;
  }
  return null;
}

const SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };
const PERIOD_LABEL: Record<SalaryPeriod, string> = { year: "god", month: "mes", week: "ned", day: "dan", hour: "h" };
const short = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${+(n / 1e3).toFixed(1)}k` : String(+n.toFixed(n < 100 ? 1 : 0)));

/** Tekst plate za karticu: "€600–€800 /mes", "RSD 75k /mes", "$8 /h". "" = nije navedena. */
export function fmtSalary(s: Salary | undefined): string {
  if (!s) return "";
  const lo = s.min && s.min > 0 ? s.min : null, hi = s.max && s.max > 0 ? s.max : null;
  if (lo === null && hi === null) return s.text && s.text.length <= 30 ? s.text : "";
  const sym = s.currency ? SYMBOL[s.currency] ?? "" : "";
  const code = s.currency && !sym ? `${s.currency} ` : "";
  const range = lo !== null && hi !== null && lo !== hi ? `${code}${sym}${short(lo)}–${sym}${short(hi)}` : `${code}${sym}${short((hi ?? lo)!)}`;
  return s.period ? `${range} /${PERIOD_LABEL[s.period]}` : range;
}
