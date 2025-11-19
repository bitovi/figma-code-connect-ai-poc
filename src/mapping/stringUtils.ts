export interface SynonymGroup {
  canonical: string;
  matches: readonly string[];
}

export function buildSynonymMap(groups: readonly SynonymGroup[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of groups) {
    const canonical = slugify(group.canonical);
    if (!canonical) {
      continue;
    }
    map.set(canonical, canonical);
    for (const match of group.matches) {
      const slug = slugify(match);
      if (slug) {
        map.set(slug, canonical);
      }
    }
  }
  return map;
}

export function canonicalizeSlug(
  slugValue: string,
  synonyms: ReadonlyMap<string, string>,
): string {
  if (!slugValue) {
    return "";
  }
  if (synonyms.has(slugValue)) {
    return synonyms.get(slugValue)!;
  }
  const singular = singularize(slugValue);
  if (synonyms.has(singular)) {
    return synonyms.get(singular)!;
  }
  return singular;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function condense(value: string): string {
  return slugify(value).replace(/-/g, "");
}

export function singularize(value: string): string {
  if (value.length > 3 && value.endsWith("ies")) {
    return `${value.slice(0, -3)}y`;
  }
  if (value.length > 3 && value.endsWith("ses")) {
    return value.slice(0, -2);
  }
  if (value.length > 3 && value.endsWith("s") && !value.endsWith("ss")) {
    return value.slice(0, -1);
  }
  return value;
}

export function hasPrefixOrSuffixOverlap(a: string, b: string, minOverlap = 4): boolean {
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return false;
  }
  const minLength = Math.min(a.length, b.length);
  const prefix = commonPrefixLength(a, b);
  const suffix = commonPrefixLength(reverse(a), reverse(b));
  const overlap = Math.max(prefix, suffix);
  if (overlap === 0) {
    return false;
  }
  const threshold = Math.min(minLength, minOverlap);
  return overlap >= threshold;
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let length = 0;
  while (length < limit && a[length] === b[length]) {
    length += 1;
  }
  return length;
}

function reverse(value: string): string {
  return value.split("").reverse().join("");
}
