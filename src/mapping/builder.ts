import { CodeComponentsArtifact, CodeComponentRecord } from "../code/artifacts";
import {
  DesignComponentsArtifact,
  DesignComponentRecord,
  DesignComponentVariant,
} from "../figma/artifacts";
import {
  type ComponentMappingRecord,
  type MappingArtifact,
  MAPPING_ARTIFACT_KIND,
  MAPPING_ARTIFACT_VERSION,
  type MappingSummary,
  type PropertyMappingRecord,
} from "./artifacts";
import { matchComponentsByName, type ComponentMatchResult } from "./componentMatching";
import {
  evaluatePropertyMapping,
  type DesignPropertyProfile,
} from "./propertyMatching";

export interface MappingBuildOptions {
  design: {
    artifact: DesignComponentsArtifact;
    path: string;
  };
  code: {
    artifact: CodeComponentsArtifact;
    path: string;
  };
  generatedAt?: string;
}

export interface MappingBuildResult {
  artifact: MappingArtifact;
  warnings: string[];
}

export function buildMappingArtifact(options: MappingBuildOptions): MappingBuildResult {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const matches = matchComponentsByName(
    options.design.artifact.components,
    options.code.artifact.components,
  );

  const componentRecords: ComponentMappingRecord[] = [];
  const warnings: string[] = [];

  for (const match of matches) {
    const profiles = collectDesignPropertyProfiles(match.design);
    const { record, warnings: componentWarnings } = buildComponentMappingRecord(match, profiles);
    componentRecords.push(record);
    warnings.push(...componentWarnings);
  }

  const summary = summarizeComponentMappings(componentRecords);

  const artifact: MappingArtifact = {
    kind: MAPPING_ARTIFACT_KIND,
    version: MAPPING_ARTIFACT_VERSION,
    generatedAt,
    designArtifactPath: options.design.path,
    codeArtifactPath: options.code.path,
    components: componentRecords,
    summary,
    warnings,
  };

  return { artifact, warnings };
}

function buildComponentMappingRecord(
  match: ComponentMatchResult,
  propertyProfiles: DesignPropertyProfile[],
): { record: ComponentMappingRecord; warnings: string[] } {
  const warnings: string[] = [];
  const codeComponent = match.bestCandidate?.code;
  const notes = [...(match.bestCandidate?.reasons ?? [])];
  const propertyRecords: PropertyMappingRecord[] = propertyProfiles.map((profile) => {
    if (!codeComponent) {
      return createUnmatchedPropertyRecord(profile, "Component was not matched to code.");
    }
    const evaluation = evaluatePropertyMapping(profile, codeComponent.props);
    if (evaluation.record.status === "conflict") {
      warnings.push(
        `Component "${match.design.componentName}" property "${profile.propertyName}" has conflicting matches.`,
      );
    }
    if (evaluation.record.unmappedDesignValues.length > 0) {
      warnings.push(
        `Component "${match.design.componentName}" property "${profile.propertyName}" has unmapped design values: ${evaluation.record.unmappedDesignValues.join(
          ", ",
        )}`,
      );
    }
    return evaluation.record;
  });

  const matchedProps = propertyRecords.filter((prop) => prop.status === "mapped").length;
  const totalProps = propertyRecords.length;

  let status: ComponentMappingRecord["status"] = "unmapped";
  if (!codeComponent) {
    warnings.push(`Design component "${match.design.componentName}" did not match any code component.`);
  } else if (totalProps === 0 || matchedProps === totalProps) {
    status = "mapped";
  } else if (matchedProps > 0) {
    status = "partial";
  }

  const record: ComponentMappingRecord = {
    componentName: match.design.componentName,
    designComponentNodeId: match.design.componentNodeId,
    codeExportName: codeComponent?.exportName,
    status,
    props: propertyRecords,
    matchedProps,
    totalProps,
    notes,
  };

  return { record, warnings };
}

function createUnmatchedPropertyRecord(
  profile: DesignPropertyProfile,
  note: string,
): PropertyMappingRecord {
  const valueMappings = profile.values.map((value) => ({
    designValue: value,
    status: "unmapped" as const,
  }));
  return {
    designProp: profile.propertyName,
    status: "unmapped",
    reason: note,
    notes: [note],
    valueMappings,
    unmappedDesignValues: [...profile.values],
  };
}

function collectDesignPropertyProfiles(component: DesignComponentRecord): DesignPropertyProfile[] {
  const valueMap = new Map<string, Set<string>>();
  for (const variant of component.variants) {
    collectVariantMetadata(variant, valueMap);
  }

  const orderedKeys =
    component.propertyKeys.length > 0
      ? [...component.propertyKeys]
      : Array.from(valueMap.keys()).sort((a, b) => a.localeCompare(b));

  return orderedKeys.map((propertyName) => {
    const values = Array.from(valueMap.get(propertyName) ?? []).sort((a, b) =>
      a.localeCompare(b),
    );
    return {
      propertyName,
      values,
    };
  });
}

function collectVariantMetadata(
  variant: DesignComponentVariant,
  valueMap: Map<string, Set<string>>,
): void {
  const metadataEntries = Object.entries(variant.metadata ?? {});
  for (const [key, rawValue] of metadataEntries) {
    if (rawValue === undefined || rawValue === null) {
      continue;
    }
    const stringValue = formatMetadataValue(rawValue);
    if (!valueMap.has(key)) {
      valueMap.set(key, new Set());
    }
    valueMap.get(key)!.add(stringValue);
  }
}

function formatMetadataValue(value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

function summarizeComponentMappings(records: ComponentMappingRecord[]): MappingSummary {
  const componentCounts = {
    total: records.length,
    mapped: records.filter((record) => record.status === "mapped").length,
    partial: records.filter((record) => record.status === "partial").length,
    unmapped: records.filter((record) => record.status === "unmapped").length,
  };

  const propertyCounts = records.reduce(
    (acc, record) => {
      for (const prop of record.props) {
        acc.total += 1;
        if (prop.status === "mapped") {
          acc.mapped += 1;
        } else if (prop.status === "conflict") {
          acc.conflicting += 1;
        } else {
          acc.unmapped += 1;
        }
      }
      return acc;
    },
    { total: 0, mapped: 0, unmapped: 0, conflicting: 0 },
  );

  return {
    components: componentCounts,
    properties: propertyCounts,
  };
}
