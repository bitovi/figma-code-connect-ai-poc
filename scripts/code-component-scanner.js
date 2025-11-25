#!/usr/bin/env node

/**
 * Single-file helper to scan a React/TypeScript codebase for component exports.
 * Now offers a CLI compatible with extractComponentProps.js while keeping a
 * TypeScript-checker-based core for better accuracy.
 */

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { Command } = require("commander");
const chalk = require("chalk").default;
const fg = require("fast-glob");
const { z } = require("zod");

const DEFAULT_CONFIG = {
  input: "chakra-ui/apps/compositions/src/ui",
  output: "components-props",
  dryRun: false,
  verbose: false,
  overwrite: false,
  filter: null,
  recipesPath: "chakra-ui/packages/react/src/theme/recipes",
};

const PROP_CATEGORIES = {
  content: ["children", "label", "text", "placeholder", "value", "title", "description"],
  style: ["className", "style", "color", "bg", "backgroundColor", "borderColor", "shadow"],
  behavior: ["onClick", "onHover", "onFocus", "onBlur", "disabled", "loading", "readOnly"],
  layout: ["size", "width", "height", "margin", "padding", "flex", "position"],
  variant: ["variant", "size", "colorScheme", "theme", "appearance"],
};

const FIGMA_MAPPING_HINTS = {
  string: ["children", "label", "text", "placeholder", "aria-label", "title"],
  boolean: ["disabled", "loading", "readOnly", "isOpen", "isActive", "isRequired"],
  enum: ["variant", "size", "colorScheme", "placement", "orientation", "direction"],
  className: ["className", "class"],
  instance: ["icon", "startIcon", "endIcon", "avatar", "leftIcon", "rightIcon"],
};

const CODE_ARTIFACT_KIND = "code.components";
const CODE_ARTIFACT_VERSION = 1;

function parseArgs() {
  const program = new Command();
  program
    .option("--input <path>", "Input code root", DEFAULT_CONFIG.input)
    .option("--output <path>", "Output directory", DEFAULT_CONFIG.output)
    .option("--manifest <path>", "Manifest JSON with componentRoot/recipesPath overrides")
    .option("--filter <name>", "Filter by component name substring (case-insensitive)")
    .option("--dry-run", "Preview without writing files")
    .option("--verbose", "Detailed logging")
    .option("--overwrite", "Overwrite existing files")
    .option("--tsconfig <path>", "Tsconfig path (required unless manifest provides tsconfigPath)")
    .option("--component-scope <path>", "Component scope JSON (from orientation) to limit extraction");
  program.parse(process.argv);
  const opts = program.opts();
  const config = {
    ...DEFAULT_CONFIG,
    input: opts.input,
    output: opts.output,
    dryRun: !!opts.dryRun,
    verbose: !!opts.verbose,
    overwrite: !!opts.overwrite,
    filter: opts.filter || null,
    components: [],
    componentScope: opts.componentScope || null
  };
  let manifestPath = opts.manifest || null;
  let tsconfigPath = opts.tsconfig || null;
  if (manifestPath) {
    try {
      const manifest = loadManifestFile(manifestPath);
      if (manifest.componentRoot) config.input = manifest.componentRoot;
      if (manifest.recipesPath) config.recipesPath = manifest.recipesPath;
      if (manifest.tsconfigPath) tsconfigPath = manifest.tsconfigPath;
    } catch (err) {
      console.warn(`⚠️  Could not load manifest at ${manifestPath}: ${err.message}`);
    }
  }
  config.tsconfigPath = tsconfigPath;
  if (config.componentScope) {
    try {
      const scope = loadComponentScope(config.componentScope);
      config.components = scope.components;
    } catch (err) {
      console.warn(`⚠️  Could not load component scope at ${config.componentScope}: ${err.message}`);
    }
  }
  return config;
}

function showHelp() {
  console.log(`
📋 Code component scanner (TS-checker)

Usage:
  node scripts/code-component-scanner.js [OPTIONS]

Options:
  --input <path>     Input code root (default: ${DEFAULT_CONFIG.input})
  --output <path>    Output directory for JSON files (default: ${DEFAULT_CONFIG.output})
  --manifest <path>  Manifest JSON with componentRoot/recipesPath overrides
  --filter <name>    Filter by component name substring (case-insensitive)
  --dry-run          Preview without writing files
  --verbose          Detailed logging
  --overwrite        Overwrite existing files
  --tsconfig <path>  Tsconfig path (required unless manifest provides tsconfigPath)
  --component-scope <path>  Component scope JSON (from orientation) to limit extraction
  --help             Show this help

Examples:
  node scripts/code-component-scanner.js --manifest artifacts/codeconnect-manifest.json --output artifacts/react-components --overwrite --verbose
`);
}

function loadManifestFile(manifestPath) {
  const raw = fs.readFileSync(manifestPath, "utf8");
  return JSON.parse(raw);
}

function loadComponentScope(scopePath) {
  const raw = fs.readFileSync(scopePath, "utf8");
  const parsed = JSON.parse(raw);
  const ScopeSchema = z.object({
    reactComponents: z.array(z.string()).optional(),
    fromFigma: z.array(
      z.object({
        figmaName: z.string().optional(),
        figmaId: z.string().optional(),
        reactCandidates: z.array(z.string()).optional(),
        parents: z.array(z.string()).optional(),
        children: z.array(z.string()).optional(),
      }),
    ).optional(),
  });
  ScopeSchema.parse(parsed);
  const ensureArray = (value) => (Array.isArray(value) ? value : []);
  const names = new Set();
  const add = (name) => {
    if (typeof name !== "string") return;
    const trimmed = name.trim();
    if (trimmed) names.add(trimmed);
  };
  ensureArray(parsed.reactComponents).forEach(add);
  ensureArray(parsed.components).forEach(add);
  ensureArray(parsed.fromFigma || parsed.scope).forEach((entry) => {
    add(entry.reactComponent);
    ensureArray(entry.reactCandidates).forEach(add);
    ensureArray(entry.parents).forEach(add);
    ensureArray(entry.children).forEach(add);
  });
  return { components: Array.from(names).sort() };
}

class CodeProjectError extends Error {
  constructor(issues) {
    super(
      ["Unable to load TypeScript project:", ...issues.map((issue) => `- ${issue}`)].join("\n"),
    );
    this.issues = issues;
  }
}

class CodeArtifactError extends Error {
  constructor(issues) {
    super(
      ["Invalid code components artifact:", ...issues.map((issue) => `- ${issue}`)].join("\n"),
    );
    this.issues = issues;
  }
}

function loadCodeProject(options) {
  const issues = [];
  const cwd = normalizeDirectory(options.cwd ?? process.cwd(), "cwd", issues);
  const projectRoot = normalizeDirectory(path.resolve(cwd, options.codeRoot), "code.root", issues);
  let tsconfigPath = null;
  if (options.tsconfigPath) {
    tsconfigPath = normalizeFile(path.resolve(cwd, options.tsconfigPath), "code.tsconfig", issues);
  } else {
    issues.push("code.tsconfig missing: provide --tsconfig or set manifest.tsconfigPath");
  }
  const components = options.components
    ? normalizeComponentList(options.components, issues, false)
    : [];
  if (issues.length > 0) {
    throw new CodeProjectError(issues);
  }
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

function discoverCodeComponents(project) {
  const moduleExports = analyzeExports(project.program, project.sourceFiles);
  const components = [];
  const missing = [];
  for (const targetName of project.components) {
    const override = CANONICAL_EXPORT_OVERRIDES[targetName];
    const exportName = override?.exportName ?? targetName;
    const match = moduleExports.get(exportName);
    if (!match) {
      missing.push(targetName);
      continue;
    }
    const record = buildComponentRecord(targetName, match, project.program, project.projectRoot);
    components.push(
      override?.note ? { ...record, notes: [...record.notes, override.note] } : record,
    );
  }
  return { components, missing };
}

function autoDiscoverComponentNames(program, sourceFiles, filterValue) {
  const exportsMap = analyzeExports(program, sourceFiles);
  const names = Array.from(exportsMap.keys());
  if (!filterValue) return { names, exportsMap };
  const lowered = filterValue.toLowerCase();
  return {
    names: names.filter((name) => name.toLowerCase().includes(lowered)),
    exportsMap,
  };
}

/**
 * Convenience wrapper: load a project and return the full artifact shape.
 */
function scanCodeComponents(options) {
  const project = loadCodeProject(options);
  const { components, missing } = discoverCodeComponents(project);
  const warnings = missing.map(
    (name) => `Component "${name}" was not found in the codebase exports`,
  );
  const artifact = {
    kind: CODE_ARTIFACT_KIND,
    version: CODE_ARTIFACT_VERSION,
    codeRoot: project.projectRoot,
    tsconfigPath: project.tsconfigPath,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    components,
    warnings,
  };
  return { artifact, warnings };
}

function analyzeExports(program, sourceFiles) {
  const checker = program.getTypeChecker();
  const exports = new Map();
  for (const sourceFile of sourceFiles) {
    if (!sourceFile.isDeclarationFile && ts.isExternalModule(sourceFile)) {
      const symbol = checker.getSymbolAtLocation(sourceFile);
      if (!symbol) {
        continue;
      }
      checker.getExportsOfModule(symbol).forEach((exportSymbol) => {
        const exportName = exportSymbol.getName();
        const modulePath =
          exportSymbol.valueDeclaration?.getSourceFile().fileName ?? sourceFile.fileName;
        exports.set(exportName, {
          exportName,
          modulePath,
          symbol: exportSymbol,
          moduleSymbol: symbol,
        });
      });
    }
  }
  return exports;
}

function buildComponentRecord(componentName, match, program, projectRoot) {
  const checker = program.getTypeChecker();
  let propsType = resolvePropsType(match.symbol, checker);
  let propsSource = "none";
  if (propsType) {
    propsSource = "callSignature";
  } else {
    propsType = resolveAliasPropsType(match, checker, program);
    if (propsType) {
      propsSource = "alias";
    }
  }
  const normalizedPropsType = propsType ? unwrapUtilityPropsType(propsType, checker) : undefined;
  const props = normalizedPropsType ? extractProps(normalizedPropsType, checker) : [];
  const notes =
    propsType === undefined
      ? ["Unable to resolve props type; falling back to empty props"]
      : propsSource === "alias"
        ? [`Props derived from ${match.exportName}Props alias`]
        : [];
  return {
    componentName,
    exportName: match.exportName,
    modulePath: normalizeModulePath(match.modulePath, projectRoot),
    props,
    description: getJsDoc(match.symbol, checker),
    notes,
  };
}

function pipelineComponent(record, projectRoot, recipes, mappingHintsEnabled = true) {
  const filePathAbs = path.resolve(projectRoot, record.modulePath);
  const filePath = path.relative(process.cwd(), filePathAbs);
  const relativePath = `./${filePath.split(path.sep).join("/")}`;
  const recipeName = record.componentName.toLowerCase();
  const recipe = recipes.get(recipeName);
  const variantProperties = {};
  const recipeVariants = [];
  if (recipe) {
    for (const [variantName, variantDef] of Object.entries(recipe.variants)) {
      recipeVariants.push({
        name: variantName,
        type:
          variantDef.type === "enum" && Array.isArray(variantDef.values)
            ? variantDef.values.map((v) => `"${v}"`).join(" | ")
            : variantDef.type,
        required: variantDef.required || false,
        defaultValue: null,
        description: `Recipe variant: ${variantName}`,
        category: "variant",
        unionValues: variantDef.values || [],
        source: "recipe",
      });
      variantProperties[variantName] = variantDef.values || [];
    }
  }
  const props = record.props.map((prop) => formatProp(prop));
  props.forEach((prop) => {
    if (prop.unionValues && prop.unionValues.length > 0) {
      variantProperties[prop.name] = prop.unionValues;
    }
  });
  const allProps = props.concat(recipeVariants);
  const potentialFigmaMapping = mappingHintsEnabled ? generateFigmaMapping(allProps) : {};
  return {
    componentName: record.componentName,
    filePath,
    relativePath,
    exportType: "",
    exportName: record.exportName,
    interfaceName: "",
    extendsInterface: "",
    description: record.description || "",
    props,
    recipeVariants,
    variantProperties,
    totalProps: allProps.length,
    potentialFigmaMapping,
  };
}

function formatProp(prop) {
  const model = prop.model ?? { kind: "unknown" };
  const type =
    model.kind === "boolean"
      ? "boolean"
      : model.kind === "enum"
        ? model.values.map((v) => `"${v}"`).join(" | ")
        : model.kind === "string"
          ? "string"
          : model.reason || "unknown";
  const unionValues = model.kind === "enum" ? model.values : [];
  return {
    name: prop.propName ?? prop.name ?? "",
    type,
    required: !!prop.required,
    defaultValue: model.defaultValue ?? null,
    description: prop.description || "",
    category: classifyProp(prop.propName ?? prop.name ?? ""),
    unionValues,
  };
}

function resolvePropsType(symbol, checker) {
  const target = derefAlias(symbol, checker);
  const valueDeclaration = target.valueDeclaration ?? target.declarations?.[0];
  if (!valueDeclaration) {
    return undefined;
  }
  const type = checker.getTypeOfSymbolAtLocation(target, valueDeclaration);
  const signature = type.getCallSignatures()[0];
  if (!signature) {
    return undefined;
  }
  const params = signature.getParameters();
  if (params.length === 0) {
    return undefined;
  }
  const propsParam = params[0];
  return checker.getTypeOfSymbolAtLocation(
    propsParam,
    propsParam.valueDeclaration ?? valueDeclaration,
  );
}

function resolveAliasPropsType(match, checker, program) {
  const aliasName = `${match.exportName}Props`;
  const moduleExports = checker.getExportsOfModule(match.moduleSymbol);
  const aliasSymbol = moduleExports.find(
    (candidate) => candidate.getName() === aliasName && isPropsTypeSymbol(candidate, checker),
  );
  const symbol = aliasSymbol ?? findTypeAliasSymbol(aliasName, checker, program);
  if (!symbol) {
    return undefined;
  }
  const target = derefAlias(symbol, checker);
  const declaration = target.declarations?.[0];
  if (!declaration) {
    return undefined;
  }
  return checker.getDeclaredTypeOfSymbol(target);
}

function isPropsTypeSymbol(symbol, checker) {
  const target = derefAlias(symbol, checker);
  const flags = target.getFlags();
  if (flags & ts.SymbolFlags.TypeAlias) {
    return true;
  }
  if (flags & ts.SymbolFlags.Interface) {
    return true;
  }
  return false;
}

function extractProps(type, checker) {
  const props = [];
  const symbolMap = new Map();
  const collect = (candidate) => {
    const apparent = checker.getApparentType(candidate);
    checker.getPropertiesOfType(apparent).forEach((symbol) => {
      if (!symbolMap.has(symbol.getName())) {
        symbolMap.set(symbol.getName(), symbol);
      }
    });
  };
  if (type.isIntersection()) {
    type.types.forEach(collect);
  } else {
    collect(type);
  }
  symbolMap.forEach((propSymbol) => {
    const declaration = propSymbol.valueDeclaration ?? propSymbol.declarations?.[0];
    if (!declaration) {
      return;
    }
    const propType = checker.getTypeOfSymbolAtLocation(propSymbol, declaration);
    const model = deriveModel(propType, declaration, checker);
    props.push({
      propName: propSymbol.getName(),
      required: !isOptional(propSymbol),
      description: getJsDoc(propSymbol, checker),
      declaredBy: resolveParentName(propSymbol),
      model,
    });
  });
  return props.sort((a, b) => a.propName.localeCompare(b.propName));
}

function deriveModel(type, declaration, checker) {
  const defaultLiteral = readDefaultLiteral(declaration) ?? readLiteralFromType(type);
  if (isBooleanType(type)) {
    const model = { kind: "boolean" };
    if (typeof defaultLiteral === "boolean") {
      model.defaultValue = defaultLiteral;
    }
    return model;
  }
  const enumValues = extractStringEnumValues(type);
  if (enumValues.length > 0) {
    const model = { kind: "enum", values: enumValues };
    if (typeof defaultLiteral === "string" && enumValues.includes(defaultLiteral)) {
      model.defaultValue = defaultLiteral;
    }
    return model;
  }
  if (isStringType(type)) {
    const model = { kind: "string" };
    if (typeof defaultLiteral === "string") {
      model.defaultValue = defaultLiteral;
    }
    return model;
  }
  return { kind: "unknown", reason: checker.typeToString(type) };
}

function isOptional(symbol) {
  return (symbol.getFlags() & ts.SymbolFlags.Optional) !== 0;
}

function resolveParentName(symbol) {
  const parent = symbol.parent;
  if (!parent || !parent.name || parent.name === "__type") {
    return undefined;
  }
  return parent.name;
}

function getJsDoc(symbol, checker) {
  const comment = ts.displayPartsToString(symbol.getDocumentationComment(checker));
  return comment.trim() || undefined;
}

function normalizeModulePath(fileName, projectRoot) {
  const relative = path.relative(projectRoot, fileName);
  return relative.split(path.sep).join("/");
}

const CANONICAL_EXPORT_OVERRIDES = {
  Breadcrumb: {
    exportName: "BreadcrumbRoot",
    note: "Using BreadcrumbRoot as the canonical code export for Breadcrumb",
  },
};

function derefAlias(symbol, checker) {
  if (symbol.getFlags() & ts.SymbolFlags.Alias) {
    const target = checker.getAliasedSymbol(symbol);
    return target ?? symbol;
  }
  return symbol;
}

function findTypeAliasSymbol(name, checker, program) {
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) {
      continue;
    }
    const locals = sourceFile.locals;
    if (!locals) {
      continue;
    }
    const symbol = locals.get(name);
    if (symbol && isPropsTypeSymbol(symbol, checker)) {
      return symbol;
    }
  }
  return undefined;
}

function unwrapUtilityPropsType(type, checker) {
  let current = type;
  const visited = new Set();
  while (!visited.has(current)) {
    visited.add(current);
    const aliasName = current.aliasSymbol?.getName();
    if (aliasName === "HTMLChakraProps" && current.aliasTypeArguments?.length) {
      const next = current.aliasTypeArguments[current.aliasTypeArguments.length - 1];
      if (next) {
        current = next;
        continue;
      }
    }
    const declaration = current.symbol?.declarations?.find(ts.isInterfaceDeclaration);
    if (declaration) {
      const resolved = unwrapInterfaceExtends(declaration, checker);
      if (resolved) {
        current = resolved;
        continue;
      }
    }
    break;
  }
  return current;
}

function unwrapInterfaceExtends(declaration, checker) {
  if (!declaration.heritageClauses) {
    return undefined;
  }
  for (const clause of declaration.heritageClauses) {
    for (const typeNode of clause.types) {
      if (
        ts.isExpressionWithTypeArguments(typeNode) &&
        ts.isIdentifier(typeNode.expression) &&
        typeNode.expression.text === "HTMLChakraProps" &&
        typeNode.typeArguments &&
        typeNode.typeArguments.length > 0
      ) {
        const targetNode = typeNode.typeArguments[typeNode.typeArguments.length - 1];
        return checker.getTypeFromTypeNode(targetNode);
      }
    }
  }
  return undefined;
}

function isBooleanType(type) {
  if (type.flags & ts.TypeFlags.BooleanLike) {
    return true;
  }
  if (type.isUnion()) {
    return type.types.every((member) => isBooleanType(member) || isOptionalType(member));
  }
  return false;
}

function isStringType(type) {
  if (type.flags & ts.TypeFlags.StringLike) {
    return true;
  }
  if (type.isUnion()) {
    return type.types.every((member) => isStringType(member) || isOptionalType(member));
  }
  return false;
}

function readDefaultLiteral(declaration) {
  const initializer = findInitializer(declaration);
  if (!initializer) {
    return undefined;
  }
  if (ts.isStringLiteralLike(initializer)) {
    return initializer.text;
  }
  if (initializer.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (initializer.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  return undefined;
}

function readLiteralFromType(type) {
  if (type.isStringLiteral()) {
    return type.value;
  }
  const booleanValue = getBooleanLiteralValue(type);
  if (booleanValue !== undefined) {
    return booleanValue;
  }
  return undefined;
}

function findInitializer(declaration) {
  if (!declaration) {
    return undefined;
  }
  if (
    ts.isPropertyDeclaration(declaration) ||
    ts.isPropertySignature(declaration) ||
    ts.isParameter(declaration) ||
    ts.isVariableDeclaration(declaration) ||
    ts.isBindingElement(declaration)
  ) {
    const node = declaration;
    return node.initializer ?? undefined;
  }
  return undefined;
}

function extractStringEnumValues(type) {
  if (!type.isUnion()) {
    return [];
  }
  const values = [];
  for (const member of type.types) {
    if (member.isStringLiteral()) {
      values.push(member.value);
      continue;
    }
    if (isOptionalType(member)) {
      continue;
    }
    return [];
  }
  return Array.from(new Set(values)).sort();
}

function getBooleanLiteralValue(type) {
  if ((type.flags & ts.TypeFlags.BooleanLiteral) === 0) {
    return undefined;
  }
  const literal = type;
  if (literal.intrinsicName === "true") {
    return true;
  }
  if (literal.intrinsicName === "false") {
    return false;
  }
  return undefined;
}

function isOptionalType(type) {
  return (type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)) !== 0;
}

function normalizeDirectory(candidate, label, issues) {
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

function normalizeFile(candidate, label, issues) {
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

function normalizeComponentList(components, issues, requireNonEmpty = true) {
  const normalized = Array.from(
    new Set(
      components
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
  if (requireNonEmpty && normalized.length === 0) {
    issues.push("run.components must include at least one component name");
  }
  return normalized;
}

function parseTsconfig(tsconfigPath, projectRoot, issues) {
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

function formatDiagnostic(diagnostic, projectRoot) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  const file = diagnostic.file;
  if (file && diagnostic.start !== undefined) {
    const { line, character } = file.getLineAndCharacterOfPosition(diagnostic.start);
    const relativePath = path.relative(projectRoot, file.fileName);
    return `${relativePath}:${line + 1}:${character + 1} - ${message}`;
  }
  return message;
}

function isWithinProject(candidate, projectRoot) {
  const normalizedRoot = path.normalize(projectRoot);
  const normalizedCandidate = path.normalize(candidate);
  if (normalizedCandidate === normalizedRoot) {
    return true;
  }
  const rootWithSep = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`;
  return normalizedCandidate.startsWith(rootWithSep);
}

function classifyProp(propName) {
  const lowered = propName.toLowerCase();
  for (const [category, keywords] of Object.entries(PROP_CATEGORIES)) {
    if (keywords.some((kw) => lowered.includes(kw.toLowerCase()))) {
      return category;
    }
  }
  return "other";
}

function generateFigmaMapping(props) {
  const mapping = {};
  props.forEach((prop) => {
    const name = prop.name;
    if (!name) return;
    if (prop.unionValues && prop.unionValues.length > 0) {
      mapping[name] = "figma.enum";
      return;
    }
    const lower = name.toLowerCase();
    if (FIGMA_MAPPING_HINTS.boolean.some((kw) => kw.toLowerCase() === lower) || prop.type === "boolean") {
      mapping[name] = "figma.boolean";
      return;
    }
    if (FIGMA_MAPPING_HINTS.enum.some((kw) => kw.toLowerCase() === lower)) {
      mapping[name] = "figma.enum";
      return;
    }
    if (FIGMA_MAPPING_HINTS.instance.some((kw) => kw.toLowerCase() === lower)) {
      mapping[name] = "figma.instance";
      return;
    }
    if (FIGMA_MAPPING_HINTS.string.some((kw) => kw.toLowerCase() === lower) || prop.type === "string") {
      mapping[name] = "figma.string";
    }
  });
  return mapping;
}

function scanRecipeDirectory(recipesPath) {
  const recipeCache = new Map();
  if (!recipesPath || !fs.existsSync(recipesPath)) {
    return recipeCache;
  }
  const pattern = path.join(recipesPath, "**/*.{ts,tsx}").replace(/\\/g, "/");
  fg.sync(pattern, { onlyFiles: true }).forEach((file) => {
    try {
      const source = fs.readFileSync(file, "utf8");
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      const variants = extractRecipeVariants(ast);
      if (variants && Object.keys(variants).length > 0) {
        const baseName = path.basename(file, path.extname(file));
        const recipeName = baseName.replace(/recipe$/i, "").toLowerCase();
        recipeCache.set(recipeName, {
          name: recipeName,
          file: path.relative(process.cwd(), file),
          variants,
        });
      }
    } catch (err) {
      // Silent failure to keep optional behavior resilient.
    }
  });
  return recipeCache;
}

function extractRecipeVariants(ast) {
  let variants = {};
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)) {
      const call = node.initializer;
      if (ts.isIdentifier(call.expression) && call.expression.text === "defineRecipe" && call.arguments.length > 0) {
        const arg = call.arguments[0];
        if (ts.isObjectLiteralExpression(arg)) {
          const variantsProp = arg.properties.find(
            (prop) =>
              ts.isPropertyAssignment(prop) &&
              ((ts.isIdentifier(prop.name) && prop.name.text === "variants") ||
                (ts.isStringLiteral(prop.name) && prop.name.text === "variants")),
          );
          if (variantsProp && ts.isPropertyAssignment(variantsProp) && ts.isObjectLiteralExpression(variantsProp.initializer)) {
            variants = readVariantsObject(variantsProp.initializer);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return variants;
}

function readVariantsObject(objLiteral) {
  const variants = {};
  objLiteral.properties.forEach((prop) => {
    if (!ts.isPropertyAssignment(prop)) return;
    const name = ts.isIdentifier(prop.name) ? prop.name.text : ts.isStringLiteral(prop.name) ? prop.name.text : null;
    if (!name) return;
    if (ts.isObjectLiteralExpression(prop.initializer)) {
      const values = prop.initializer.properties
        .map((variantProp) => {
          if (!ts.isPropertyAssignment(variantProp)) return null;
          if (ts.isIdentifier(variantProp.name)) return variantProp.name.text;
          if (ts.isStringLiteral(variantProp.name)) return variantProp.name.text;
          return null;
        })
        .filter(Boolean);
      if (values.length > 0) {
        variants[name] = { type: "enum", values, required: false };
      }
    }
  });
  return variants;
}

module.exports = {
  CODE_ARTIFACT_KIND,
  CODE_ARTIFACT_VERSION,
  CodeProjectError,
  CodeArtifactError,
  loadCodeProject,
  discoverCodeComponents,
  scanCodeComponents,
};

async function main() {
  const config = parseArgs();
  if (config.verbose) {
    console.log(chalk.bold("⚙️  Configuration:"));
    console.log(`   Input: ${config.input}`);
    console.log(`   Output: ${config.output}`);
    console.log(`   Dry run: ${config.dryRun}`);
    console.log(`   Filter: ${config.filter || "none"}`);
    console.log(`   Component scope: ${config.componentScope || "none (auto-discover)"}`);
    const componentCount = config.components.length;
    console.log(`   Components: ${componentCount > 0 ? componentCount : "auto-discover"}`);
    console.log("");
  }

  const recipes = scanRecipeDirectory(config.recipesPath);
  if (config.verbose) {
    console.log(`🍳 Recipes loaded: ${recipes.size}`);
  }

  const project = loadCodeProject({
    codeRoot: config.input,
    tsconfigPath: config.tsconfigPath,
    components: config.components,
  });
  const { names: discoveredNames, exportsMap } = autoDiscoverComponentNames(
    project.program,
    project.sourceFiles,
    config.filter,
  );
  const targetNames = project.components.length > 0 ? project.components : discoveredNames;
  const missing = [];
  const pipelineComponents = [];
  targetNames.forEach((name) => {
    const override = CANONICAL_EXPORT_OVERRIDES[name];
    const exportName = override?.exportName ?? name;
    const match = exportsMap.get(exportName);
    if (!match) {
      missing.push(name);
      return;
    }
    const record = buildComponentRecord(name, match, project.program, project.projectRoot);
    const withNotes = override?.note ? { ...record, notes: [...(record.notes || []), override.note] } : record;
    pipelineComponents.push(pipelineComponent(withNotes, project.projectRoot, recipes));
  });

  if (missing.length && config.verbose) {
    console.warn(`⚠️  Missing components: ${missing.join(", ")}`);
  }

  ensureDir(config.output);
  let written = 0;
  for (const component of pipelineComponents) {
    const success = await writeComponentFile(config, component);
    if (success) written++;
  }

  console.log("\n📊 Extraction Summary:");
  console.log(`   Components found: ${pipelineComponents.length}`);
  console.log(`   JSON files ${config.dryRun ? "previewed" : "written"}: ${written}`);
  if (config.dryRun) {
    console.log(`\n💡 Run without --dry-run to write files to ${config.output}/`);
  } else {
    console.log(`\n✨ Component props extracted to ${config.output}/ directory`);
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function writeComponentFile(config, component) {
  const fileName = `${component.componentName.toLowerCase()}.json`;
  const outputPath = path.join(config.output, fileName);
  if (!config.overwrite && fs.existsSync(outputPath)) {
    console.warn(`⚠️  File exists: ${fileName} (use --overwrite to replace)`);
    return false;
  }
  if (config.dryRun) {
    console.log(`📝 Would write: ${fileName}`);
    if (config.verbose) {
      console.log(JSON.stringify(component, null, 2));
    }
    return true;
  }
  try {
    fs.writeFileSync(outputPath, JSON.stringify(component, null, 2), "utf8");
    return true;
  } catch (err) {
    console.error(`❌ Error writing ${fileName}: ${err.message}`);
    return false;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`❌ Fatal error: ${err.message}`);
    process.exit(1);
  });
}
