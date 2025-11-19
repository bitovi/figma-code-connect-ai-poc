import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

import type {
  CodeComponentsArtifact,
  CodeComponentRecord,
} from "../code/artifacts";
import type {
  ComponentMappingRecord,
  MappingArtifact,
  PropertyMappingRecord,
  PropertyValueMappingRecord,
} from "../mapping/artifacts";

export interface CodeConnectComponentModuleTarget {
  mapping: ComponentMappingRecord;
  codeComponent?: CodeComponentRecord;
}

export interface CodeConnectEntryModuleTarget {
  components: CodeConnectComponentModuleTarget[];
}

export interface CodeConnectGeneratorInput {
  mapping: MappingArtifact;
  code: CodeComponentsArtifact;
}

export interface ComponentModuleGenerationOptions {
  componentImportPath?: string;
}

export type GeneratedModuleKind = "component" | "entry";

export type ModuleWriteStatus = "written" | "skipped-existing";

export interface PlannedComponentModule {
  kind: "component";
  componentName: string;
  filePath: string;
  target: CodeConnectComponentModuleTarget;
  source: string;
}

export interface PlannedEntryModule {
  kind: "entry";
  filePath: string;
  source: string;
}

export interface PlannedModuleLayout {
  componentModules: PlannedComponentModule[];
  entryModule: PlannedEntryModule;
}

export interface GeneratedModuleFileInfo {
  kind: GeneratedModuleKind;
  componentName?: string;
  filePath: string;
  source: string;
  writeStatus: ModuleWriteStatus;
}

export type ModuleParseStatus = "ok" | "syntax-error";

export interface ModuleSanityCheckResult {
  kind: GeneratedModuleKind;
  componentName?: string;
  filePath: string;
  parseStatus: ModuleParseStatus;
  diagnostics: string[];
}

export interface PlanModuleLayoutOptions
  extends ComponentModuleGenerationOptions {
  modulesDir: string;
}

export interface ModuleWriteOptions {
  overwrite?: boolean;
}

const DEFAULT_COMPONENT_IMPORT_PATH = "@chakra-ui/react";
const COMPONENT_MODULE_EXTENSION = ".codeconnect.tsx";
const ENTRY_MODULE_FILENAME = "index.codeconnect.ts";

export function buildComponentModuleTargets(
  input: CodeConnectGeneratorInput,
): CodeConnectComponentModuleTarget[] {
  const exportIndex = buildExportIndex(input.code.components);
  const nameIndex = buildNameIndex(input.code.components);

  return input.mapping.components.map((mapping) => {
    const exportKey = mapping.codeExportName?.trim().toLowerCase();
    const nameKey = mapping.componentName.trim().toLowerCase();

    let codeComponent: CodeComponentRecord | undefined;
    if (exportKey) {
      codeComponent = exportIndex.get(exportKey);
    }
    if (!codeComponent) {
      codeComponent = nameIndex.get(nameKey);
    }

    return {
      mapping,
      codeComponent,
    };
  });
}

export function buildEntryModuleTarget(
  components: CodeConnectComponentModuleTarget[],
): CodeConnectEntryModuleTarget {
  return {
    components: [...components],
  };
}

export interface EntryModuleImportDescriptor {
  target: CodeConnectComponentModuleTarget;
  importPath: string;
}

export function planModuleLayout(
  input: CodeConnectGeneratorInput,
  options: PlanModuleLayoutOptions,
): PlannedModuleLayout {
  const targets = buildComponentModuleTargets(input);
  const modulesDir = options.modulesDir;

  const componentModules: PlannedComponentModule[] = targets.map((target) => {
    const fileName = getComponentModuleFileName(target.mapping.componentName);
    const filePath = path.join(modulesDir, fileName);
    const source = generateComponentModuleSource(target, {
      componentImportPath: options.componentImportPath,
    });
    return {
      kind: "component",
      componentName: target.mapping.componentName,
      filePath,
      target,
      source,
    };
  });

  const entryModulePath = path.join(modulesDir, ENTRY_MODULE_FILENAME);
  const entryImports: EntryModuleImportDescriptor[] = componentModules.map(
    (module) => ({
      target: module.target,
      importPath: `./${path.basename(
        module.filePath,
        path.extname(module.filePath),
      )}`,
    }),
  );
  const entrySource = generateEntryModuleSource(entryImports);

  const entryModule: PlannedEntryModule = {
    kind: "entry",
    filePath: entryModulePath,
    source: entrySource,
  };

  return {
    componentModules,
    entryModule,
  };
}

export function writePlannedModules(
  layout: PlannedModuleLayout,
  options: ModuleWriteOptions = {},
): GeneratedModuleFileInfo[] {
  const overwrite = options.overwrite ?? false;
  const results: GeneratedModuleFileInfo[] = [];

  const allModules: (PlannedComponentModule | PlannedEntryModule)[] = [
    ...layout.componentModules,
    layout.entryModule,
  ];

  for (const module of allModules) {
    const fileDir = path.dirname(module.filePath);
    fs.mkdirSync(fileDir, { recursive: true });

    const exists = fs.existsSync(module.filePath);
    const shouldWrite = overwrite || !exists;
    if (shouldWrite) {
      fs.writeFileSync(module.filePath, module.source, { encoding: "utf8" });
    }

    results.push({
      kind: module.kind,
      componentName: module.kind === "component" ? module.componentName : undefined,
      filePath: module.filePath,
      source: module.source,
      writeStatus: shouldWrite ? "written" : "skipped-existing",
    });
  }

  return results;
}

export function runModuleSanityCheck(
  layout: PlannedModuleLayout,
): ModuleSanityCheckResult[] {
  const results: ModuleSanityCheckResult[] = [];

  const allModules: (PlannedComponentModule | PlannedEntryModule)[] = [
    ...layout.componentModules,
    layout.entryModule,
  ];

  for (const module of allModules) {
    const parseResult = parseModuleSource(module.filePath, module.source);
    results.push({
      kind: module.kind,
      componentName: module.kind === "component" ? module.componentName : undefined,
      filePath: module.filePath,
      parseStatus: parseResult.status,
      diagnostics: parseResult.diagnostics,
    });
  }

  return results;
}

export function generateEntryModuleSource(
  imports: readonly EntryModuleImportDescriptor[],
): string {
  const sorted = [...imports].sort((a, b) => {
    const nameA = a.target.mapping.componentName.toLowerCase();
    const nameB = b.target.mapping.componentName.toLowerCase();
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return 0;
  });

  const lines: string[] = [];

  lines.push("/**");
  lines.push(" * Auto-generated Code Connect entry module.");
  lines.push(" *");
  lines.push(
    ` * Imports per-component mappings for ${sorted.length} component(s)`,
  );
  lines.push(
    " * and exposes a registry that can be consumed by your Code Connect runtime.",
  );
  lines.push(" */");
  lines.push("");

  for (const descriptor of sorted) {
    const identifier = toConfigIdentifier(
      descriptor.target.mapping.componentName,
    );
    lines.push(
      `import { ${identifier} } from ${JSON.stringify(descriptor.importPath)};`,
    );
  }

  if (sorted.length > 0) {
    lines.push("");
    lines.push("export const codeConnectComponents = [");
    for (const descriptor of sorted) {
      const identifier = toConfigIdentifier(
        descriptor.target.mapping.componentName,
      );
      lines.push(`  ${identifier},`);
    }
    lines.push("];");
  } else {
    lines.push("");
    lines.push("export const codeConnectComponents: readonly unknown[] = [];");
  }

  lines.push("");
  lines.push(
    "export function registerAllCodeConnectComponents(register: (config: unknown) => void): void {",
  );
  lines.push("  for (const config of codeConnectComponents) {");
  lines.push("    register(config);");
  lines.push("  }");
  lines.push("}");
  lines.push("");

  lines.push(
    "// Call `registerAllCodeConnectComponents` from your host application with",
  );
  lines.push(
    "// the real `@figma/code-connect` registration helper to wire things up.",
  );
  lines.push("");

  return lines.join("\n");
}

export function generateComponentModuleSource(
  target: CodeConnectComponentModuleTarget,
  options: ComponentModuleGenerationOptions = {},
): string {
  const importPath = options.componentImportPath ?? DEFAULT_COMPONENT_IMPORT_PATH;
  const header = formatHeaderComment(target);
  const lines: string[] = [];

  lines.push(header);
  lines.push("");

  const runtimeName = target.codeComponent?.exportName?.trim();
  if (runtimeName) {
    lines.push(`import { ${runtimeName} } from ${JSON.stringify(importPath)};`);
    lines.push("");
  }

  const configIdentifier = toConfigIdentifier(target.mapping.componentName);
  lines.push(`export const ${configIdentifier} = {`);

  if (runtimeName) {
    lines.push(`  component: ${runtimeName},`);
  }

  lines.push(
    `  componentName: ${JSON.stringify(target.mapping.componentName)},`,
  );

  if (target.mapping.designComponentNodeId) {
    lines.push(
      `  figmaComponentNodeId: ${JSON.stringify(
        target.mapping.designComponentNodeId,
      )},`,
    );
  }

  lines.push(`  status: ${JSON.stringify(target.mapping.status)},`);

  const propsLines = formatPropsConfig(target);
  if (propsLines.length > 0) {
    lines.push("  props: {");
    for (const line of propsLines) {
      lines.push(line);
    }
    lines.push("  },");
  } else {
    lines.push("  props: {},");
  }

  lines.push("};");

  const exampleLines = formatExampleUsageComment(
    target,
    runtimeName ?? target.mapping.componentName,
  );
  if (exampleLines.length > 0) {
    lines.push("");
    for (const line of exampleLines) {
      lines.push(line);
    }
  }

  lines.push("");

  return lines.join("\n");
}

function buildExportIndex(
  components: readonly CodeComponentRecord[],
): Map<string, CodeComponentRecord> {
  const index = new Map<string, CodeComponentRecord>();
  for (const component of components) {
    const key = component.exportName.trim().toLowerCase();
    if (!index.has(key)) {
      index.set(key, component);
    }
  }
  return index;
}

function getComponentModuleFileName(componentName: string): string {
  const base = componentName
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!base) {
    return `Component${COMPONENT_MODULE_EXTENSION}`;
  }
  const normalized =
    base.charAt(0).toUpperCase() + base.slice(1);
  return `${normalized}${COMPONENT_MODULE_EXTENSION}`;
}

function buildNameIndex(
  components: readonly CodeComponentRecord[],
): Map<string, CodeComponentRecord> {
  const index = new Map<string, CodeComponentRecord>();
  for (const component of components) {
    const key = component.componentName.trim().toLowerCase();
    if (!index.has(key)) {
      index.set(key, component);
    }
  }
  return index;
}

function formatHeaderComment(
  target: CodeConnectComponentModuleTarget,
): string {
  const { mapping, codeComponent } = target;
  const lines: string[] = [];

  lines.push("/**");
  lines.push(
    ` * Auto-generated Code Connect mapping for ${mapping.componentName}.`,
  );
  lines.push(" *");
  lines.push(
    ` * Status: ${mapping.status} (${mapping.matchedProps}/${mapping.totalProps} props mapped)`,
  );

  if (mapping.designComponentNodeId) {
    lines.push(` * Figma node: ${mapping.designComponentNodeId}`);
  }

  if (codeComponent) {
    lines.push(
      ` * Code export: ${codeComponent.exportName} (module: ${codeComponent.modulePath})`,
    );
  } else if (mapping.codeExportName) {
    lines.push(` * Code export: ${mapping.codeExportName} (unresolved)`);
  }

  if (mapping.notes.length > 0) {
    lines.push(" *");
    lines.push(" * Mapping notes:");
    for (const note of mapping.notes) {
      lines.push(` * - ${note}`);
    }
  }

  lines.push(" */");

  return lines.join("\n");
}

function formatPropsConfig(
  target: CodeConnectComponentModuleTarget,
): string[] {
  const views = collectMappedProps(target.mapping);
  const lines: string[] = [];

  for (const view of views) {
    const propName = view.record.codeProp ?? view.record.designProp;
    lines.push(`    ${propName}: {`);
    lines.push(
      `      mappedFrom: ${JSON.stringify(view.record.designProp)},`,
    );
    lines.push(
      `      status: ${JSON.stringify(view.record.status)},`,
    );

    if (view.mappedValues.length > 0) {
      const valuesLiteral = view.mappedValues
        .map((value) => JSON.stringify(value))
        .join(", ");
      lines.push(`      values: [${valuesLiteral}],`);
    } else {
      lines.push("      values: [],");
    }

    lines.push(
      "      // TODO: choose a sensible defaultValue for this prop",
    );
    lines.push("      defaultValue: undefined,");
    lines.push("    },");
  }

  return lines;
}

function formatExampleUsageComment(
  target: CodeConnectComponentModuleTarget,
  runtimeName: string,
): string[] {
  const propsSnippet = buildExamplePropsSnippet(target.mapping);
  const openTag =
    propsSnippet.length > 0
      ? `<${runtimeName} ${propsSnippet}>Label</${runtimeName}>`
      : `<${runtimeName}>Label</${runtimeName}>`;

  return [
    "// Example usage (refine as needed):",
    `// ${openTag}`,
  ];
}

interface MappedPropView {
  record: PropertyMappingRecord;
  mappedValues: string[];
}

function collectMappedProps(
  mapping: ComponentMappingRecord,
): MappedPropView[] {
  return mapping.props
    .filter((prop) => prop.status === "mapped")
    .map((prop) => ({
      record: prop,
      mappedValues: collectMappedValues(prop.valueMappings),
    }))
    .filter(
      (view) =>
        (view.record.codeProp ?? view.record.designProp).trim().length > 0,
    );
}

function collectMappedValues(
  valueMappings: readonly PropertyValueMappingRecord[],
): string[] {
  const values: string[] = [];
  for (const mapping of valueMappings) {
    if (mapping.status !== "mapped") {
      continue;
    }
    const value = (mapping.codeValue ?? mapping.designValue).trim();
    if (!value) {
      continue;
    }
    if (!values.includes(value)) {
      values.push(value);
    }
  }
  return values;
}

function buildExamplePropsSnippet(
  mapping: ComponentMappingRecord,
): string {
  const views = collectMappedProps(mapping);
  const parts: string[] = [];

  for (const view of views) {
    const propName = view.record.codeProp ?? view.record.designProp;
    if (!propName.trim()) {
      continue;
    }
    const exampleValue = view.mappedValues[0];
    if (!exampleValue) {
      continue;
    }
    const literal = JSON.stringify(exampleValue);
    parts.push(`${propName}=${literal}`);
  }

  return parts.join(" ");
}

interface ParseModuleResult {
  status: ModuleParseStatus;
  diagnostics: string[];
}

function parseModuleSource(filePath: string, source: string): ParseModuleResult {
  const compilerOptions: ts.TranspileOptions["compilerOptions"] = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  };

  if (filePath.endsWith(".tsx")) {
    compilerOptions.jsx = ts.JsxEmit.React;
  }

  const result = ts.transpileModule(source, {
    compilerOptions,
    fileName: filePath,
    reportDiagnostics: true,
  });

  const diagnostics = result.diagnostics ?? [];
  if (diagnostics.length === 0) {
    return { status: "ok", diagnostics: [] };
  }

  return {
    status: "syntax-error",
    diagnostics: diagnostics.map((diag) =>
      formatParseDiagnostic(filePath, diag),
    ),
  };
}

function formatParseDiagnostic(
  filePath: string,
  diagnostic: ts.Diagnostic,
): string {
  const message = ts.flattenDiagnosticMessageText(
    diagnostic.messageText,
    "\n",
  );
  if (!diagnostic.file || diagnostic.start == null) {
    return `${filePath}: ${message}`;
  }
  const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(
    diagnostic.start,
  );
  const lineNumber = line + 1;
  const columnNumber = character + 1;
  return `${filePath}:${lineNumber}:${columnNumber} - ${message}`;
}

function toConfigIdentifier(componentName: string): string {
  const base = componentName
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, " ")
    .split(" ")
    .filter((segment) => segment.length > 0)
    .map((segment, index) => {
      const lower = segment.toLowerCase();
      if (index === 0) {
        return lower;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");

  const safeBase = base || "component";
  const identifier = `${safeBase}CodeConnectConfig`;

  if (/^[A-Za-z_]/.test(identifier.charAt(0))) {
    return identifier;
  }

  return `_${identifier}`;
}
