export const MAPPING_ARTIFACT_KIND = "mapping.components";
export const MAPPING_ARTIFACT_VERSION = 1 as const;

export type ComponentMappingStatus = "mapped" | "partial" | "unmapped";
export type PropertyMappingStatus = "mapped" | "unmapped" | "conflict";

export interface PropertyMappingRecord {
  designProp: string;
  codeProp?: string;
  status: PropertyMappingStatus;
  confidence?: number;
  reason?: string;
  notes: string[];
}

export interface ComponentMappingRecord {
  componentName: string;
  designComponentNodeId?: string;
  codeExportName?: string;
  status: ComponentMappingStatus;
  props: PropertyMappingRecord[];
  matchedProps: number;
  totalProps: number;
  notes: string[];
}

export interface MappingSummaryCounts {
  total: number;
  mapped: number;
  partial: number;
  unmapped: number;
}

export interface MappingPropertySummaryCounts {
  total: number;
  mapped: number;
  unmapped: number;
  conflicting: number;
}

export interface MappingSummary {
  components: MappingSummaryCounts;
  properties: MappingPropertySummaryCounts;
}

export interface MappingArtifact {
  kind: typeof MAPPING_ARTIFACT_KIND;
  version: typeof MAPPING_ARTIFACT_VERSION;
  generatedAt: string;
  designArtifactPath: string;
  codeArtifactPath: string;
  components: ComponentMappingRecord[];
  summary: MappingSummary;
  warnings: string[];
}

type UnknownRecord = Record<string, unknown>;

export class MappingArtifactError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(
      [
        "Invalid mapping components artifact:",
        ...issues.map((issue) => `- ${issue}`),
      ].join("\n"),
    );
    this.issues = issues;
  }
}

export function normalizeMappingArtifact(raw: unknown): MappingArtifact {
  const issues: string[] = [];
  const root = asRecord(raw, "artifact", issues);

  const kind = readRequiredString(root, "kind", "artifact", issues);
  if (kind !== MAPPING_ARTIFACT_KIND) {
    issues.push(
      `artifact.kind must equal "${MAPPING_ARTIFACT_KIND}" (received "${kind}")`,
    );
  }

  const version = readRequiredInteger(root, "version", "artifact", issues);
  if (version !== MAPPING_ARTIFACT_VERSION) {
    issues.push(
      `artifact.version must equal ${MAPPING_ARTIFACT_VERSION} (received ${version})`,
    );
  }

  const generatedAt = readRequiredString(root, "generatedAt", "artifact", issues);
  if (!isIsoDate(generatedAt)) {
    issues.push(`artifact.generatedAt must be an ISO-8601 timestamp`);
  }

  const designArtifactPath = readRequiredString(
    root,
    "designArtifactPath",
    "artifact",
    issues,
  );
  const codeArtifactPath = readRequiredString(
    root,
    "codeArtifactPath",
    "artifact",
    issues,
  );

  const componentsRaw = readArray(root, "components", "artifact", issues);
  const components = componentsRaw.map((value, index) =>
    normalizeComponentMapping(value, `artifact.components[${index}]`, issues),
  );

  const summary = normalizeSummary(root.summary, "artifact.summary", issues);
  const warnings = readStringArray(root, "warnings", "artifact", issues) ?? [];

  if (issues.length > 0) {
    throw new MappingArtifactError(issues);
  }

  return {
    kind: MAPPING_ARTIFACT_KIND,
    version: MAPPING_ARTIFACT_VERSION,
    generatedAt,
    designArtifactPath,
    codeArtifactPath,
    components,
    summary,
    warnings,
  };
}

export function tryValidateMappingArtifact(
  raw: unknown,
): { ok: true; artifact: MappingArtifact } | { ok: false; issues: string[] } {
  try {
    return { ok: true, artifact: normalizeMappingArtifact(raw) };
  } catch (error) {
    if (error instanceof MappingArtifactError) {
      return { ok: false, issues: [...error.issues] };
    }
    return { ok: false, issues: [`Unexpected error: ${String(error)}`] };
  }
}

function normalizeComponentMapping(
  raw: unknown,
  context: string,
  issues: string[],
): ComponentMappingRecord {
  const record = asRecord(raw, context, issues);
  const componentName = readRequiredString(record, "componentName", context, issues);
  const designComponentNodeId = readOptionalString(record, "designComponentNodeId");
  const codeExportName = readOptionalString(record, "codeExportName");
  const status = readComponentStatus(record, "status", context, issues);
  const propsRaw = readArray(record, "props", context, issues);
  const props = propsRaw.map((value, index) =>
    normalizePropertyMapping(value, `${context}.props[${index}]`, issues),
  );
  const matchedProps = readRequiredInteger(record, "matchedProps", context, issues);
  const totalProps = readRequiredInteger(record, "totalProps", context, issues);
  if (matchedProps < 0 || totalProps < 0) {
    issues.push(`${context}.matchedProps and totalProps must be non-negative`);
  }
  if (matchedProps > totalProps) {
    issues.push(`${context}.matchedProps cannot exceed totalProps`);
  }
  const notes = readStringArray(record, "notes", context, issues) ?? [];

  return {
    componentName,
    designComponentNodeId,
    codeExportName,
    status,
    props,
    matchedProps,
    totalProps,
    notes,
  };
}

function normalizePropertyMapping(
  raw: unknown,
  context: string,
  issues: string[],
): PropertyMappingRecord {
  const record = asRecord(raw, context, issues);
  const designProp = readRequiredString(record, "designProp", context, issues);
  const codeProp = readOptionalString(record, "codeProp");
  const status = readPropertyStatus(record, "status", context, issues);
  const confidence = readOptionalConfidence(record, "confidence", context, issues);
  const reason = readOptionalString(record, "reason");
  const notes = readStringArray(record, "notes", context, issues) ?? [];
  return {
    designProp,
    codeProp,
    status,
    confidence,
    reason,
    notes,
  };
}

function normalizeSummary(
  raw: unknown,
  context: string,
  issues: string[],
): MappingSummary {
  const record = asRecord(raw, context, issues);
  const components = normalizeSummaryCounts(record.components, `${context}.components`, issues);
  const properties = normalizePropertySummaryCounts(
    record.properties,
    `${context}.properties`,
    issues,
  );
  return { components, properties };
}

function normalizeSummaryCounts(
  raw: unknown,
  context: string,
  issues: string[],
): MappingSummaryCounts {
  const record = asRecord(raw, context, issues);
  const total = readRequiredInteger(record, "total", context, issues);
  const mapped = readRequiredInteger(record, "mapped", context, issues);
  const partial = readRequiredInteger(record, "partial", context, issues);
  const unmapped = readRequiredInteger(record, "unmapped", context, issues);
  ensureNonNegative({ total, mapped, partial, unmapped }, context, issues);
  return { total, mapped, partial, unmapped };
}

function normalizePropertySummaryCounts(
  raw: unknown,
  context: string,
  issues: string[],
): MappingPropertySummaryCounts {
  const record = asRecord(raw, context, issues);
  const total = readRequiredInteger(record, "total", context, issues);
  const mapped = readRequiredInteger(record, "mapped", context, issues);
  const unmapped = readRequiredInteger(record, "unmapped", context, issues);
  const conflicting = readRequiredInteger(record, "conflicting", context, issues);
  ensureNonNegative({ total, mapped, unmapped, conflicting }, context, issues);
  return { total, mapped, unmapped, conflicting };
}

function ensureNonNegative(
  values: Record<string, number>,
  context: string,
  issues: string[],
): void {
  Object.entries(values).forEach(([key, value]) => {
    if (value < 0) {
      issues.push(`${context}.${key} must be greater than or equal to zero`);
    }
  });
}

function asRecord(value: unknown, context: string, issues: string[]): UnknownRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as UnknownRecord;
  }
  issues.push(`${context} must be an object`);
  return {};
}

function readArray(
  record: UnknownRecord,
  key: string,
  context: string,
  issues: string[],
): unknown[] {
  const raw = record[key];
  if (!Array.isArray(raw)) {
    issues.push(`${context}.${key} must be an array`);
    return [];
  }
  return raw;
}

function readStringArray(
  record: UnknownRecord,
  key: string,
  context: string,
  issues: string[],
): string[] | undefined {
  const raw = record[key];
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    issues.push(`${context}.${key} must be an array of strings when provided`);
    return undefined;
  }
  const values = raw
    .map((value) => (typeof value === "string" ? value.trim() : String(value).trim()))
    .filter((value) => value.length > 0);
  if (values.length === 0) {
    return undefined;
  }
  return values;
}

function readRequiredString(
  record: UnknownRecord,
  key: string,
  context: string,
  issues: string[],
): string {
  const raw = record[key];
  if (typeof raw === "string") {
    const value = raw.trim();
    if (value.length > 0) {
      return value;
    }
  }
  issues.push(`${context}.${key} is required and must be a non-empty string`);
  return "";
}

function readOptionalString(record: UnknownRecord, key: string): string | undefined {
  const raw = record[key];
  if (raw == null) {
    return undefined;
  }
  if (typeof raw === "string") {
    const value = raw.trim();
    return value.length > 0 ? value : undefined;
  }
  return String(raw).trim() || undefined;
}

function readRequiredInteger(
  record: UnknownRecord,
  key: string,
  context: string,
  issues: string[],
): number {
  const raw = record[key];
  if (typeof raw === "number" && Number.isInteger(raw)) {
    return raw;
  }
  issues.push(`${context}.${key} is required and must be an integer`);
  return 0;
}

function readComponentStatus(
  record: UnknownRecord,
  key: string,
  context: string,
  issues: string[],
): ComponentMappingStatus {
  const value = readRequiredString(record, key, context, issues);
  if (isComponentStatus(value)) {
    return value;
  }
  issues.push(
    `${context}.${key} must be one of: mapped, partial, unmapped (received "${value}")`,
  );
  return "unmapped";
}

function readPropertyStatus(
  record: UnknownRecord,
  key: string,
  context: string,
  issues: string[],
): PropertyMappingStatus {
  const value = readRequiredString(record, key, context, issues);
  if (isPropertyStatus(value)) {
    return value;
  }
  issues.push(
    `${context}.${key} must be one of: mapped, unmapped, conflict (received "${value}")`,
  );
  return "unmapped";
}

function readOptionalConfidence(
  record: UnknownRecord,
  key: string,
  context: string,
  issues: string[],
): number | undefined {
  const raw = record[key];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw >= 0 && raw <= 1) {
      return raw;
    }
    issues.push(`${context}.${key} must be between 0 and 1 when provided`);
    return undefined;
  }
  issues.push(`${context}.${key} must be a number between 0 and 1 when provided`);
  return undefined;
}

function isComponentStatus(value: string): value is ComponentMappingStatus {
  return value === "mapped" || value === "partial" || value === "unmapped";
}

function isPropertyStatus(value: string): value is PropertyMappingStatus {
  return value === "mapped" || value === "unmapped" || value === "conflict";
}

function isIsoDate(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}
