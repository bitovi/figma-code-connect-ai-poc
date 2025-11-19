import { CodeComponentRecord } from "../code/artifacts";
import { DesignComponentRecord } from "../figma/artifacts";
import {
  buildSynonymMap,
  canonicalizeSlug,
  condense,
  hasPrefixOrSuffixOverlap,
  slugify,
  type SynonymGroup,
} from "./stringUtils";

export type { SynonymGroup };

export interface ComponentMatchOptions {
  synonyms?: readonly SynonymGroup[];
}

export interface ComponentMatchCandidate {
  code: CodeComponentRecord;
  score: number;
  reasons: string[];
}

export interface ComponentMatchResult {
  design: DesignComponentRecord;
  bestCandidate?: ComponentMatchCandidate;
  candidates: ComponentMatchCandidate[];
}

export const DEFAULT_COMPONENT_SYNONYMS: SynonymGroup[] = [
  { canonical: "badge", matches: ["badges"] },
  { canonical: "button", matches: ["buttons", "cta-button"] },
  {
    canonical: "breadcrumb",
    matches: ["breadcrumbs", "breadcrumb-root", "breadcrumbroot"],
  },
];

interface PreparedDesignComponent {
  record: DesignComponentRecord;
  matchKey: string;
  canonicalKey: string;
  condensedName: string;
}

interface PreparedCodeComponent {
  record: CodeComponentRecord;
  nameSlug: string;
  exportSlug: string;
  canonicalNameKey: string;
  canonicalExportKey: string;
  condensedName: string;
}

interface MatchingContext {
  synonyms: ReadonlyMap<string, string>;
}

export function matchComponentsByName(
  designComponents: readonly DesignComponentRecord[],
  codeComponents: readonly CodeComponentRecord[],
  options: ComponentMatchOptions = {},
): ComponentMatchResult[] {
  const context = createMatchingContext(options.synonyms);
  const preparedCode = codeComponents.map((component) =>
    prepareCodeComponent(component, context),
  );

  return designComponents.map((component) => {
    const preparedDesign = prepareDesignComponent(component, context);
    const candidates = preparedCode
      .map((code) => scoreComponentCandidate(preparedDesign, code))
      .filter(isDefined)
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.code.componentName.localeCompare(b.code.componentName),
      );

    return {
      design: component,
      candidates,
      bestCandidate: candidates[0],
    };
  });
}

function scoreComponentCandidate(
  design: PreparedDesignComponent,
  code: PreparedCodeComponent,
): ComponentMatchCandidate | undefined {
  let score = 0;
  const reasons: string[] = [];

  if (
    design.record.componentName.localeCompare(code.record.componentName, undefined, {
      sensitivity: "accent",
      usage: "search",
    }) === 0
  ) {
    score += 6;
    reasons.push("componentName matches (case-insensitive)");
  }

  if (design.matchKey && design.matchKey === code.nameSlug) {
    score += 5;
    reasons.push("design.matchKey matches code component name");
  }

  if (design.matchKey && design.matchKey === code.exportSlug) {
    score += 4;
    reasons.push("design.matchKey matches code export name");
  }

  if (
    design.canonicalKey &&
    design.canonicalKey === code.canonicalNameKey &&
    design.matchKey !== code.nameSlug
  ) {
    score += 3;
    reasons.push(`canonical key matches code component (${design.canonicalKey})`);
  }

  if (
    design.canonicalKey &&
    design.canonicalKey === code.canonicalExportKey &&
    design.matchKey !== code.exportSlug
  ) {
    score += 2;
    reasons.push(`canonical key matches code export (${design.canonicalKey})`);
  }

  if (
    hasPrefixOrSuffixOverlap(design.condensedName, code.condensedName)
  ) {
    score += 1;
    reasons.push("component names share a strong prefix/suffix");
  }

  if (score === 0) {
    return undefined;
  }

  return { code: code.record, score, reasons };
}

function prepareDesignComponent(
  component: DesignComponentRecord,
  context: MatchingContext,
): PreparedDesignComponent {
  const matchKey = slugify(component.matchKey || component.componentName);
  const canonicalKey = canonicalizeSlug(matchKey, context.synonyms);
  const condensedName = condense(component.componentName);
  return {
    record: component,
    matchKey,
    canonicalKey,
    condensedName,
  };
}

function prepareCodeComponent(
  component: CodeComponentRecord,
  context: MatchingContext,
): PreparedCodeComponent {
  const nameSlug = slugify(component.componentName);
  const exportSlug = slugify(component.exportName);
  return {
    record: component,
    nameSlug,
    exportSlug,
    canonicalNameKey: canonicalizeSlug(nameSlug, context.synonyms),
    canonicalExportKey: canonicalizeSlug(exportSlug, context.synonyms),
    condensedName: condense(component.componentName),
  };
}

function createMatchingContext(
  synonyms: readonly SynonymGroup[] | undefined,
): MatchingContext {
  const synonymMap = buildSynonymMap(synonyms ?? DEFAULT_COMPONENT_SYNONYMS);
  return { synonyms: synonymMap };
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
