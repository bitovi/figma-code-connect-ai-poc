import fs from "node:fs";
import * as toml from "toml";

export type RunMode = "simple";

export interface FigmaConfig {
  file: string;
  tokenEnv: string;
}

export interface CodeConfig {
  root: string;
  tsconfig: string;
}

export interface RunConfig {
  components: string[];
  mode: RunMode;
}

export interface PathsConfig {
  artifactsDir: string;
  modulesDir: string;
}

export interface SuperconnectConfig {
  figma: FigmaConfig;
  code: CodeConfig;
  run: RunConfig;
  paths: PathsConfig;
}

export const DEFAULT_COMPONENTS: string[] = [
  "Button",
  "Badge",
  "Breadcrumb",
];

export const DEFAULT_RUN_MODE: RunMode = "simple";
const VALID_RUN_MODES: readonly RunMode[] = [DEFAULT_RUN_MODE];

export const DEFAULT_ARTIFACTS_DIR = "artifacts";
export const DEFAULT_MODULES_DIR = "modules/code-connect";

type UnknownRecord = Record<string, unknown>;

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(
      [
        "Invalid superconnect config:",
        ...issues.map((issue) => `- ${issue}`),
      ].join("\n"),
    );
    this.issues = issues;
  }
}

function asRecord(
  value: unknown,
  context: string,
  issues: string[],
): UnknownRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as UnknownRecord;
  }
  issues.push(`${context} must be a table/object`);
  return {};
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

function readOptionalString(
  record: UnknownRecord,
  key: string,
): string | undefined {
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

function readStringArray(
  record: UnknownRecord,
  key: string,
  context: string,
  issues: string[],
): string[] | undefined {
  const raw = record[key];
  if (raw == null) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    issues.push(`${context}.${key} must be an array of strings when provided`);
    return undefined;
  }
  const values = raw
    .map((item) => (typeof item === "string" ? item.trim() : String(item).trim()))
    .filter((v) => v.length > 0);
  if (values.length === 0) {
    return undefined;
  }
  return values;
}

export function normalizeConfig(raw: unknown): SuperconnectConfig {
  const issues: string[] = [];
  const root = asRecord(raw, "root", issues);

  const figmaSection = asRecord(root.figma ?? {}, "[figma]", issues);
  const codeSection = asRecord(root.code ?? {}, "[code]", issues);
  const runSection = asRecord(root.run ?? {}, "[run]", issues);

  const pathsRaw = root.paths;
  const pathsSection =
    pathsRaw === undefined
      ? undefined
      : asRecord(pathsRaw, "[paths]", issues);

  const figma: FigmaConfig = {
    file: readRequiredString(figmaSection, "file", "[figma]", issues),
    tokenEnv: readRequiredString(figmaSection, "tokenEnv", "[figma]", issues),
  };

  const code: CodeConfig = {
    root: readRequiredString(codeSection, "root", "[code]", issues),
    tsconfig: readRequiredString(codeSection, "tsconfig", "[code]", issues),
  };

  const components =
    readStringArray(runSection, "components", "[run]", issues) ??
    [...DEFAULT_COMPONENTS];

  const modeRaw = readOptionalString(runSection, "mode");
  const mode = normalizeRunMode(modeRaw, issues);

  const paths: PathsConfig = {
    artifactsDir:
      (pathsSection && readOptionalString(pathsSection, "artifactsDir")) ??
      DEFAULT_ARTIFACTS_DIR,
    modulesDir:
      (pathsSection && readOptionalString(pathsSection, "modulesDir")) ??
      DEFAULT_MODULES_DIR,
  };

  if (issues.length > 0) {
    throw new ConfigError(issues);
  }

  return {
    figma,
    code,
    run: {
      components,
      mode,
    },
    paths,
  };
}

function normalizeRunMode(
  modeRaw: string | undefined,
  issues: string[],
): RunMode {
  if (modeRaw === undefined) {
    return DEFAULT_RUN_MODE;
  }
  if (isValidRunMode(modeRaw)) {
    return modeRaw;
  }
  issues.push(
    `[run].mode must be one of: ${VALID_RUN_MODES.join(", ")} (received "${modeRaw}")`,
  );
  return DEFAULT_RUN_MODE;
}

function isValidRunMode(mode: string): mode is RunMode {
  return VALID_RUN_MODES.includes(mode as RunMode);
}

export function parseConfigToml(tomlSource: string): SuperconnectConfig {
  const parsed = toml.parse(tomlSource);
  return normalizeConfig(parsed);
}

export function loadConfigFromFile(configPath: string): SuperconnectConfig {
  const content = fs.readFileSync(configPath, { encoding: "utf8" });
  return parseConfigToml(content);
}
