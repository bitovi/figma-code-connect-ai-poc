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
import {
  createFigmaClient,
  extractDesignComponents,
  loadDesignArtifact,
  resolveDesignArtifactPath,
  writeDesignArtifact,
} from "../figma";
import {
  CODE_ARTIFACT_KIND,
  CODE_ARTIFACT_VERSION,
  discoverCodeComponents,
  loadCodeArtifact,
  loadCodeProject,
  resolveCodeArtifactPath,
  parseCodeArtifact,
  writeCodeArtifact,
} from "../code";
import {
  buildMappingArtifact,
  loadMappingArtifact,
  writeMappingArtifact,
} from "../mapping";
import {
  planModuleLayout,
  runModuleSanityCheck,
  writePlannedModules,
} from "../generation";
import type {
  CodeComponentsArtifact,
  CodeComponentRecord,
  CodeProject,
  ComponentDiscoveryResult,
} from "../code";

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
  {
    path: ["figma", "pull"],
    summary: "Fetch design components from Figma and write the artifact.",
    handler: createFigmaPullCommandHandler(),
  },
  {
    path: ["inspect", "design"],
    summary: "Pretty-print a design component slice from the artifacts.",
    handler: createInspectDesignCommandHandler(),
  },
  {
    path: ["inspect", "code"],
    summary: "Pretty-print a code component slice from the artifacts.",
    handler: createInspectCodeCommandHandler(),
  },
  {
    path: ["inspect", "mapping"],
    summary: "Pretty-print a mapping component slice from the artifacts.",
    handler: createInspectMappingCommandHandler(),
  },
  {
    path: ["code", "scan"],
    summary: "Scan the codebase for React components and write the artifact.",
    handler: createCodeScanCommandHandler(),
  },
  {
    path: ["map", "build"],
    summary: "Build component/property mappings from design and code artifacts.",
    handler: createMapBuildCommandHandler(),
  },
  {
    path: ["connect", "generate"],
    summary:
      "Generate Code Connect modules from mapping and code artifacts, with TS sanity checks.",
    handler: createConnectGenerateCommandHandler(),
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

interface ConnectGenerateOptions {
  configPath: string;
  dryRun: boolean;
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
    logEnvFileStatus(envFile, io);

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

function createFigmaPullCommandHandler(): CommandHandler {
  return async ({ args, env, io }: CommandContext): Promise<number> => {
    const optionsResult = parseFigmaPullArgs(args);
    if ("error" in optionsResult) {
      io.stderr.write(`${optionsResult.error}\n`);
      return 1;
    }
    const { configPath, envFilePath } = optionsResult.options;
    const projectDir = process.cwd();
    const resolvedConfigPath = resolvePathRelativeToCwd(configPath, projectDir);
    const resolvedEnvPath = resolvePathRelativeToCwd(envFilePath, projectDir);

    const config = loadConfigSafe(resolvedConfigPath, io);
    if (!config) {
      return 1;
    }

    const envFile = await readDotEnvFile(resolvedEnvPath);
    logEnvFileStatus(envFile, io);
    const mergedEnv: EnvSource = { ...envFile.values, ...env };

    try {
      const pat = resolveFigmaPat(mergedEnv, config.figma.tokenEnv);
      io.stdout.write(`Resolved Figma PAT from ${pat.redactedDescription}\n`);

      const client = createFigmaClient(pat.value);
      const extraction = await extractDesignComponents({
        client,
        figmaFile: config.figma.file,
        components: config.run.components,
      });

      const artifactsDir = path.isAbsolute(config.paths.artifactsDir)
        ? config.paths.artifactsDir
        : path.join(projectDir, config.paths.artifactsDir);
      const artifactPath = writeDesignArtifact(extraction.artifact, {
        baseDir: artifactsDir,
      });
      io.stdout.write(
        `Wrote design artifact to ${path.relative(projectDir, artifactPath) || artifactPath}\n`,
      );

      if (extraction.warnings.length > 0) {
        io.stderr.write(
          ["Warnings:", ...extraction.warnings.map((warning) => `  - ${warning}`)].join("\n") +
            "\n",
        );
      }

      return 0;
    } catch (error) {
      io.stderr.write(`Figma pull failed: ${String(error)}\n`);
      return 1;
    }
  };
}

function createInspectDesignCommandHandler(): CommandHandler {
  return async ({ args, io }: CommandContext): Promise<number> => {
    const parseResult = parseInspectComponentArgs(args);
    if ("error" in parseResult) {
      io.stderr.write(`${parseResult.error}\n`);
      return 1;
    }
    const { configPath, componentName } = parseResult.options;
    const projectDir = process.cwd();
    const resolvedConfigPath = resolvePathRelativeToCwd(configPath, projectDir);
    const config = loadConfigSafe(resolvedConfigPath, io);
    if (!config) {
      return 1;
    }
    const artifactsDir = path.isAbsolute(config.paths.artifactsDir)
      ? config.paths.artifactsDir
      : path.join(projectDir, config.paths.artifactsDir);
    let artifact;
    try {
      artifact = loadDesignArtifact({ baseDir: artifactsDir });
    } catch (error) {
      io.stderr.write(`Failed to load design artifact: ${String(error)}\n`);
      return 1;
    }
    const target = componentName.trim().toLowerCase();
    const match = artifact.components.find(
      (component) => component.componentName.trim().toLowerCase() === target,
    );
    if (!match) {
      const available = artifact.components.map((component) => component.componentName);
      io.stderr.write(
        [
          `Component "${componentName}" not found in design artifact.`,
          "Available components:",
          ...available.map((name) => `  - ${name}`),
        ].join("\n") + "\n",
      );
      return 1;
    }
    const yaml = renderYaml({
      componentName: match.componentName,
      pageName: match.pageName,
      componentNodeId: match.componentNodeId,
      variants: match.variants,
      description: match.description,
      warnings: artifact.warnings,
    });
    io.stdout.write(yaml + "\n");
    return 0;
  };
}

function createInspectCodeCommandHandler(): CommandHandler {
  return async ({ args, io }: CommandContext): Promise<number> => {
    const parseResult = parseInspectComponentArgs(args);
    if ("error" in parseResult) {
      io.stderr.write(`${parseResult.error}\n`);
      return 1;
    }
    const { configPath, componentName } = parseResult.options;
    const projectDir = process.cwd();
    const resolvedConfigPath = resolvePathRelativeToCwd(configPath, projectDir);
    const config = loadConfigSafe(resolvedConfigPath, io);
    if (!config) {
      return 1;
    }
    const artifactsDir = path.isAbsolute(config.paths.artifactsDir)
      ? config.paths.artifactsDir
      : path.join(projectDir, config.paths.artifactsDir);

    let artifact;
    try {
      artifact = loadCodeArtifact({ baseDir: artifactsDir });
    } catch (error) {
      io.stderr.write(`Failed to load code artifact: ${String(error)}\n`);
      return 1;
    }

    const match = findCodeComponent(artifact.components, componentName);
    if (!match) {
      const available = artifact.components.map((component) => component.componentName);
      io.stderr.write(
        [
          `Component "${componentName}" not found in code artifact.`,
          "Available components:",
          ...available.map((name) => `  - ${name}`),
        ].join("\n") + "\n",
      );
      return 1;
    }

    const yaml = renderYaml({
      componentName: match.componentName,
      exportName: match.exportName,
      modulePath: match.modulePath,
      props: match.props,
      description: match.description,
      notes: match.notes,
      warnings: artifact.warnings,
    });
    io.stdout.write(yaml + "\n");
    return 0;
  };
}

function createInspectMappingCommandHandler(): CommandHandler {
  return async ({ args, io }: CommandContext): Promise<number> => {
    const parseResult = parseInspectComponentArgs(args);
    if ("error" in parseResult) {
      io.stderr.write(`${parseResult.error}\n`);
      return 1;
    }
    const { configPath, componentName } = parseResult.options;
    const projectDir = process.cwd();
    const resolvedConfigPath = resolvePathRelativeToCwd(configPath, projectDir);
    const config = loadConfigSafe(resolvedConfigPath, io);
    if (!config) {
      return 1;
    }
    const artifactsDir = path.isAbsolute(config.paths.artifactsDir)
      ? config.paths.artifactsDir
      : path.join(projectDir, config.paths.artifactsDir);
    let artifact;
    try {
      artifact = loadMappingArtifact({ baseDir: artifactsDir });
    } catch (error) {
      io.stderr.write(`Failed to load mapping artifact: ${String(error)}\n`);
      return 1;
    }
    const target = componentName.trim().toLowerCase();
    const match = artifact.components.find(
      (component) => component.componentName.trim().toLowerCase() === target,
    );
    if (!match) {
      const available = artifact.components.map((component) => component.componentName);
      io.stderr.write(
        [
          `Component "${componentName}" not found in mapping artifact.`,
          "Available components:",
          ...available.map((name) => `  - ${name}`),
        ].join("\n") + "\n",
      );
      return 1;
    }
    const yaml = renderYaml({
      component: match,
    });
    io.stdout.write(yaml + "\n");
    return 0;
  };
}

function createCodeScanCommandHandler(): CommandHandler {
  return async ({ args, io }: CommandContext): Promise<number> => {
    const parseResult = parseBasicConfigArgs(args);
    if ("error" in parseResult) {
      io.stderr.write(`${parseResult.error}\n`);
      return 1;
    }
    const { configPath } = parseResult.options;
    const projectDir = process.cwd();
    const resolvedConfigPath = resolvePathRelativeToCwd(configPath, projectDir);
    const config = loadConfigSafe(resolvedConfigPath, io);
    if (!config) {
      return 1;
    }

    const artifactsDir = path.isAbsolute(config.paths.artifactsDir)
      ? config.paths.artifactsDir
      : path.join(projectDir, config.paths.artifactsDir);

    const resolvedCodeRoot = path.resolve(projectDir, config.code.root);
    const resolvedTsconfig = path.resolve(projectDir, config.code.tsconfig);

    try {
      let project = loadCodeProject({
        codeRoot: resolvedCodeRoot,
        tsconfigPath: resolvedTsconfig,
        components: config.run.components,
        cwd: projectDir,
      });
      let discovery = discoverCodeComponents(project);

      if (discovery.components.length === 0) {
        io.stderr.write("No components discovered; retrying after reloading project...\n");
        project = loadCodeProject({
          codeRoot: resolvedCodeRoot,
          tsconfigPath: resolvedTsconfig,
          components: config.run.components,
          cwd: projectDir,
        });
        discovery = discoverCodeComponents(project);
      }

      const artifact = buildCodeArtifact(project, discovery);
      if (artifact.components.length === 0) {
        io.stderr.write("Code scan produced no components after retry.\n");
        return 1;
      }

      const artifactPath = writeCodeArtifact(artifact, {
        baseDir: artifactsDir,
      });
      io.stdout.write(
        `Wrote code artifact to ${path.relative(projectDir, artifactPath) || artifactPath}\n`,
      );

      if (artifact.warnings.length > 0) {
        io.stderr.write(
          ["Warnings:", ...artifact.warnings.map((warning) => `  - ${warning}`)].join("\n") +
            "\n",
        );
      }

      return 0;
    } catch (error) {
      io.stderr.write(`Code scan failed: ${String(error)}\n`);
      return 1;
    }
  };
}

function createMapBuildCommandHandler(): CommandHandler {
  return async ({ args, io }: CommandContext): Promise<number> => {
    const parseResult = parseBasicConfigArgs(args);
    if ("error" in parseResult) {
      io.stderr.write(`${parseResult.error}\n`);
      return 1;
    }
    const { configPath } = parseResult.options;
    const projectDir = process.cwd();
    const resolvedConfigPath = resolvePathRelativeToCwd(configPath, projectDir);
    const config = loadConfigSafe(resolvedConfigPath, io);
    if (!config) {
      return 1;
    }
    const artifactsDir = path.isAbsolute(config.paths.artifactsDir)
      ? config.paths.artifactsDir
      : path.join(projectDir, config.paths.artifactsDir);

    const designPaths = { baseDir: artifactsDir };
    const codePaths = { baseDir: artifactsDir };

    let designArtifact;
    let codeArtifact;
    try {
      designArtifact = loadDesignArtifact(designPaths);
    } catch (error) {
      io.stderr.write(`Failed to load design artifact: ${String(error)}\n`);
      return 1;
    }
    try {
      codeArtifact = loadCodeArtifact(codePaths);
    } catch (error) {
      io.stderr.write(`Failed to load code artifact: ${String(error)}\n`);
      return 1;
    }

    const designArtifactPath = resolveDesignArtifactPath(designPaths);
    const codeArtifactPath = resolveCodeArtifactPath(codePaths);

    try {
      const result = buildMappingArtifact({
        design: { artifact: designArtifact, path: designArtifactPath },
        code: { artifact: codeArtifact, path: codeArtifactPath },
      });
      const artifactPath = writeMappingArtifact(result.artifact, {
        baseDir: artifactsDir,
      });
      io.stdout.write(
        `Wrote mapping artifact to ${path.relative(projectDir, artifactPath) || artifactPath}\n`,
      );
      if (result.warnings.length > 0) {
        io.stderr.write(
          ["Warnings:", ...result.warnings.map((warning) => `  - ${warning}`)].join("\n") + "\n",
        );
      }
      return 0;
    } catch (error) {
      io.stderr.write(`Mapping build failed: ${String(error)}\n`);
      return 1;
    }
  };
}

function createConnectGenerateCommandHandler(): CommandHandler {
  return async ({ args, io }: CommandContext): Promise<number> => {
    const parseResult = parseConnectGenerateArgs(args);
    if ("error" in parseResult) {
      io.stderr.write(`${parseResult.error}\n`);
      return 1;
    }
    const { configPath, dryRun } = parseResult.options;
    const projectDir = process.cwd();
    const resolvedConfigPath = resolvePathRelativeToCwd(configPath, projectDir);
    const config = loadConfigSafe(resolvedConfigPath, io);
    if (!config) {
      return 1;
    }

    const artifactsDir = path.isAbsolute(config.paths.artifactsDir)
      ? config.paths.artifactsDir
      : path.join(projectDir, config.paths.artifactsDir);
    const modulesDir = path.isAbsolute(config.paths.modulesDir)
      ? config.paths.modulesDir
      : path.join(projectDir, config.paths.modulesDir);

    let mappingArtifact;
    try {
      mappingArtifact = loadMappingArtifact({ baseDir: artifactsDir });
    } catch (error) {
      io.stderr.write(`Failed to load mapping artifact: ${String(error)}\n`);
      return 1;
    }

    let codeArtifact: CodeComponentsArtifact;
    try {
      const codeArtifactPath = mappingArtifact.codeArtifactPath;
      const payload = fs.readFileSync(codeArtifactPath, { encoding: "utf8" });
      codeArtifact = parseCodeArtifact(payload, codeArtifactPath);
    } catch (error) {
      io.stderr.write(
        `Failed to load code artifact referenced in mapping artifact: ${String(
          error,
        )}\n`,
      );
      return 1;
    }

    const generatorInput = {
      mapping: mappingArtifact,
      code: codeArtifact,
    };

    const layout = planModuleLayout(generatorInput, {
      modulesDir,
    });

    const sanityResults = runModuleSanityCheck(layout);
    const hasSyntaxError = sanityResults.some(
      (result) => result.parseStatus === "syntax-error",
    );

    let writeResults;
    if (!dryRun && !hasSyntaxError) {
      writeResults = writePlannedModules(layout, { overwrite: true });
    }

    const summary = renderConnectGenerateSummary(
      sanityResults,
      writeResults,
      projectDir,
      dryRun,
    );
    io.stdout.write(summary);

    if (hasSyntaxError) {
      const diagnostics = sanityResults
        .filter((result) => result.parseStatus === "syntax-error")
        .flatMap((result) => result.diagnostics);
      if (diagnostics.length > 0) {
        io.stderr.write(
          ["TypeScript parse errors in generated modules:", ...diagnostics].join("\n") +
            "\n",
        );
      }
      return 1;
    }

    return 0;
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

interface FigmaPullOptions {
  configPath: string;
  envFilePath: string;
}

interface BasicConfigOptions {
  configPath: string;
}

function parseBasicConfigArgs(
  args: readonly string[],
): { options: BasicConfigOptions } | { error: string } {
  const options: BasicConfigOptions = {
    configPath: INIT_CONFIG_FILENAME,
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
    return { error: `Unknown argument: ${arg}` };
  }
  return { options };
}

function parseConnectGenerateArgs(
  args: readonly string[],
): { options: ConnectGenerateOptions } | { error: string } {
  const options: ConnectGenerateOptions = {
    configPath: INIT_CONFIG_FILENAME,
    dryRun: false,
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
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    return { error: `Unknown argument: ${arg}` };
  }
  return { options };
}

function parseFigmaPullArgs(
  args: readonly string[],
): { options: FigmaPullOptions } | { error: string } {
  const options: FigmaPullOptions = {
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

interface InspectDesignOptions {
  configPath: string;
  componentName: string;
}

function parseInspectComponentArgs(
  args: readonly string[],
): { options: InspectDesignOptions } | { error: string } {
  const options: InspectDesignOptions = {
    configPath: INIT_CONFIG_FILENAME,
    componentName: "",
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
    if (arg === "--component") {
      const value = args[index + 1];
      if (!value) {
        return { error: "Missing value for --component" };
      }
      options.componentName = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--component=")) {
      options.componentName = arg.slice("--component=".length);
      continue;
    }
    return { error: `Unknown argument: ${arg}` };
  }
  if (!options.componentName) {
    return { error: "--component is required" };
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

function logEnvFileStatus(result: DotEnvLoadResult, io: CliIO): void {
  if (result.loaded) {
    io.stdout.write(`Loaded environment variables from ${result.relativePath}\n`);
  } else {
    io.stdout.write(
      `Environment file not found at ${result.relativePath}; falling back to process env.\n`,
    );
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

function renderYaml(value: unknown, indent = 0): string {
  const indentStr = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return indentStr + "[]";
    }
    return value
      .map((item) => {
        const formatted = renderYaml(item, indent + 2).trimStart();
        if (typeof item === "object" && item !== null && !Array.isArray(item)) {
          return `${indentStr}-\n${renderYaml(item, indent + 2)}`;
        }
        return `${indentStr}- ${formatted}`;
      })
      .join("\n");
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, entryValue]) => entryValue !== undefined,
    );
    if (entries.length === 0) {
      return indentStr + "{}";
    }
    return entries
      .map(([key, entryValue]) => {
        const formatted = renderYaml(entryValue, indent + 2);
        if (entryValue && typeof entryValue === "object") {
          return `${indentStr}${key}:\n${formatted}`;
        }
        return `${indentStr}${key}: ${formatted.trimStart()}`;
      })
      .join("\n");
  }
  if (typeof value === "string") {
    return indentStr + formatYamlString(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return indentStr + String(value);
  }
  if (value === null) {
    return indentStr + "null";
  }
  return indentStr + JSON.stringify(value);
}

function formatYamlString(value: string): string {
  if (value === "") {
    return JSON.stringify(value);
  }
  if (/^[A-Za-z0-9_\-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function renderConnectGenerateSummary(
  sanityResults: readonly import("../generation").ModuleSanityCheckResult[],
  writeResults: readonly import("../generation").GeneratedModuleFileInfo[] | undefined,
  projectDir: string,
  dryRun: boolean,
): string {
  const lines: string[] = [];

  const componentRows = sanityResults.filter(
    (result) => result.kind === "component",
  );
  const entryRow = sanityResults.find((result) => result.kind === "entry");

  const writeIndex = new Map<string, import("../generation").GeneratedModuleFileInfo>();
  if (writeResults) {
    for (const result of writeResults) {
      writeIndex.set(result.filePath, result);
    }
  }

  lines.push("Code Connect generation summary:");
  lines.push("");

  if (componentRows.length > 0) {
    lines.push("Components:");
    lines.push("  Name        TS     Write    File");
    for (const row of componentRows) {
      const name = (row.componentName ?? "<unknown>").padEnd(11);
      const tsStatus = (row.parseStatus === "ok" ? "ok" : "error").padEnd(7);
      let writeStatus = dryRun ? "dry-run" : "-";
      if (!dryRun && writeResults) {
        const writeInfo = writeIndex.get(row.filePath);
        if (writeInfo) {
          writeStatus =
            writeInfo.writeStatus === "written" ? "written" : "skipped";
        }
      }
      const relativePath = path.relative(projectDir, row.filePath) || row.filePath;
      lines.push(
        `  ${name}${tsStatus}${writeStatus.padEnd(9)}${relativePath}`,
      );
    }
    lines.push("");
  }

  if (entryRow) {
    const tsStatus = (entryRow.parseStatus === "ok" ? "ok" : "error").padEnd(7);
    let writeStatus = dryRun ? "dry-run" : "-";
    if (!dryRun && writeResults) {
      const writeInfo = writeIndex.get(entryRow.filePath);
      if (writeInfo) {
        writeStatus =
          writeInfo.writeStatus === "written" ? "written" : "skipped";
      }
    }
    const relativePath =
      path.relative(projectDir, entryRow.filePath) || entryRow.filePath;
    lines.push("Entry module:");
    lines.push(
      `  ${tsStatus}${writeStatus.padEnd(9)}${relativePath}`,
    );
  }

  if (dryRun) {
    lines.push("");
    lines.push("Note: --dry-run enabled; no files were written.");
  }

  lines.push("");

  return lines.join("\n");
}

function buildCodeArtifact(
  project: CodeProject,
  discovery: ComponentDiscoveryResult,
): CodeComponentsArtifact {
  const warnings: string[] = [];
  if (discovery.missing.length > 0) {
    warnings.push(
      `Missing components from run.components: ${discovery.missing.join(", ")}`,
    );
  }

  return {
    kind: CODE_ARTIFACT_KIND,
    version: CODE_ARTIFACT_VERSION,
    codeRoot: project.projectRoot,
    tsconfigPath: project.tsconfigPath,
    generatedAt: new Date().toISOString(),
    components: discovery.components,
    warnings,
  };
}

function findCodeComponent(
  components: readonly CodeComponentRecord[],
  name: string,
): CodeComponentRecord | undefined {
  const target = name.trim().toLowerCase();
  return components.find(
    (component) => component.componentName.trim().toLowerCase() === target,
  );
}

if (require.main === module) {
  runCli().then((code) => {
    process.exitCode = code;
  });
}
