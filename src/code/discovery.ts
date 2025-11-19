import path from "node:path";
import ts from "typescript";

import type { CodeComponentPropModel, CodeComponentRecord } from "./artifacts";
import type { CodeProject } from "./project";

export interface ComponentDiscoveryResult {
  readonly components: CodeComponentRecord[];
  readonly missing: string[];
}

export function discoverCodeComponents(project: CodeProject): ComponentDiscoveryResult {
  const moduleExports = analyzeExports(project.program, project.sourceFiles);
  const components: CodeComponentRecord[] = [];
  const missing: string[] = [];

  for (const targetName of project.components) {
    const override = CANONICAL_EXPORT_OVERRIDES[targetName];
    const exportName = override?.exportName ?? targetName;
    const match = moduleExports.get(exportName);
    if (!match) {
      missing.push(targetName);
      continue;
    }
    const record = buildComponentRecord(
      targetName,
      match,
      project.program,
      project.projectRoot,
    );
    components.push(
      override?.note
        ? {
            ...record,
            notes: [...record.notes, override.note],
          }
        : record,
    );
  }

  return {
    components,
    missing,
  };
}

type ExportMatch = {
  readonly exportName: string;
  readonly modulePath: string;
  readonly symbol: ts.Symbol;
  readonly moduleSymbol: ts.Symbol;
};

function analyzeExports(
  program: ts.Program,
  sourceFiles: readonly ts.SourceFile[],
): Map<string, ExportMatch> {
const checker = program.getTypeChecker();
  const exports = new Map<string, ExportMatch>();

  for (const sourceFile of sourceFiles) {
    if (!sourceFile.isDeclarationFile && ts.isExternalModule(sourceFile)) {
      const symbol = checker.getSymbolAtLocation(sourceFile);
      if (!symbol) {
        continue;
      }
      checker.getExportsOfModule(symbol).forEach((exportSymbol) => {
        const exportName = exportSymbol.getName();
        const modulePath =
          exportSymbol.valueDeclaration?.getSourceFile().fileName ??
          sourceFile.fileName;
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

function buildComponentRecord(
  componentName: string,
  match: ExportMatch,
  program: ts.Program,
  projectRoot: string,
): CodeComponentRecord {
  const checker = program.getTypeChecker();
  let propsType = resolvePropsType(match.symbol, checker);
  let propsSource: "callSignature" | "alias" | "none" = "none";
  if (propsType) {
    propsSource = "callSignature";
  } else {
    propsType = resolveAliasPropsType(match, checker, program);
    if (propsType) {
      propsSource = "alias";
    }
  }
  const normalizedPropsType = propsType
    ? unwrapUtilityPropsType(propsType, checker)
    : undefined;
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

function resolvePropsType(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Type | undefined {
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

function resolveAliasPropsType(
  match: ExportMatch,
  checker: ts.TypeChecker,
  program: ts.Program,
): ts.Type | undefined {
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

function isPropsTypeSymbol(symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
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

function extractProps(type: ts.Type, checker: ts.TypeChecker) {
  const props: CodeComponentRecord["props"] = [];
  const symbolMap = new Map<string, ts.Symbol>();
  const collect = (candidate: ts.Type) => {
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

function deriveModel(
  type: ts.Type,
  declaration: ts.Declaration,
  checker: ts.TypeChecker,
): CodeComponentPropModel {
  const defaultLiteral =
    readDefaultLiteral(declaration) ?? readLiteralFromType(type);

  if (isBooleanType(type)) {
    const model: CodeComponentPropModel = { kind: "boolean" };
    if (typeof defaultLiteral === "boolean") {
      model.defaultValue = defaultLiteral;
    }
    return model;
  }

  const enumValues = extractStringEnumValues(type);
  if (enumValues.length > 0) {
    const model: CodeComponentPropModel = { kind: "enum", values: enumValues };
    if (typeof defaultLiteral === "string" && enumValues.includes(defaultLiteral)) {
      model.defaultValue = defaultLiteral;
    }
    return model;
  }

  if (isStringType(type)) {
    const model: CodeComponentPropModel = { kind: "string" };
    if (typeof defaultLiteral === "string") {
      model.defaultValue = defaultLiteral;
    }
    return model;
  }

  return { kind: "unknown", reason: checker.typeToString(type) };
}

function isOptional(symbol: ts.Symbol): boolean {
  return (symbol.getFlags() & ts.SymbolFlags.Optional) !== 0;
}

function resolveParentName(symbol: ts.Symbol): string | undefined {
  const parent = (symbol as ts.Symbol & { parent?: ts.Symbol }).parent;
  if (!parent || !parent.name || parent.name === "__type") {
    return undefined;
  }
  return parent.name;
}

function getJsDoc(symbol: ts.Symbol, checker: ts.TypeChecker): string | undefined {
  const comment = ts.displayPartsToString(symbol.getDocumentationComment(checker));
  return comment.trim() || undefined;
}

function normalizeModulePath(fileName: string, projectRoot: string): string {
  const relative = path.relative(projectRoot, fileName);
  return relative.split(path.sep).join("/");
}

type CanonicalOverride = {
  exportName: string;
  note?: string;
};

const CANONICAL_EXPORT_OVERRIDES: Record<string, CanonicalOverride> = {
  Breadcrumb: {
    exportName: "BreadcrumbRoot",
    note: "Using BreadcrumbRoot as the canonical code export for Breadcrumb",
  },
};

function derefAlias(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
  if (symbol.getFlags() & ts.SymbolFlags.Alias) {
    const target = checker.getAliasedSymbol(symbol);
    return target ?? symbol;
  }
  return symbol;
}

function findTypeAliasSymbol(
  name: string,
  checker: ts.TypeChecker,
  program: ts.Program,
): ts.Symbol | undefined {
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) {
      continue;
    }
    const locals = (sourceFile as ts.SourceFile & { locals?: ts.SymbolTable }).locals;
    if (!locals) {
      continue;
    }
    const symbol = locals.get(name as ts.__String);
    if (symbol && isPropsTypeSymbol(symbol, checker)) {
      return symbol;
    }
  }
  return undefined;
}

function unwrapUtilityPropsType(type: ts.Type, checker: ts.TypeChecker): ts.Type {
  let current = type;
  const visited = new Set<ts.Type>();
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

function unwrapInterfaceExtends(
  declaration: ts.InterfaceDeclaration,
  checker: ts.TypeChecker,
): ts.Type | undefined {
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

function isBooleanType(type: ts.Type): boolean {
  if (type.flags & ts.TypeFlags.BooleanLike) {
    return true;
  }
  if (type.isUnion()) {
    return type.types.every(
      (member) => isBooleanType(member) || isOptionalType(member),
    );
  }
  return false;
}

function isStringType(type: ts.Type): boolean {
  if (type.flags & ts.TypeFlags.StringLike) {
    return true;
  }
  if (type.isUnion()) {
    return type.types.every(
      (member) => isStringType(member) || isOptionalType(member),
    );
  }
  return false;
}

function readDefaultLiteral(
  declaration: ts.Declaration | undefined,
): string | boolean | undefined {
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

function readLiteralFromType(type: ts.Type): string | boolean | undefined {
  if (type.isStringLiteral()) {
    return type.value;
  }
  const booleanValue = getBooleanLiteralValue(type);
  if (booleanValue !== undefined) {
    return booleanValue;
  }
  return undefined;
}

function findInitializer(declaration: ts.Declaration | undefined): ts.Expression | undefined {
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
    const node = declaration as ts.Node & { initializer?: ts.Expression };
    return node.initializer ?? undefined;
  }
  return undefined;
}

function extractStringEnumValues(type: ts.Type): string[] {
  if (!type.isUnion()) {
    return [];
  }
  const values: string[] = [];
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

function getBooleanLiteralValue(type: ts.Type): boolean | undefined {
  if ((type.flags & ts.TypeFlags.BooleanLiteral) === 0) {
    return undefined;
  }
  const literal = type as ts.Type & { intrinsicName?: string };
  if (literal.intrinsicName === "true") {
    return true;
  }
  if (literal.intrinsicName === "false") {
    return false;
  }
  return undefined;
}

function isOptionalType(type: ts.Type): boolean {
  return (type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)) !== 0;
}
