#!/usr/bin/env node

/**
 * Code Connect Codegen (stub)
 *
 * Validates inputs for Code Connect generation and lists the files that would
 * be produced. Actual code generation will be handled by an agent; this script
 * only checks prerequisites.
 */

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const DEFAULTS = {
  manifest: 'artifacts/codeconnect-manifest.json',
  mappings: 'artifacts/mappings.json',
  figmaDir: 'artifacts/figma-components',
  reactDir: 'artifacts/react-components',
  outputDir: 'artifacts/codeconnect'
};

const HELP = `
Code Connect Codegen (stub)

Validates inputs and prints the planned output locations for generated
.figma.tsx files.

Usage:
  node scripts/generateCodeConnect.js [options]

Options:
  --manifest <path>   Manifest YAML/JSON (default: ${DEFAULTS.manifest})
  --mappings <path>   Approved mappings JSON (default: ${DEFAULTS.mappings})
  --figma <dir>       Figma YAML directory (default: ${DEFAULTS.figmaDir})
  --react <dir>       React YAML directory (default: ${DEFAULTS.reactDir})
  --out <dir>         Output directory for .figma.tsx files (default: ${DEFAULTS.outputDir})
  --help              Show this help message
`;

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--manifest':
        args.manifest = next;
        i++;
        break;
      case '--mappings':
        args.mappings = next;
        i++;
        break;
      case '--figma':
        args.figmaDir = next;
        i++;
        break;
      case '--react':
        args.reactDir = next;
        i++;
        break;
      case '--out':
        args.outputDir = next;
        i++;
        break;
      case '--help':
        console.log(HELP);
        process.exit(0);
        break;
      default:
        if (arg.startsWith('--')) {
          console.warn(`Unknown option: ${arg}`);
        }
    }
  }
  return args;
}

function resolvePaths(options) {
  return {
    manifest: path.resolve(options.manifest),
    mappings: path.resolve(options.mappings),
    figmaDir: path.resolve(options.figmaDir),
    reactDir: path.resolve(options.reactDir),
    outputDir: path.resolve(options.outputDir)
  };
}

function assertFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} missing at ${filePath}`);
  }
}

function assertDirExists(dirPath, label) {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    throw new Error(`${label} directory missing at ${dirPath}`);
  }
}

function loadJson(filePath, label) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to read ${label} (${filePath}): ${err.message}`);
  }
}

function loadManifest(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    try {
      return YAML.parse(raw);
    } catch (yamlErr) {
      return JSON.parse(raw);
    }
  } catch (err) {
    throw new Error(`Failed to read manifest (${filePath}): ${err.message}`);
  }
}

function sanitizeFileName(name) {
  const clean = name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return clean || 'component';
}

function planOutputs(mappings, outputDir) {
  const seen = new Set();
  return mappings.map((m) => {
    if (!m.figmaName || !m.reactName) {
      throw new Error('Mapping entries must include figmaName and reactName.');
    }
    const fileBase = sanitizeFileName(m.reactName);
    if (seen.has(fileBase)) {
      console.warn(`⚠️  Duplicate output filename detected for reactName=${m.reactName}. Consider renaming to avoid overwrite.`);
    }
    seen.add(fileBase);
    return {
      figmaName: m.figmaName,
      reactName: m.reactName,
      outFile: path.join(outputDir, `${fileBase}.figma.tsx`)
    };
  });
}

function formatSummary(paths, planned) {
  const previewCount = Math.min(planned.length, 10);
  const previewLines = planned.slice(0, previewCount).map((p) => `- ${p.figmaName} -> ${p.outFile}`);
  const remaining = planned.length - previewCount;
  if (remaining > 0) {
    previewLines.push(`...and ${remaining} more`);
  }
  return [
    '=== Code Connect Codegen (stub) ===',
    `Manifest: ${paths.manifest}`,
    `Mappings: ${paths.mappings}`,
    `Figma YAMLs: ${paths.figmaDir}`,
    `React YAMLs: ${paths.reactDir}`,
    `Planned output dir: ${paths.outputDir}`,
    '',
    'Planned files:',
    ...previewLines,
    '',
    'No files were written (stub only).'
  ].join('\n');
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const paths = resolvePaths(options);

    assertFileExists(paths.manifest, 'Manifest');
    assertFileExists(paths.mappings, 'Mappings');
    assertDirExists(paths.figmaDir, 'Figma YAML');
    assertDirExists(paths.reactDir, 'React YAML');

    const manifest = loadManifest(paths.manifest);
    const mappings = loadJson(paths.mappings, 'mappings');
    if (!Array.isArray(mappings)) {
      throw new Error('Mappings JSON must be an array.');
    }

    const planned = planOutputs(mappings, paths.outputDir);
    console.log(formatSummary(paths, planned));

    if (manifest.importStyle && manifest.importTarget) {
      console.log(`\nImport strategy: ${manifest.importStyle} (${manifest.importTarget})`);
    }
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}

main();
