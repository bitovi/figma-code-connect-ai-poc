export const DESIGN_ARTIFACT_KIND = "design.components";
export const DESIGN_ARTIFACT_VERSION = 1 as const;

export type DesignVariantMetadata = {
  variant?: string;
  size?: string;
  colorScheme?: string;
  disabled?: boolean;
};

export interface DesignComponentVariant {
  nodeId: string;
  variantName: string;
  displayName: string;
  description?: string;
  metadata: DesignVariantMetadata;
}

export interface DesignComponentRecord {
  componentName: string;
  matchKey: string;
  propertyKeys: string[];
  componentNodeId: string;
  pageName: string;
  variants: DesignComponentVariant[];
  description?: string;
}

export interface DesignComponentsArtifact {
  kind: typeof DESIGN_ARTIFACT_KIND;
  version: typeof DESIGN_ARTIFACT_VERSION;
  figmaFile: string;
  generatedAt: string;
  components: DesignComponentRecord[];
  warnings: string[];
}

type UnknownRecord = Record<string, unknown>;

export class DesignArtifactError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(
      [
        "Invalid design components artifact:",
        ...issues.map((issue) => `- ${issue}`),
      ].join("\n"),
    );
    this.issues = issues;
  }
}

export function normalizeDesignComponentsArtifact(
  raw: unknown,
): DesignComponentsArtifact {
  const issues: string[] = [];
  const root = asRecord(raw, "artifact", issues);

  const kind = readRequiredString(root, "kind", "artifact", issues);
  if (kind !== DESIGN_ARTIFACT_KIND) {
    issues.push(
      `artifact.kind must equal "${DESIGN_ARTIFACT_KIND}" (received "${kind}")`,
    );
  }

  const version = readRequiredInteger(root, "version", "artifact", issues);
  if (version !== DESIGN_ARTIFACT_VERSION) {
    issues.push(
      `artifact.version must equal ${DESIGN_ARTIFACT_VERSION} (received ${version})`,
    );
  }

  const figmaFile = readRequiredString(root, "figmaFile", "artifact", issues);
  const generatedAt = readRequiredString(root, "generatedAt", "artifact", issues);
  if (!isIsoDate(generatedAt)) {
    issues.push(`artifact.generatedAt must be an ISO-8601 timestamp`);
  }

  const componentsRaw = readArray(root, "components", "artifact", issues);
  const components = componentsRaw.map((value, index) =>
    normalizeComponent(value, `artifact.components[${index}]`, issues),
  );

  const warnings = readStringArray(root, "warnings", "artifact", issues) ?? [];

  if (issues.length > 0) {
    throw new DesignArtifactError(issues);
  }

  return {
    kind: DESIGN_ARTIFACT_KIND,
    version: DESIGN_ARTIFACT_VERSION,
    figmaFile,
    generatedAt,
    components,
    warnings,
  };
}

export function tryValidateDesignComponentsArtifact(
  raw: unknown,
): { ok: true; artifact: DesignComponentsArtifact } | { ok: false; issues: string[] } {
  try {
    return { ok: true, artifact: normalizeDesignComponentsArtifact(raw) };
  } catch (error) {
    if (error instanceof DesignArtifactError) {
      return { ok: false, issues: [...error.issues] };
    }
    return { ok: false, issues: [`Unexpected error: ${String(error)}`] };
  }
}

function normalizeComponent(
  raw: unknown,
  context: string,
  issues: string[],
): DesignComponentRecord {
  const record = asRecord(raw, context, issues);
  const componentName = readRequiredString(record, "componentName", context, issues);
  const matchKey = readRequiredString(record, "matchKey", context, issues);
  const propertyKeys =
    readStringArray(record, "propertyKeys", context, issues) ?? [];
  const componentNodeId = readRequiredString(
    record,
    "componentNodeId",
    context,
    issues,
  );
  const pageName = readRequiredString(record, "pageName", context, issues);
  const description = readOptionalString(record, "description");
  const variantsRaw = readArray(record, "variants", context, issues);
  if (variantsRaw.length === 0) {
    issues.push(`${context}.variants must include at least one entry`);
  }
  const variants = variantsRaw.map((value, index) =>
    normalizeVariant(value, `${context}.variants[${index}]`, issues),
  );

  return {
    componentName,
    matchKey,
    propertyKeys,
    componentNodeId,
    pageName,
    variants,
    description,
  };
}

function normalizeVariant(
  raw: unknown,
  context: string,
  issues: string[],
): DesignComponentVariant {
  const record = asRecord(raw, context, issues);
  const nodeId = readRequiredString(record, "nodeId", context, issues);
  const variantName = readRequiredString(record, "variantName", context, issues);
  const displayName = readRequiredString(record, "displayName", context, issues);
  const description = readOptionalString(record, "description");
  const metadata = normalizeVariantMetadata(record.metadata, `${context}.metadata`, issues);
  return {
    nodeId,
    variantName,
    displayName,
    description,
    metadata,
  };
}

function normalizeVariantMetadata(
  raw: unknown,
  context: string,
  issues: string[],
): DesignVariantMetadata {
  if (raw == null) {
    return {};
  }
  const record = asRecord(raw, context, issues);
  const metadata: DesignVariantMetadata = {};

  const variant = readOptionalString(record, "variant");
  if (variant) {
    metadata.variant = variant;
  }

  const size = readOptionalString(record, "size");
  if (size) {
    metadata.size = size;
  }

  const colorScheme = readOptionalString(record, "colorScheme");
  if (colorScheme) {
    metadata.colorScheme = colorScheme;
  }

  const disabled = readOptionalBoolean(record, "disabled", context, issues);
  if (disabled !== undefined) {
    metadata.disabled = disabled;
  }

  return metadata;
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

function readOptionalBoolean(
  record: UnknownRecord,
  key: string,
  context: string,
  issues: string[],
): boolean | undefined {
  const raw = record[key];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw === "boolean") {
    return raw;
  }
  issues.push(`${context}.${key} must be a boolean when provided`);
  return undefined;
}

function isIsoDate(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}
