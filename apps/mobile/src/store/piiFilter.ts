/**
 * PII (Personally Identifiable Information) filter
 *
 * Detects and redacts sensitive data before sending to AI endpoints.
 * All processing is local — nothing leaves the device.
 *
 * Supported patterns:
 *  - API / secret keys        sk-xxx, Bearer tokens, AWS AKIA, Google AIza, GitHub ghp_
 *  - Chinese phone numbers    13x/14x/15x/16x/17x/18x/19x
 *  - Chinese ID numbers       18-digit resident ID
 *  - Email addresses
 *  - Credit card numbers      Visa/MC/Amex/UnionPay (strict format)
 *  - IPv4 addresses (private) 192.168.x.x, 10.x.x.x, 172.16-31.x.x
 *
 * Design notes:
 *  - The same value always maps to the same placeholder (e.g. a phone number
 *    appearing three times gets [PHONE_1] each time) so the caller can correlate.
 *  - All occurrences of a value are replaced, not just the first (fix P-1).
 *  - Overlapping matches are resolved by keeping the earlier / longer one (fix P-5).
 *  - Private IPv4 detection is conservative (RFC-1918 only) to avoid false positives.
 */

export interface PiiMatch {
  type: string;
  original: string;
  placeholder: string;
  start: number;
  end: number;
}

export interface FilterResult {
  redacted: string;
  matches: PiiMatch[];
}

interface PiiRule {
  type: string;
  pattern: RegExp;
  placeholder: (n: number) => string;
}

// Fix P-4: extended API key patterns to cover major cloud providers.
// Fix P-2: credit card pattern tightened to standard card formats with Luhn-compatible lengths.
const RULES: PiiRule[] = [
  {
    type: "API_KEY",
    // sk- (OpenAI/compatible), sk-ant- (Anthropic), Bearer token,
    // AKIA (AWS access key), AIza (Google API key), ghp_/github_pat_ (GitHub)
    pattern: /(?:sk-(?:ant-)?[A-Za-z0-9_\-]{20,}|Bearer\s+[A-Za-z0-9._\-]{20,}|AKIA[A-Z0-9]{16}|AIza[0-9A-Za-z\-_]{35}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,})/g,
    placeholder: (n) => `[API_KEY_${n}]`,
  },
  {
    type: "PHONE",
    pattern: /(?<!\d)(1[3-9]\d{9})(?!\d)/g,
    placeholder: (n) => `[PHONE_${n}]`,
  },
  {
    type: "ID_CARD",
    pattern: /(?<!\d)([1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx])(?!\d)/g,
    placeholder: (n) => `[ID_CARD_${n}]`,
  },
  {
    type: "EMAIL",
    pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    placeholder: (n) => `[EMAIL_${n}]`,
  },
  {
    // Fix P-2: strict per-network format instead of permissive \d{1,7} tail.
    // Visa: 4xxx xxxx xxxx xxxx (16 digits)
    // Mastercard: 5[1-5]xx xxxx xxxx xxxx (16 digits)
    // Amex: 3[47]xx xxxxxx xxxxx (15 digits)
    // UnionPay: 62xx xxxx xxxx xxxx[xxx] (16–19 digits)
    type: "CREDIT_CARD",
    pattern: /(?<!\d)(?:4\d{3}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}|5[1-5]\d{2}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}|3[47]\d{2}[- ]?\d{6}[- ]?\d{5}|62\d{2}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4,7})(?!\d)/g,
    placeholder: (n) => `[CARD_${n}]`,
  },
  {
    // RFC-1918 private IPv4 ranges only (conservative — avoids false positives on public IPs).
    type: "PRIVATE_IP",
    pattern: /(?<![.\d])(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})(?![.\d])/g,
    placeholder: (n) => `[PRIVATE_IP_${n}]`,
  },
];

/**
 * Scan text for PII and return matches with their positions.
 *
 * Fix P-1: ALL occurrences of a value are captured (not just the first).
 *          Identical values reuse the same placeholder for easy correlation.
 * Fix P-3: Counter is per-type and increments only when a NEW unique value is seen.
 * Fix P-5: Overlapping matches are resolved (earlier start wins; ties go to longer match).
 */
export function detectPii(text: string): PiiMatch[] {
  const matches: PiiMatch[] = [];

  // Map from "TYPE:value" → placeholder string, so each unique value gets one label.
  const valueToPlaceholder = new Map<string, string>();
  // Per-type counters for sequential placeholder numbering.
  const counters: Record<string, number> = {};

  for (const rule of RULES) {
    // Clone the regex so exec() state resets between calls.
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    let m: RegExpExecArray | null;

    while ((m = re.exec(text)) !== null) {
      const key = `${rule.type}:${m[0]}`;

      let placeholder: string;
      if (valueToPlaceholder.has(key)) {
        // Reuse the same placeholder — every occurrence of the same PII gets the same label.
        placeholder = valueToPlaceholder.get(key)!;
      } else {
        counters[rule.type] = (counters[rule.type] ?? 0) + 1;
        placeholder = rule.placeholder(counters[rule.type]);
        valueToPlaceholder.set(key, placeholder);
      }

      matches.push({
        type: rule.type,
        original: m[0],
        placeholder,
        start: m.index,
        end: m.index + m[0].length,
      });
    }
  }

  // Sort by start position; ties resolved by preferring the longer match.
  matches.sort((a, b) =>
    a.start !== b.start ? a.start - b.start : b.end - a.end,
  );

  // Fix P-5: Remove overlapping matches (keep the first/longer, skip anything it covers).
  const deoverlapped: PiiMatch[] = [];
  let lastEnd = -1;
  for (const match of matches) {
    if (match.start >= lastEnd) {
      deoverlapped.push(match);
      lastEnd = match.end;
    }
  }

  return deoverlapped;
}

/**
 * Replace detected PII with placeholders.
 * Returns the redacted text and the list of replacements made.
 * Replaces right-to-left to preserve position indices.
 */
export function redactPii(text: string): FilterResult {
  const matches = detectPii(text);
  if (matches.length === 0) return { redacted: text, matches: [] };

  let result = text;
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i]!;
    result = result.slice(0, match.start) + match.placeholder + result.slice(match.end);
  }

  return { redacted: result, matches };
}
