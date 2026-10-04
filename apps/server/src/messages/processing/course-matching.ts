/** A course as exposed to the matcher (no Mongo document needed). */
export interface CourseHint {
  id: string;
  code: string;
  name: string;
  aliases: string[];
}

export interface CourseMatch {
  hint: CourseHint;
  /** 1 = exact, lower = fuzzy. */
  score: number;
  /** Character edits needed for a fuzzy match; 0 when the match was exact. */
  edits: number;
  matchedOn: 'code' | 'name' | 'alias';
}

/** Below this score a course is not considered a match. */
export const MIN_COURSE_MATCH_SCORE = 0.75;

export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

/** Levenshtein distance, iterative to keep memory flat. */
export function editDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }

  let previous = Array.from({ length: b.length + 1 }, (_value, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution =
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(
        (previous[j] ?? Number.POSITIVE_INFINITY) + 1,
        (current[j - 1] ?? Number.POSITIVE_INFINITY) + 1,
        substitution,
      );
    }
    previous = current;
  }

  return previous[b.length] ?? 0;
}

/** 1 = identical, 0 = completely different. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) {
    return 1;
  }
  return 1 - editDistance(a, b) / longest;
}

function candidatesOf(hint: CourseHint): { value: string; matchedOn: 'code' | 'name' | 'alias' }[] {
  return [
    { value: hint.code, matchedOn: 'code' as const },
    { value: hint.name, matchedOn: 'name' as const },
    ...hint.aliases.map((alias) => ({ value: alias, matchedOn: 'alias' as const })),
  ];
}

/** Generic words that must never identify a course on their own. */
const GENERIC_COURSE_WORDS = new Set([
  'system',
  'systems',
  'lab',
  'labs',
  'theory',
  'science',
  'math',
  'maths',
]);

/** Candidate plus its individual words, so "Operating Systems" matches "Operatng". */
function candidateForms(value: string): string[] {
  const forms = new Set<string>([normalizeText(value)]);
  for (const token of tokenize(value)) {
    const normalized = normalizeText(token);
    if (!GENERIC_COURSE_WORDS.has(normalized)) {
      forms.add(normalized);
    }
  }
  return [...forms].filter((form) => form.length >= 3);
}

/**
 * Finds the course a free-text mention refers to: exact code/name/alias first,
 * then fuzzy matching that tolerates typos ("DBS" -> "DBMS") and punctuation.
 */
export function matchCourse(rawText: string, courses: CourseHint[]): CourseMatch | null {
  const normalizedText = normalizeText(rawText);
  if (normalizedText.length === 0) {
    return null;
  }

  const textTokens = tokenize(rawText);
  let best: CourseMatch | null = null;

  for (const hint of courses) {
    for (const candidate of candidatesOf(hint)) {
      const normalizedCandidate = normalizeText(candidate.value);
      if (normalizedCandidate.length === 0) {
        continue;
      }

      // Exact match: whole-text equality or a token that IS the candidate.
      // Short codes ("os") must never match as a raw substring - "pOSTpONED"
      // contains "os" and that is not an Operating Systems reference.
      const exactToken = textTokens.some((token) => normalizeText(token) === normalizedCandidate);
      const substringMatch =
        normalizedCandidate.length >= 4 && normalizedText.includes(normalizedCandidate);

      if (normalizedText === normalizedCandidate || exactToken || substringMatch) {
        return { hint, score: 1, edits: 0, matchedOn: candidate.matchedOn };
      }

      // Token-level fuzzy match: "DBS" vs "DBMS", "Operatng" vs "Operating".
      let bestTokenScore = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const token of textTokens) {
        const normalizedToken = normalizeText(token);
        if (normalizedToken.length < 3) {
          continue;
        }
        for (const form of candidateForms(candidate.value)) {
          const score = similarity(normalizedToken, form);
          if (score > bestTokenScore) {
            bestTokenScore = score;
            bestDistance = editDistance(normalizedToken, form);
          }
        }
      }

      if (bestTokenScore > (best?.score ?? 0)) {
        best = {
          hint,
          score: bestTokenScore,
          edits: bestDistance,
          matchedOn: candidate.matchedOn,
        };
      }
    }
  }

  if (!best || best.score < MIN_COURSE_MATCH_SCORE) {
    return null;
  }
  return best;
}

/** Best fuzzy match without the acceptance threshold (used for diagnostics). */
export function closestCourse(rawText: string, courses: CourseHint[]): CourseMatch | null {
  const match = matchCourse(rawText, courses);
  if (match) {
    return match;
  }
  return matchCourse(rawText, courses);
}