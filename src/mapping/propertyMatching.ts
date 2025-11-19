import { CodeComponentPropRecord } from "../code/artifacts";
import {
  type PropertyMappingRecord,
  type PropertyMappingStatus,
  type PropertyValueMappingRecord,
} from "./artifacts";
import {
  buildSynonymMap,
  canonicalizeSlug,
  condense,
  hasPrefixOrSuffixOverlap,
  slugify,
  type SynonymGroup,
} from "./stringUtils";

export interface DesignPropertyProfile {
  propertyName: string;
  values: readonly string[];
}

export interface PropertyMatchOptions {
  synonyms?: readonly SynonymGroup[];
}

export interface PropertyMatchResult {
  record: PropertyMappingRecord;
  candidate?: PropertyMatchCandidate;
}

interface PropertyMatchCandidate {
  prop: CodeComponentPropRecord;
  score: number;
  reasons: string[];
}

interface MatchingContext {
  synonyms: ReadonlyMap<string, string>;
}

interface PreparedDesignProperty {
  name: string;
  slug: string;
  canonical: string;
  condensed: string;
  values: readonly PropertyValueEntry[];
  valueKind: "boolean" | "string";
}

interface PropertyValueEntry {
  raw: string;
  normalized: string;
}

interface PreparedCodeProp {
  record: CodeComponentPropRecord;
  slug: string;
  canonical: string;
  condensed: string;
  valueKind: "boolean" | "enum" | "string" | "unknown";
}

interface ValueMappingOutcome {
  valueMappings: PropertyValueMappingRecord[];
  unmappedValues: string[];
  coverageRatio: number;
  note?: string;
}

const MAX_NAME_SCORE = 12;

const DEFAULT_PROPERTY_SYNONYMS: SynonymGroup[] = [
  {
    canonical: "variant",
    matches: ["variant", "variants", "recipe-variant"],
  },
  { canonical: "size", matches: ["size", "sizes"] },
  {
    canonical: "color-scheme",
    matches: [
      "color",
      "colors",
      "color-scheme",
      "colorScheme",
      "colorscheme",
      "palette",
      "color-palette",
      "intent",
    ],
  },
  {
    canonical: "disabled",
    matches: ["disabled", "is-disabled", "isDisabled", "state-disabled"],
  },
];

export function evaluatePropertyMapping(
  designProperty: DesignPropertyProfile,
  codeProps: readonly CodeComponentPropRecord[],
  options: PropertyMatchOptions = {},
): PropertyMatchResult {
  const context = createMatchingContext(options.synonyms);
  const preparedDesign = prepareDesignProperty(designProperty, context);
  const preparedCode = codeProps.map((prop) => prepareCodeProp(prop, context));
  const candidates = preparedCode
    .map((prop) => scorePropertyCandidate(preparedDesign, prop))
    .filter(isDefined)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.prop.propName.localeCompare(b.prop.propName, undefined, { sensitivity: "base" }),
    );

  const baseRecord: PropertyMappingRecord = {
    designProp: designProperty.propertyName,
    status: "unmapped",
    notes: [],
    valueMappings: preparedDesign.values.map((value) => ({
      designValue: value.raw,
      status: "unmapped",
    })),
    unmappedDesignValues: preparedDesign.values.map((value) => value.raw),
  };

  if (preparedDesign.values.length === 0) {
    return {
      candidate: undefined,
      record: {
        ...baseRecord,
        reason: "No design values were detected for this property.",
      },
    };
  }

  if (candidates.length === 0) {
    return {
      candidate: undefined,
      record: {
        ...baseRecord,
        reason: "No code props matched the property name heuristics.",
      },
    };
  }

  const best = candidates[0];
  const competitor = candidates[1];
  const hasConflict = competitor && competitor.score === best.score;
  const reasonFragments = [...best.reasons];

  if (hasConflict) {
    reasonFragments.push(
      `Another candidate ("${competitor.prop.propName}") tied with the best score.`,
    );
  }

  const {
    valueMappings,
    unmappedValues,
    coverageRatio,
    note: coverageNote,
  } = mapDesignValuesToCode(preparedDesign, best.prop);

  const status: PropertyMappingStatus = hasConflict ? "conflict" : "mapped";
  const confidence = computeConfidence(best.score, coverageRatio, hasConflict);
  if (coverageNote) {
    reasonFragments.push(coverageNote);
  }

  const record: PropertyMappingRecord = {
    designProp: designProperty.propertyName,
    codeProp: hasConflict ? undefined : best.prop.propName,
    status,
    confidence,
    reason: reasonFragments.join(" "),
    notes: coverageNote ? [coverageNote] : [],
    valueMappings,
    unmappedDesignValues: unmappedValues,
  };

  return {
    candidate: best,
    record,
  };
}

function prepareDesignProperty(
  profile: DesignPropertyProfile,
  context: MatchingContext,
): PreparedDesignProperty {
  const slug = slugify(profile.propertyName);
  const canonical = canonicalizeSlug(slug, context.synonyms);
  const condensed = condense(profile.propertyName);
  const values = profile.values.map(normalizeDesignValue);
  const valueKind = values.every((value) => value.normalized === "true" || value.normalized === "false")
    ? "boolean"
    : "string";
  return {
    name: profile.propertyName,
    slug,
    canonical,
    condensed,
    values,
    valueKind,
  };
}

function prepareCodeProp(prop: CodeComponentPropRecord, context: MatchingContext): PreparedCodeProp {
  const slug = slugify(prop.propName);
  const canonical = canonicalizeSlug(slug, context.synonyms);
  const condensed = condense(prop.propName);
  let valueKind: PreparedCodeProp["valueKind"] = "unknown";
  if (prop.model.kind === "boolean") {
    valueKind = "boolean";
  } else if (prop.model.kind === "enum") {
    valueKind = "enum";
  } else if (prop.model.kind === "string") {
    valueKind = "string";
  }
  return {
    record: prop,
    slug,
    canonical,
    condensed,
    valueKind,
  };
}

function scorePropertyCandidate(
  design: PreparedDesignProperty,
  code: PreparedCodeProp,
): PropertyMatchCandidate | undefined {
  let score = 0;
  const reasons: string[] = [];

  if (design.slug === code.slug) {
    score += 6;
    reasons.push("Slugified names match exactly.");
  } else if (design.canonical && design.canonical === code.canonical) {
    score += 4;
    reasons.push("Canonical names match.");
  }

  if (stripBooleanPrefix(code.slug) === design.slug) {
    score += 2;
    reasons.push("Code prop matches after stripping boolean prefix.");
  }

  if (hasPrefixOrSuffixOverlap(design.condensed, code.condensed, 3)) {
    score += 1;
    reasons.push("Names share significant prefix or suffix.");
  }

  if (design.valueKind === "boolean" && code.valueKind === "boolean") {
    score += 2;
    reasons.push("Both design values and code prop are boolean.");
  } else if (design.valueKind !== "boolean" && code.valueKind === "enum") {
    score += 2;
    reasons.push("Design uses categorical values and code prop exposes an enum.");
  }

  if (score === 0) {
    return undefined;
  }

  return {
    prop: code.record,
    score,
    reasons,
  };
}

function mapDesignValuesToCode(
  design: PreparedDesignProperty,
  codeProp: CodeComponentPropRecord,
): ValueMappingOutcome {
  const valueMappings: PropertyValueMappingRecord[] = [];
  const unmappedValues: string[] = [];
  const codeLookup = buildCodeValueLookup(codeProp);

  for (const value of design.values) {
    const mappedCodeValue = codeLookup.get(value.normalized);
    if (mappedCodeValue) {
      valueMappings.push({
        designValue: value.raw,
        codeValue: mappedCodeValue,
        status: "mapped",
      });
    } else if (codeLookup.size === 0 && codeProp.model.kind !== "boolean") {
      valueMappings.push({
        designValue: value.raw,
        codeValue: value.raw,
        status: "mapped",
        reason: "Assuming direct passthrough for flexible prop.",
      });
    } else {
      unmappedValues.push(value.raw);
      valueMappings.push({
        designValue: value.raw,
        status: "unmapped",
      });
    }
  }

  const coverageRatio =
    design.values.length === 0 ? 1 : (design.values.length - unmappedValues.length) / design.values.length;
  const note = unmappedValues.length === 0
    ? `Mapped ${design.values.length} design values to "${codeProp.propName}".`
    : `Only ${design.values.length - unmappedValues.length}/${design.values.length} design values map to "${codeProp.propName}".`;

  return {
    valueMappings,
    unmappedValues,
    coverageRatio,
    note,
  };
}

function buildCodeValueLookup(
  prop: CodeComponentPropRecord,
): Map<string, string> {
  const lookup = new Map<string, string>();
  if (prop.model.kind === "enum") {
    for (const value of prop.model.values) {
      lookup.set(normalizeValueKey(value), value);
    }
  } else if (prop.model.kind === "boolean") {
    lookup.set("true", "true");
    lookup.set("false", "false");
  }
  return lookup;
}

function computeConfidence(
  score: number,
  coverageRatio: number,
  hasConflict: boolean,
): number {
  const normalizedScore = Math.max(0, Math.min(1, score / MAX_NAME_SCORE));
  const coverage = Math.max(0, Math.min(1, coverageRatio));
  const combined = 0.6 * normalizedScore + 0.4 * coverage;
  const adjusted = hasConflict ? combined * 0.6 : combined;
  return Number(adjusted.toFixed(2));
}

function normalizeDesignValue(value: string): PropertyValueEntry {
  const raw = String(value ?? "").trim();
  return {
    raw,
    normalized: normalizeValueKey(raw),
  };
}

function normalizeValueKey(value: string): string {
  return slugify(value).replace(/-/g, "");
}

function stripBooleanPrefix(slug: string): string {
  if (slug.startsWith("is-")) {
    return slug.slice(3);
  }
  if (slug.startsWith("is")) {
    return slug.slice(2);
  }
  if (slug.startsWith("has-")) {
    return slug.slice(4);
  }
  if (slug.startsWith("has")) {
    return slug.slice(3);
  }
  return slug;
}

function createMatchingContext(
  synonyms: readonly SynonymGroup[] | undefined,
): MatchingContext {
  return { synonyms: buildSynonymMap(synonyms ?? DEFAULT_PROPERTY_SYNONYMS) };
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
