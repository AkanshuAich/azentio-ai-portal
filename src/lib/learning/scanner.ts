// Heuristic scan for content that should not be shared. This is a prompt for human review and NOT a
// privacy guarantee: it misses things, and a clean scan never means safe to publish.

export type FlagKind =
  | "email" | "phone" | "iban" | "card_number" | "account_number" | "url"
  | "currency_amount" | "exact_date" | "credential" | "known_name";

export interface Flag {
  kind: FlagKind;
  /** The matched text, for the reviewer. It is never stored; only the kinds are. */
  match: string;
  hint: string;
}

const HINT: Record<FlagKind, string> = {
  email: "Looks like an email address (a person or customer identifier).",
  phone: "Looks like a phone number.",
  iban: "Looks like an IBAN or bank account identifier.",
  card_number: "Looks like a payment card number.",
  account_number: "A long run of digits that could be an account or reference number.",
  url: "Contains a link that could identify a customer or system.",
  currency_amount: "An exact monetary amount. Consider rounding or describing it in relative terms.",
  exact_date: "An exact date that could identify an event or customer. Consider a period instead.",
  credential: "Looks like a password, key or secret.",
  known_name: "Contains the name of a known client organisation.",
};

const CURRENCY = "USD|EUR|GBP|AED|SAR|QAR|KWD|BHD|OMR|INR|PKR|PHP|MYR|IDR|SGD|ZAR|ETB|ZMW";

const luhn = (digits: string): boolean => {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Scans text and returns every flag. `knownNames` are client and customer names to look for. */
export function scanText(text: string, opts: { knownNames?: string[] } = {}): Flag[] {
  const flags: Flag[] = [];
  const add = (kind: FlagKind, match: string) => flags.push({ kind, match: match.trim(), hint: HINT[kind] });

  for (const m of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) add("email", m[0]);
  for (const m of text.matchAll(/\bhttps?:\/\/\S+/gi)) add("url", m[0]);
  for (const m of text.matchAll(/\b(?:password|passwd|pwd|secret|api[_ -]?key|token)\b\s*[:=]\s*\S+/gi)) add("credential", m[0]);
  for (const m of text.matchAll(/\bsk-[A-Za-z0-9]{16,}\b/g)) add("credential", m[0]);
  for (const m of text.matchAll(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g)) add("iban", m[0]);

  const taken = new Set<string>();
  for (const m of text.matchAll(/\b\d(?:[ -]?\d){12,18}\b/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) { add("card_number", m[0]); taken.add(m[0]); }
  }
  for (const m of text.matchAll(/(?<![\d.])\d{8,17}(?![\d.])/g)) if (!taken.has(m[0])) add("account_number", m[0]);

  // Digit groups joined by spaces, dots, dashes or brackets, or a leading +. A bare run of digits is an
  // account-number candidate instead, so a separator (or +) is required here.
  for (const m of text.matchAll(/(?<![\w.])\+?\d[\d ().-]{7,18}\d(?![\w.])/g)) {
    const n = m[0].replace(/\D/g, "").length;
    if (n >= 9 && n <= 15 && (m[0].startsWith("+") || /[ ().-]/.test(m[0]))) add("phone", m[0]);
  }

  for (const m of text.matchAll(new RegExp(`(?:[$€£]\\s?|\\b(?:${CURRENCY})\\s?)\\d[\\d,]*(?:\\.\\d+)?(?:\\s?(?:k|m|mn|bn|million|billion)\\b)?`, "gi"))) add("currency_amount", m[0]);
  for (const m of text.matchAll(new RegExp(`\\b\\d[\\d,]*(?:\\.\\d+)?\\s?(?:${CURRENCY})\\b`, "gi"))) add("currency_amount", m[0]);

  for (const m of text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) add("exact_date", m[0]);
  for (const m of text.matchAll(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g)) add("exact_date", m[0]);
  for (const m of text.matchAll(/\b\d{1,2}(?:st|nd|rd|th)?\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,?\s\d{4}\b/gi)) add("exact_date", m[0]);

  for (const name of opts.knownNames ?? []) {
    if (name.trim().length < 3) continue;
    for (const m of text.matchAll(new RegExp(`\\b${escapeRe(name.trim())}\\b`, "gi"))) add("known_name", m[0]);
  }

  // De-duplicate identical kind+match pairs.
  const seen = new Set<string>();
  return flags.filter((f) => { const k = `${f.kind}:${f.match.toLowerCase()}`; return seen.has(k) ? false : (seen.add(k), true); });
}

/** The distinct kinds found across several fields: this is what is stored on the record. */
export function flagKinds(fields: Array<string | null | undefined>, opts: { knownNames?: string[] } = {}): FlagKind[] {
  const kinds = new Set<FlagKind>();
  for (const f of fields) if (f) for (const x of scanText(f, opts)) kinds.add(x.kind);
  return [...kinds];
}

export const SCAN_DISCLAIMER =
  "An automated scan is not a privacy guarantee. It can miss identifying detail, so a person reviews everything before it is shared.";
