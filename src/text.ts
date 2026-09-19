/** Tekstualne pomoćne funkcije: bez dijakritika, mala slova – da regexi iz rules.json pogađaju i „podrška“ i „podrska“. */

const MAP: Record<string, string> = { š: "s", đ: "dj", č: "c", ć: "c", ž: "z", Š: "s", Đ: "dj", Č: "c", Ć: "c", Ž: "z" };

/** "Korisnička Podrška (m/ž)" -> "korisnicka podrska (m/z)" */
export function fold(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/[šđčćžŠĐČĆŽ]/g, (c) => MAP[c]).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Ćirilica -> latinica (Infostud/Poslovi.rs su latinica, ali LinkedIn zna da ima ćirilične oglase). */
const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", ђ: "đ", е: "e", ж: "ž", з: "z", и: "i", ј: "j", к: "k", л: "l", љ: "lj", м: "m", н: "n", њ: "nj",
  о: "o", п: "p", р: "r", с: "s", т: "t", ћ: "ć", у: "u", ф: "f", х: "h", ц: "c", ч: "č", џ: "dž", ш: "š",
};
export function latinize(s: string): string {
  return s.replace(/[Ѐ-ӿ]/g, (c) => { const l = CYR[c.toLowerCase()]; if (!l) return c; return c === c.toLowerCase() ? l : l[0].toUpperCase() + l.slice(1); });
}

export function compile(patterns: string[], what: string): RegExp[] {
  return patterns.map((p) => {
    try { return new RegExp(p, "i"); } catch (e) { throw new Error(`rules.json ${what}: loš regex "${p}" (${(e as Error).message})`); }
  });
}

/** Rečenica u kojoj je pogodak (za izuzetke tipa „engleski je plus“). */
export function sentenceAround(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf("\n", index), text.lastIndexOf(". ", index), text.lastIndexOf("• ", index)) + 1;
  let end = text.length;
  for (const sep of ["\n", ". ", "• "]) { const i = text.indexOf(sep, index); if (i >= 0 && i < end) end = i; }
  return text.slice(Math.max(0, start), end);
}

/** Prvih ~N znakova opisa, do kraja rečenice. */
export function firstSentences(text: string | undefined, max = 320): string {
  if (!text) return "";
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…").trim();
}

/** Firma bez pravne forme i interpunkcije: "Adecco Outsourcing d.o.o." -> "adeccooutsourcing". */
export function normCompany(s: string): string {
  return fold(s)
    .replace(/\b(d\.?o\.?o\.?|a\.?d\.?|inc|llc|ltd|limited|gmbh|ab|corp|corporation|co|company|sarl|srl|bv|plc|pty|sa|doo|ad|preduzece|agencija)\b\.?/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const TITLE_STOP = new Set(["m", "z", "mz", "remote", "serbian", "srpski", "speaking", "speaker", "jezik", "language", "with", "for", "za", "u", "i", "and", "the", "a", "an", "of", "in", "na", "sa", "position", "pozicija", "job", "posao", "hiring", "urgent", "hitno", "wanted", "needed", "full", "part", "time", "fulltime", "parttime", "hybrid", "hibrid", "beograd", "belgrade", "novi", "sad", "serbia", "srbija", "home", "from", "work"]);

/** Tokeni naslova bez šuma i zagrada, sortirani – da se "Serbian Customer Support Agent" i "Customer Support Agent (Serbian)" poklope. */
export function titleTokens(title: string): string[] {
  return [...new Set(fold(title).replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ").replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t && !TITLE_STOP.has(t)))].sort();
}

export function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const B = new Set(b);
  const inter = a.filter((t) => B.has(t)).length;
  return inter / (a.length + b.length - inter);
}
