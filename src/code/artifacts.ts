export const CODE_ARTIFACT_KIND = "code.components";
export const CODE_ARTIFACT_VERSION = 1 as const;

export type CodePropModelKind = "string" | "boolean" | "enum" | "unknown";

export type CodeComponentPropModel =
  | { kind: "string"; defaultValue?: string }
  | { kind: "boolean"; defaultValue?: boolean }
  | { kind: "enum"; values: string[]; defaultValue?: string }
  | { kind: "unknown"; reason?: string };

export interface CodeComponentPropRecord {
  propName: string;
  required: boolean;
  description?: string;
  declaredBy?: string;
  model: CodeComponentPropModel;
}

export interface CodeComponentRecord {
  componentName: string;
  exportName: string;
  modulePath: string;
  props: CodeComponentPropRecord[];
  description?: string;
  notes: string[];
}

export interface CodeComponentsArtifact {
  kind: typeof CODE_ARTIFACT_KIND;
  version: typeof CODE_ARTIFACT_VERSION;
  codeRoot: string;
  tsconfigPath: string;
  generatedAt: string;
  components: CodeComponentRecord[];
  warnings: string[];
}

type UnknownRecord = Record<string, unknown>;

export class CodeArtifactError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(
      [
        "Invalid code components artifact:",
        ...issues.map((issue) => `- ${issue}`),
      ].join("\n"),
    );
    this.issues = issues;
  }
}

export function normalizeCodeComponentsArtifact(
  raw: unknown,
): CodeComponentsArtifact {
  const issues: string[] = [];
  const root = asRecord(raw, "artifact", issues);

  const kind = readRequiredString(root, "kind", "artifact", issues);
  if (kind !== CODE_ARTIFACT_KIND) {
    issues.push(
      `artifact.kind must equal "${CODE_ARTIFACT_KIND}" (received "${kind}")`,
    );
  }

  const version = readRequiredInteger(root, "version", "artifact", issues);
  if (version !== CODE_ARTIFACT_VERSION) {
    issues.push(
      `artifact.version must equal ${CODE_ARTIFACT_VERSION} (received ${version})`,
    );
  }

  const codeRoot = readRequiredString(root, "codeRoot", "artifact", issues);
  const tsconfigPath = readRequiredString(
    root,
    "tsconfigPath",
    "artifact",
    issues,
  );

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
    throw new CodeArtifactError(issues);
  }

  return {
    kind: CODE_ARTIFACT_KIND,
    version: CODE_ARTIFACT_VERSION,
    codeRoot,
    tsconfigPath,
    generatedAt,
    components,
    warnings,
  };
}

export function tryValidateCodeComponentsArtifact(
  raw: unknown,
):
  | { ok: true; artifact: CodeComponentsArtifact }
  | { ok: false; issues: string[] } {
  try {
    return { ok: true, artifact: normalizeCodeComponentsArtifact(raw) };
  } catch (error) {
    if (error instanceof CodeArtifactError) {
      return { ok: false, issues: [...error.issues] };
    }
    return { ok: false, issues: [`Unexpected error: ${String(error)}`] };
  }
}

function normalizeComponent(
  raw: unknown,
  context: string,
  issues: string[],
): CodeComponentRecord {
  const record = asRecord(raw, context, issues);
  const componentName = readRequiredString(record, "componentName", context, issues);
  const exportName = readRequiredString(record, "exportName", context, issues);
  const modulePath = readRequiredString(record, "modulePath", context, issues);
  const description = readOptionalString(record, "description");
  const notes = readStringArray(record, "notes", context, issues) ?? [];
  const propsRaw = readArray(record, "props", context, issues);
  const props = propsRaw.map((value, index) =>
    normalizeComponentProp(value, `${context}.props[${index}]`, issues),
  );

  return {
    componentName,
    exportName,
    modulePath,
    props,
    description,
    notes,
  };
}

function normalizeComponentProp(
  raw: unknown,
  context: string,
  issues: string[],
): CodeComponentPropRecord {
  const record = asRecord(raw, context, issues);
  const propName = readRequiredString(record, "propName", context, issues);
  const required = readRequiredBoolean(record, "required", context, issues);
  const declaredBy = readOptionalString(record, "declaredBy");
  const description = readOptionalString(record, "description");
  const model = normalizePropModel(record.model, `${context}.model`, issues);
  return {
    propName,
    required,
    declaredBy,
    description,
    model,
  };
}

function normalizePropModel(
  raw: unknown,
  context: string,
  issues: string[],
): CodeComponentPropModel {
  const record = asRecord(raw, context, issues);
  const kind = readRequiredString(record, "kind", context, issues) as CodePropModelKind;
  switch (kind) {
    case "string": {
      const defaultValue = readOptionalString(record, "defaultValue");
      return defaultValue ? { kind, defaultValue } : { kind };
    }
    case "boolean": {
      const defaultValue = readOptionalBoolean(record, "defaultValue", context, issues);
      return defaultValue === undefined ? { kind } : { kind, defaultValue };
    }
    case "enum": {
      const values = readStringArray(record, "values", context, issues) ?? [];
      if (values.length === 0) {
        issues.push(`${context}.values must include at least one enum value`);
      }
      const defaultValue = readOptionalString(record, "defaultValue");
      if (defaultValue && values.length > 0 && !values.includes(defaultValue)) {
        issues.push(
          `${context}.defaultValue must be one of: ${values.join(", ")}`,
        );
      }
      return defaultValue
        ? { kind, values, defaultValue }
        : { kind, values };
    }
    case "unknown": {
      const reason = readOptionalString(record, "reason");
      return reason ? { kind, reason } : { kind };
    }
    default: {
      issues.push(`${context}.kind must be one of string|boolean|enum|unknown`);
      return { kind: "unknown", reason: `invalid model kind "${String(kind)}"` };
    }
  }
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

function readRequiredBoolean(
  record: UnknownRecord,
  key: string,
  context: string,
  issues: string[],
): boolean {
  const raw = record[key];
  if (typeof raw === "boolean") {
    return raw;
  }
  issues.push(`${context}.${key} is required and must be a boolean`);
  return false;
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
