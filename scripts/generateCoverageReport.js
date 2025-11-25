#!/usr/bin/env node

/**
 * Coverage report for Figma ↔ React Code Connect outputs.
 *
 * Computes:
 * - Figma components mapped vs unmapped
 * - Missing codegen outputs per mapping
 * - Variant keys present in Figma but not used in generated .figma.tsx files
 */

const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const fg = require('fast-glob');
const { z } = require('zod');

const DEFAULTS = {
  figmaIndex: 'artifacts/figma-components-index.json',
  figmaDir: 'artifacts/figma-components',
  mappings: 'artifacts/mappings.json',
  codeconnectDir: 'artifacts/codeconnect',
  output: 'artifacts/run-report.json'
};

function readJson(filePath, label) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to read ${label} at ${filePath}: ${err.message}`);
  }
}

function ensureFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} missing at ${filePath}`);
  }
}

function ensureDir(dirPath, label) {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    throw new Error(`${label} directory missing at ${dirPath}`);
  }
}

function sanitizeName(name) {
  return (name || '').replace(/[^a-zA-Z0-9_-]+/g, '');
}

function findFigmaJson(figmaDir, figmaName) {
  const slug = sanitizeName(figmaName).toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const matches = fg.sync(path.join(figmaDir, `${slug}.json`), { onlyFiles: true, unique: true, dot: false });
  return matches[0] || null;
}

function figmaVariantKeys(figmaDir, figmaName) {
  const file = findFigmaJson(figmaDir, figmaName);
  if (!file) return [];
  try {
    const data = readJson(file, `Figma component ${figmaName}`);
    return Object.keys(data.variantProperties || {});
  } catch {
    return [];
  }
}

function codegenProps(codeFile) {
  if (!fs.existsSync(codeFile)) return [];
  try {
    const text = fs.readFileSync(codeFile, 'utf8');
    const regex = /figma\.\w+\(\s*['"]([^'"]+)['"]/g;
    const props = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      props.push(match[1]);
    }
    return Array.from(new Set(props));
  } catch {
    return [];
  }
}

function coverageReport(options) {
  const figmaDir = options.figmaDir || options.figma;
  const codeconnectDir = options.codeconnectDir || options.codeconnect;

  ensureFile(options.figmaIndex, 'Figma index');
  ensureFile(options.mappings, 'Mappings');
  ensureDir(figmaDir, 'Figma components');
  ensureDir(codeconnectDir, 'CodeConnect outputs');

  const figmaIndex = readJson(options.figmaIndex, 'Figma index');
  const mappings = readJson(options.mappings, 'Mappings');
  if (!Array.isArray(mappings)) {
    throw new Error('Mappings JSON must be an array.');
  }

  const figmaComponents = Array.isArray(figmaIndex.components) ? figmaIndex.components : [];
  const figmaNames = figmaComponents.map((c) => c.name).filter(Boolean);
  const mappedFigma = new Set(mappings.map((m) => m.figmaName));
  const unmappedFigma = figmaNames.filter((name) => !mappedFigma.has(name));

  const mappingReports = mappings.map((m) => {
    const codeFile = path.join(codeconnectDir, `${m.reactName}.figma.tsx`);
    const figmaKeys = figmaVariantKeys(figmaDir, m.figmaName);
    const propsUsed = codegenProps(codeFile);
    const missingVariantKeys = figmaKeys.filter((k) => !propsUsed.includes(k));
    return {
      figmaName: m.figmaName,
      reactName: m.reactName,
      codegenFile: fs.existsSync(codeFile) ? codeFile : null,
      figmaVariantKeys: figmaKeys,
      propsUsed,
      missingVariantKeys
    };
  });

  const missingCodegen = mappingReports.filter((r) => !r.codegenFile).map((r) => r.reactName);
  const withMissingVariants = mappingReports.filter((r) => r.missingVariantKeys.length > 0).map((r) => ({
    figmaName: r.figmaName,
    reactName: r.reactName,
    missingVariantKeys: r.missingVariantKeys
  }));

  return {
    summary: {
      figmaTotal: figmaNames.length,
      mappedFigma: mappedFigma.size,
      unmappedFigma: unmappedFigma.length,
      mappings: mappings.length,
      codegenFilesMissing: missingCodegen.length,
      mappingsWithMissingVariantKeys: withMissingVariants.length
    },
    unmappedFigma,
    missingCodegen,
    mappings: mappingReports,
    variantGaps: withMissingVariants
  };
}

function main() {
  const program = new Command();
  program
    .option('--figma-index <path>', 'Figma components index JSON', DEFAULTS.figmaIndex)
    .option('--figma <dir>', 'Figma components directory', DEFAULTS.figmaDir)
    .option('--mappings <path>', 'Mappings JSON', DEFAULTS.mappings)
    .option('--codeconnect <dir>', 'CodeConnect output directory', DEFAULTS.codeconnectDir)
    .option('--output <path>', 'Output JSON report path', DEFAULTS.output);
  program.parse(process.argv);
  const args = program.opts();

  const FigmaIndexSchema = z.object({
    components: z.array(z.object({ name: z.string() })).optional()
  });
  const MappingsSchema = z.array(
    z.object({
      figmaName: z.string(),
      reactName: z.string()
    })
  );

  try {
    const figmaIndexData = readJson(args.figmaIndex, 'Figma index');
    FigmaIndexSchema.parse(figmaIndexData);
    const mappingsData = readJson(args.mappings, 'Mappings');
    MappingsSchema.parse(mappingsData);

    const report = coverageReport({
      ...args,
      figmaIndex: args.figmaIndex,
      mappings: args.mappings,
      figmaDir: args.figmaDir || args.figma,
      codeconnectDir: args.codeconnectDir || args.codeconnect
    });
    fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    fs.writeFileSync(path.resolve(args.output), JSON.stringify(report, null, 2), 'utf8');
    console.log(`✅ Coverage report written to ${path.resolve(args.output)}`);
    console.log(`  Figma mapped: ${report.summary.mappedFigma}/${report.summary.figmaTotal}`);
    if (report.summary.unmappedFigma) {
      console.log(`  Unmapped Figma components: ${report.summary.unmappedFigma}`);
    }
    if (report.summary.codegenFilesMissing) {
      console.log(`  Missing codegen files: ${report.summary.codegenFilesMissing}`);
    }
    if (report.summary.mappingsWithMissingVariantKeys) {
      console.log(`  Mappings with missing variant keys: ${report.summary.mappingsWithMissingVariantKeys}`);
    }
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}

main();
