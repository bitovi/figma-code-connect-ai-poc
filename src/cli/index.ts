#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import packageJson from "../../package.json";
import {
  ConfigError,
  DEFAULT_ARTIFACTS_DIR,
  DEFAULT_COMPONENTS,
  DEFAULT_MODULES_DIR,
  DEFAULT_RUN_MODE,
  SuperconnectConfig,
  loadConfigFromFile,
} from "../config";
import { SecretError, resolveFigmaPat } from "../config/secrets";
import type { EnvSource } from "../config/secrets";

type MaybePromise<T> = T | Promise<T>;

export interface CliIO {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export interface CommandContext {
  args: string[];
  env: NodeJS.ProcessEnv;
  io: CliIO;
  route: CommandDescriptor;
}

export type CommandHandler = (context: CommandContext) => MaybePromise<number | void>;

export interface CommandDescriptor {
  path: readonly string[];
  summary: string;
  handler: CommandHandler;
}

const ROOT_COMMAND = "superconnect";
const INIT_CONFIG_FILENAME = "superconnect.config.toml";
const ENV_EXAMPLE_FILENAME = ".env.example";
const DOT_ENV_FILENAME = ".env";
const DEFAULT_FIGMA_FILE = "<FIGMA_FILE_ID_OR_URL>";
const DEFAULT_TOKEN_ENV = "FIGMA_PAT";
const DEFAULT_CODE_ROOT = "src";
const DEFAULT_TSCONFIG_PATH = "tsconfig.json";
const FIGMA_ME_ENDPOINT = "https://api.figma.com/v1/me";
const { promises: fsPromises } = fs;

const HELP_FLAGS = new Set(["-h", "--help"]);
const VERSION_FLAGS = new Set(["-v", "--version"]);

const defaultIO: CliIO = {
  stdout: process.stdout,
  stderr: process.stderr,
};

const commandDescriptors: CommandDescriptor[] = [
  {
    path: ["init"],
    summary: "Scaffold the default superconnect config and environment files.",
    handler: createInitCommandHandler(),
  },
  {
    path: ["auth", "check"],
    summary: "Resolve configuration and validate access to Figma using a PAT.",
    handler: createAuthCheckCommandHandler(),
  },
];

export async function runCli(
  argv: readonly string[] = process.argv.slice(2),
  io: CliIO = defaultIO,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  if (!Array.isArray(argv)) {
    throw new Error("argv must be an array of strings");
  }
  const trimmedArgs = argv.map((arg) => arg.trim()).filter((arg) => arg.length > 0);
  if (trimmedArgs.length === 0) {
    io.stdout.write(renderRootHelp());
    return 0;
  }

  const [firstArg, ...restArgs] = trimmedArgs;
  if (firstArg === "help") {
    return printHelp(restArgs, io);
  }

  if (VERSION_FLAGS.has(firstArg)) {
    io.stdout.write(renderVersion());
    return 0;
  }

  const { cleanedArgs, helpRequested } = stripHelpFlags(trimmedArgs);
  if (cleanedArgs.length === 0) {
    io.stdout.write(renderRootHelp());
    return 0;
  }

  const match = findCommand(cleanedArgs);
  if (!match) {
    const partialMatches = findPartialMatches(cleanedArgs);
    io.stderr.write(formatUnknownCommand(cleanedArgs, partialMatches));
    if (partialMatches.length === 0) {
      io.stdout.write(renderRootHelp());
    }
    return 1;
  }

  if (helpRequested) {
    io.stdout.write(renderCommandHelp(match.route));
    return 0;
  }

  const commandArgs = cleanedArgs.slice(match.consumed);
  try {
    const result = await match.route.handler({
      args: commandArgs,
      env,
      io,
      route: match.route,
    });
    return typeof result === "number" ? result : 0;
  } catch (error) {
    io.stderr.write(formatHandlerError(error));
    return 1;
  }
}

function printHelp(args: readonly string[], io: CliIO): number {
  if (args.length === 0) {
    io.stdout.write(renderRootHelp());
    return 0;
  }
  const match = findCommand(args);
  if (match) {
    io.stdout.write(renderCommandHelp(match.route));
    return 0;
  }
  const partialMatches = findPartialMatches(args);
  if (partialMatches.length > 0) {
    io.stdout.write(renderGroupHelp(args, partialMatches));
    return 0;
  }
  io.stderr.write(formatUnknownCommand(args, []));
  io.stdout.write(renderRootHelp());
  return 1;
}

function stripHelpFlags(args: readonly string[]): {
  cleanedArgs: string[];
  helpRequested: boolean;
} {
  const cleanedArgs: string[] = [];
  let helpRequested = false;
  for (const arg of args) {
    if (HELP_FLAGS.has(arg)) {
      helpRequested = true;
    } else {
      cleanedArgs.push(arg);
    }
  }
  return { cleanedArgs, helpRequested };
}

interface RouteMatch {
  route: CommandDescriptor;
  consumed: number;
}

function findCommand(args: readonly string[]): RouteMatch | undefined {
  let bestMatch: RouteMatch | undefined;
  for (const descriptor of commandDescriptors) {
    if (matchesPath(descriptor.path, args)) {
      const consumed = descriptor.path.length;
      if (!bestMatch || consumed > bestMatch.consumed) {
        bestMatch = { route: descriptor, consumed };
      }
    }
  }
  return bestMatch;
}

function findPartialMatches(args: readonly string[]): CommandDescriptor[] {
  if (args.length === 0) {
    return [];
  }
  return commandDescriptors.filter((descriptor) => {
    if (args.length >= descriptor.path.length) {
      return false;
    }
    for (let index = 0; index < args.length; index += 1) {
      if (descriptor.path[index] !== args[index]) {
        return false;
      }
    }
    return true;
  });
}

function matchesPath(path: readonly string[], args: readonly string[]): boolean {
  if (path.length === 0 || path.length > args.length) {
    return false;
  }
  for (let index = 0; index < path.length; index += 1) {
    if (path[index] !== args[index]) {
      return false;
    }
  }
  return true;
}

function renderRootHelp(): string {
  const lines = [
    `${ROOT_COMMAND} v${packageJson.version}`,
    "",
    `Usage: ${ROOT_COMMAND} <command> [options]`,
    "",
    "Commands:",
    ...commandDescriptors.map((descriptor) => formatCommandSummary(descriptor, 0)),
    "",
    `Run "${ROOT_COMMAND} help <command>" for details on a command.`,
  ];
  return lines.join("\n") + "\n";
}

function renderCommandHelp(descriptor: CommandDescriptor): string {
  const label = `${ROOT_COMMAND} ${descriptor.path.join(" ")}`.trim();
  return [`Usage: ${label} [options]`, "", descriptor.summary, ""].join("\n");
}

function renderGroupHelp(
  prefix: readonly string[],
  matches: readonly CommandDescriptor[],
): string {
  const commandLabel =
    prefix.length === 0
      ? ROOT_COMMAND
      : `${ROOT_COMMAND} ${prefix.join(" ")}`.trim();
  const lines = [
    `Usage: ${commandLabel} <subcommand> [options]`,
    "",
    "Available subcommands:",
    ...matches.map((descriptor) => formatCommandSummary(descriptor, prefix.length)),
    "",
    `Run "${commandLabel} <subcommand> --help" for more details.`,
  ];
  return lines.join("\n") + "\n";
}

function formatCommandSummary(
  descriptor: CommandDescriptor,
  prefixLength: number,
): string {
  const label = descriptor.path.slice(prefixLength).join(" ");
  const paddedLabel = label.length >= 18 ? label : label.padEnd(18, " ");
  return `  ${paddedLabel}${descriptor.summary}`;
}

function formatUnknownCommand(
  args: readonly string[],
  partialMatches: readonly CommandDescriptor[],
): string {
  const label = args.join(" ");
  if (partialMatches.length === 0) {
    return `Unknown command: ${label}\n`;
  }
  const groupHelp = renderGroupHelp(args, partialMatches);
  return [`Incomplete command: ${label}`, groupHelp].join("\n");
}

function renderVersion(): string {
  return `${ROOT_COMMAND} v${packageJson.version}\n`;
}

function formatHandlerError(error: unknown): string {
  if (error instanceof Error) {
    return `Command failed: ${error.message}\n`;
  }
  return `Command failed: ${String(error)}\n`;
}

function createPlaceholderHandler(name: string): CommandHandler {
  return ({ io }: CommandContext): number => {
    io.stderr.write(
      `Command "${name}" has not been implemented yet. ` +
        "Follow the remaining beads to build out this functionality.\n",
    );
    return 1;
  };
}

function createInitCommandHandler(): CommandHandler {
  return async ({ args, io }: CommandContext): Promise<number> => {
    if (args.length > 0) {
      io.stderr.write("`superconnect init` does not accept positional arguments yet.\n");
      return 1;
    }

    const projectDir = process.cwd();
    const configPath = path.join(projectDir, INIT_CONFIG_FILENAME);
    const envPath = path.join(projectDir, ENV_EXAMPLE_FILENAME);
    const configSource = renderConfigToml(buildDefaultConfig());
    const envSource = renderEnvExample();

    const createdConfig = await writeFileIfMissing(
      configPath,
      configSource,
      "Generated superconnect config",
      io,
    );
    const createdEnv = await writeFileIfMissing(
      envPath,
      envSource,
      "Generated .env.example",
      io,
    );

    if (!createdConfig && !createdEnv) {
      io.stdout.write("superconnect init did not create any files (they already exist).\n");
    }

    return 0;
  };
}

interface AuthCheckOptions {
  configPath: string;
  envFilePath: string;
}

function createAuthCheckCommandHandler(): CommandHandler {
  return async ({ args, env, io }: CommandContext): Promise<number> => {
    const optionsResult = parseAuthCheckArgs(args);
    if ("error" in optionsResult) {
      io.stderr.write(`${optionsResult.error}\n`);
      return 1;
    }
    const options = optionsResult.options;
    const projectDir = process.cwd();
    const resolvedConfigPath = resolvePathRelativeToCwd(options.configPath, projectDir);
    const resolvedEnvPath = resolvePathRelativeToCwd(options.envFilePath, projectDir);

    const config = loadConfigSafe(resolvedConfigPath, io);
    if (!config) {
      return 1;
    }

    const envFile = await readDotEnvFile(resolvedEnvPath);
    if (envFile.loaded) {
      io.stdout.write(`Loaded environment variables from ${envFile.relativePath}\n`);
    }

    const mergedEnv: EnvSource = {
      ...envFile.values,
      ...env,
    };

    let pat;
    try {
      pat = resolveFigmaPat(mergedEnv, config.figma.tokenEnv);
    } catch (error) {
      if (error instanceof SecretError) {
        io.stderr.write(`${error.message}\n`);
        return 1;
      }
      io.stderr.write(`Failed to resolve Figma token: ${String(error)}\n`);
      return 1;
    }

    io.stdout.write(`Resolved Figma PAT from ${pat.redactedDescription}\n`);

    try {
      const profile = await pingFigmaProfile(pat.value);
      io.stdout.write(
        [
          "Figma auth check succeeded:",
          `  User Handle: ${profile.handle ?? "<unknown>"}`,
          `  Email: ${profile.email ?? "<unknown>"}`,
          `  User ID: ${profile.id}`,
        ].join("\n") + "\n",
      );
      return 0;
    } catch (error) {
      io.stderr.write(`Figma auth check failed: ${String(error)}\n`);
      return 1;
    }
  };
}

function parseAuthCheckArgs(
  args: readonly string[],
): { options: AuthCheckOptions } | { error: string } {
  const options: AuthCheckOptions = {
    configPath: INIT_CONFIG_FILENAME,
    envFilePath: DOT_ENV_FILENAME,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--config") {
      const value = args[index + 1];
      if (!value) {
        return { error: "Missing value for --config" };
      }
      options.configPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--config=")) {
      options.configPath = arg.slice("--config=".length);
      continue;
    }
    if (arg === "--env-file") {
      const value = args[index + 1];
      if (!value) {
        return { error: "Missing value for --env-file" };
      }
      options.envFilePath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--env-file=")) {
      options.envFilePath = arg.slice("--env-file=".length);
      continue;
    }
    return { error: `Unknown argument: ${arg}` };
  }

  return { options };
}

interface DotEnvLoadResult {
  loaded: boolean;
  values: Record<string, string>;
  relativePath: string;
}

async function readDotEnvFile(envPath: string): Promise<DotEnvLoadResult> {
  try {
    const raw = await fsPromises.readFile(envPath, { encoding: "utf8" });
    const values = parseSimpleEnv(raw);
    return {
      loaded: true,
      values,
      relativePath: path.relative(process.cwd(), envPath) || envPath,
    };
  } catch (error) {
    if (isNotFound(error)) {
      return {
        loaded: false,
        values: {},
        relativePath: path.relative(process.cwd(), envPath) || envPath,
      };
    }
    throw error;
  }
}

function parseSimpleEnv(source: string): Record<string, string> {
  const values: Record<string, string> = {};
  const lines = source.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }
    const key = line.slice(0, equalsIndex).trim();
    if (!key) {
      continue;
    }
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Allow export-prefixed keys (e.g., "export FIGMA_PAT=")
    const normalizedKey = key.startsWith("export ") ? key.slice("export ".length).trim() : key;
    values[normalizedKey] = value;
  }
  return values;
}

function resolvePathRelativeToCwd(input: string, cwd: string): string {
  return path.isAbsolute(input) ? input : path.join(cwd, input);
}

function loadConfigSafe(configPath: string, io: CliIO): SuperconnectConfig | undefined {
  try {
    const config = loadConfigFromFile(configPath);
    io.stdout.write(`Loaded config from ${path.relative(process.cwd(), configPath) || configPath}\n`);
    return config;
  } catch (error) {
    if (error instanceof ConfigError) {
      io.stderr.write(`${error.message}\n`);
      return undefined;
    }
    if (isNotFound(error)) {
      io.stderr.write(`Config file not found: ${configPath}\n`);
      return undefined;
    }
    io.stderr.write(`Failed to load config: ${String(error)}\n`);
    return undefined;
  }
}

interface FigmaProfile {
  id: string;
  handle?: string;
  email?: string;
}

async function pingFigmaProfile(token: string): Promise<FigmaProfile> {
  const response = await fetch(FIGMA_ME_ENDPOINT, {
    method: "GET",
    headers: {
      "User-Agent": "superconnect-cli",
      "X-Figma-Token": token,
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(formatFigmaHttpError(response.status, response.statusText, text));
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Figma API returned malformed JSON");
  }

  return normalizeFigmaProfile(payload);
}

function formatFigmaHttpError(status: number, statusText: string, body: string): string {
  const trimmed = body.trim();
  const snippet = trimmed.length > 160 ? `${trimmed.slice(0, 160)}…` : trimmed;
  const details = snippet.length > 0 ? `: ${snippet}` : "";
  return `Figma API responded with ${status} ${statusText}${details}`;
}

function normalizeFigmaProfile(payload: unknown): FigmaProfile {
  if (!payload || typeof payload !== "object") {
    throw new Error("Figma API returned an unexpected response shape");
  }
  const record = payload as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "<unknown>";
  const handle = typeof record.handle === "string" ? record.handle : undefined;
  const email = typeof record.email === "string" ? record.email : undefined;
  if (id === "<unknown>") {
    throw new Error("Figma API response did not include a user id");
  }
  return { id, handle, email };
}

function buildDefaultConfig(): SuperconnectConfig {
  return {
    figma: {
      file: DEFAULT_FIGMA_FILE,
      tokenEnv: DEFAULT_TOKEN_ENV,
    },
    code: {
      root: DEFAULT_CODE_ROOT,
      tsconfig: DEFAULT_TSCONFIG_PATH,
    },
    run: {
      components: [...DEFAULT_COMPONENTS],
      mode: DEFAULT_RUN_MODE,
    },
    paths: {
      artifactsDir: DEFAULT_ARTIFACTS_DIR,
      modulesDir: DEFAULT_MODULES_DIR,
    },
  };
}

function renderConfigToml(config: SuperconnectConfig): string {
  const lines = [
    "# superconnect configuration generated by `superconnect init`",
    "# Update figma.file to point to your exact Figma file (ID or URL).",
    "",
    "[figma]",
    `file = ${jsonString(config.figma.file)}`,
    `tokenEnv = ${jsonString(config.figma.tokenEnv)}`,
    "",

    "[code]",
    `root = ${jsonString(config.code.root)}`,
    `tsconfig = ${jsonString(config.code.tsconfig)}`,
    "",

    "[run]",
    `components = ${jsonString(config.run.components)}`,
    `mode = ${jsonString(config.run.mode)}`,
    "",

    "[paths]",
    `artifactsDir = ${jsonString(config.paths.artifactsDir)}`,
    `modulesDir = ${jsonString(config.paths.modulesDir)}`,
    "",
  ];
  return lines.join("\n");
}

function renderEnvExample(): string {
  const lines = [
    "# Environment variables consumed by superconnect",
    "# Copy this file to .env and fill in the missing secrets.",
    "",
    `${DEFAULT_TOKEN_ENV}=`,
    "",
  ];
  return lines.join("\n");
}

function jsonString(value: string | readonly string[]): string {
  return JSON.stringify(value);
}

async function writeFileIfMissing(
  filePath: string,
  contents: string,
  successMessage: string,
  io: CliIO,
): Promise<boolean> {
  if (await fileExists(filePath)) {
    io.stdout.write(`Skipping ${path.basename(filePath)} (already exists).\n`);
    return false;
  }
  await fsPromises.writeFile(filePath, contents, { encoding: "utf8" });
  const relativePath = path.relative(process.cwd(), filePath) || filePath;
  io.stdout.write(`${successMessage}: ${relativePath}\n`);
  return true;
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fsPromises.access(targetPath, fs.constants.F_OK);
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

if (require.main === module) {
  runCli().then((code) => {
    process.exitCode = code;
  });
}
