import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export interface LoadCodeProjectOptions {
  codeRoot: string;
  tsconfigPath: string;
  components: string[];
  cwd?: string;
}

export interface CodeProject {
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly projectRoot: string;
  readonly tsconfigPath: string;
  readonly sourceFiles: readonly ts.SourceFile[];
  readonly components: readonly string[];
}

export class CodeProjectError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(
      [
        "Unable to load TypeScript project:",
        ...issues.map((issue) => `- ${issue}`),
      ].join("\n"),
    );
    this.issues = issues;
  }
}

export function loadCodeProject(options: LoadCodeProjectOptions): CodeProject {
  const issues: string[] = [];
  const cwd = normalizeDirectory(options.cwd ?? process.cwd(), "cwd", issues);

  const projectRoot = normalizeDirectory(
    path.resolve(cwd, options.codeRoot),
    "code.root",
    issues,
  );
  const tsconfigPath = normalizeFile(
    path.resolve(cwd, options.tsconfigPath),
    "code.tsconfig",
    issues,
  );

  const components = normalizeComponentList(options.components, issues);

  const parsedTsconfig = parseTsconfig(tsconfigPath, projectRoot, issues);

  const rootFiles = parsedTsconfig.fileNames.filter((fileName) =>
    isWithinProject(fileName, projectRoot),
  );
  if (rootFiles.length === 0) {
    issues.push(
      `tsconfig produced no files under ${projectRoot}; verify [code].root + tsconfig include`,
    );
  }

  if (issues.length > 0) {
    throw new CodeProjectError(issues);
  }

  const host = ts.createCompilerHost(parsedTsconfig.options, true);
  const program = ts.createProgram({
    options: parsedTsconfig.options,
    rootNames: rootFiles,
    host,
  });

  return {
    program,
    checker: program.getTypeChecker(),
    projectRoot,
    tsconfigPath,
    sourceFiles: program
      .getSourceFiles()
      .filter((file) => isWithinProject(file.fileName, projectRoot)),
    components,
  };
}

function normalizeDirectory(
  candidate: string,
  label: string,
  issues: string[],
): string {
  try {
    const stats = fs.statSync(candidate);
    if (stats.isDirectory()) {
      return candidate;
    }
  } catch {
    // fall through to error reporting
  }
  issues.push(`${label} directory not found: ${candidate}`);
  return candidate;
}

function normalizeFile(candidate: string, label: string, issues: string[]): string {
  try {
    const stats = fs.statSync(candidate);
    if (stats.isFile()) {
      return candidate;
    }
  } catch {
    // fall through to error reporting
  }
  issues.push(`${label} file not found: ${candidate}`);
  return candidate;
}

function normalizeComponentList(
  components: string[],
  issues: string[],
): string[] {
  const normalized = Array.from(
    new Set(
      components
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
  if (normalized.length === 0) {
    issues.push("run.components must include at least one component name");
  }
  return normalized;
}

function parseTsconfig(
  tsconfigPath: string,
  projectRoot: string,
  issues: string[],
): ts.ParsedCommandLine {
  const readResult = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (readResult.error) {
    issues.push(formatDiagnostic(readResult.error, projectRoot));
    return {
      options: {},
      fileNames: [],
      errors: [readResult.error],
    };
  }

  const parsed = ts.parseJsonConfigFileContent(
    readResult.config,
    ts.sys,
    path.dirname(tsconfigPath),
    {},
    tsconfigPath,
  );

  parsed.errors.forEach((diagnostic) => {
    issues.push(formatDiagnostic(diagnostic, projectRoot));
  });

  return parsed;
}

function formatDiagnostic(diagnostic: ts.Diagnostic, projectRoot: string): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  const file = diagnostic.file;
  if (file && diagnostic.start !== undefined) {
    const { line, character } = file.getLineAndCharacterOfPosition(diagnostic.start);
    const relativePath = path.relative(projectRoot, file.fileName);
    return `${relativePath}:${line + 1}:${character + 1} - ${message}`;
  }
  return message;
}

function isWithinProject(candidate: string, projectRoot: string): boolean {
  const normalizedRoot = path.normalize(projectRoot);
  const normalizedCandidate = path.normalize(candidate);
  if (normalizedCandidate === normalizedRoot) {
    return true;
  }
  const rootWithSep = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : `${normalizedRoot}${path.sep}`;
  return normalizedCandidate.startsWith(rootWithSep);
}
