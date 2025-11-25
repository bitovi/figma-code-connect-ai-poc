#!/usr/bin/env node

/**
 * Validate generated Code Connect files against extracted React component metadata.
 *
 * Checks:
 * - Each connected component is present in react-components JSONs.
 * - Every prop referenced in the .figma.tsx file exists on the component props metadata.
 *
 * Exits non-zero on any validation error.
 */

const fs = require('fs');
const path = require('path');

function usage() {
  console.log(
    [
      'Validate Code Connect outputs',
      '',
      'Usage:',
      '  node scripts/validateCodeconnect.js --codeconnect <dir> --react <dir>',
      '',
      'Options:',
      '  --codeconnect <dir>   Directory containing *.figma.tsx files (required)',
      '  --react <dir>         Directory containing react-components JSONs (required)',
      '  --quiet               Suppress per-file success messages'
    ].join('\n')
  );
}

function parseArgv(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--codeconnect':
        args.codeconnectDir = path.resolve(next);
        i++;
        break;
      case '--react':
        args.reactDir = path.resolve(next);
        i++;
        break;
      case '--quiet':
        args.quiet = true;
        break;
      case '--help':
        args.help = true;
        break;
      default:
        break;
    }
  }
  return args;
}

function ensureDirReadable(dir, label) {
  if (!dir) {
    return `${label} is required.`;
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return `${label} not found or not a directory: ${dir}`;
  }
  return null;
}

function slugify(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/^_+|_+$/g, '');
}

function findReactComponentJson(reactDir, name) {
  const base = slugify(name);
  const candidates = [
    path.join(reactDir, `${base}.json`),
    path.join(reactDir, `${slugify(name).replace(/_/g, '')}.json`)
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function extractPropsFromFile(content) {
  const propsBlockMatch = content.match(/props\s*:\s*{([\s\S]*?)}/);
  if (!propsBlockMatch) return [];
  const block = propsBlockMatch[1];
  const names = [];
  block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .forEach((line) => {
      const match = line.match(/^([A-Za-z0-9_]+)\s*:/);
      if (match) names.push(match[1]);
    });
  return Array.from(new Set(names));
}

function extractComponentName(content) {
  const chakraImport = content.match(/import\s*{\s*([^}]+)\s*}\s*from\s*['"][^'"]*chakra[^'"]*['"]/i);
  if (chakraImport) {
    const first = chakraImport[1].split(',')[0].trim();
    if (first) return first;
  }
  const fallback = content.match(/connect\(\s*([A-Za-z0-9_]+)/);
  return fallback ? fallback[1] : null;
}

function validateFile(filePath, reactDir) {
  const content = fs.readFileSync(filePath, 'utf8');
  const componentName = extractComponentName(content);
  if (!componentName) {
    return { ok: false, errors: [`Cannot determine component import in ${path.basename(filePath)}`], warnings: [] };
  }

  const reactJsonPath = findReactComponentJson(reactDir, componentName);
  if (!reactJsonPath) {
    return { ok: false, errors: [`React metadata not found for component ${componentName}`], warnings: [] };
  }
  let reactMeta;
  try {
    reactMeta = JSON.parse(fs.readFileSync(reactJsonPath, 'utf8'));
  } catch (err) {
    return { ok: false, errors: [`Failed to parse React metadata for ${componentName}: ${err.message}`], warnings: [] };
  }

  const reactProps = Array.isArray(reactMeta.props) ? reactMeta.props : null;
  const looksUnreliable =
    reactProps && reactProps.length > 20 && reactProps.some((p) => typeof p.name === 'string' && p.name.includes('__@iterator'));
  if (looksUnreliable) {
    return {
      ok: true,
      errors: [],
      warnings: [`Component ${componentName}: props metadata appears invalid (iterator spillover); skipping prop validation`]
    };
  }
  const filteredProps =
    reactProps && reactProps.length
      ? reactProps.filter((p) => typeof p.name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(p.name))
      : null;
  const allowedProps = filteredProps && filteredProps.length ? new Set(filteredProps.map((p) => p.name)) : null;
  const usedProps = extractPropsFromFile(content);
  const unknownProps = allowedProps ? usedProps.filter((prop) => !allowedProps.has(prop)) : [];

  if (allowedProps && unknownProps.length) {
    return {
      ok: false,
      errors: [
        `Component ${componentName}: unknown props in Code Connect: ${unknownProps.join(', ')} (allowed: ${Array.from(
          allowedProps
        ).join(', ') || 'none'})`
      ],
      warnings: []
    };
  }

  if (!allowedProps && usedProps.length) {
    return {
      ok: true,
      errors: [],
      warnings: [
        `Component ${componentName}: props metadata missing; used props cannot be validated (${usedProps.join(', ')})`
      ]
    };
  }

  return { ok: true, errors: [], warnings: [] };
}

function main() {
  const args = parseArgv(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  const codeconnectErr = ensureDirReadable(args.codeconnectDir, 'codeconnect directory');
  const reactErr = ensureDirReadable(args.reactDir, 'react directory');
  if (codeconnectErr || reactErr) {
    console.error(codeconnectErr || reactErr);
    usage();
    process.exit(1);
  }

  const files = fs.readdirSync(args.codeconnectDir).filter((f) => f.endsWith('.figma.tsx'));
  if (!files.length) {
    console.error(`No .figma.tsx files found in ${args.codeconnectDir}`);
    process.exit(1);
  }

  const errors = [];
  const warnings = [];
  files.forEach((file) => {
    const result = validateFile(path.join(args.codeconnectDir, file), args.reactDir);
    if (!result.ok) {
      result.errors.forEach((err) => errors.push(`${file}: ${err}`));
    } else {
      if (result.warnings.length) {
        result.warnings.forEach((warn) => warnings.push(`${file}: ${warn}`));
      }
      if (!args.quiet) {
        const suffix = result.warnings.length ? ' (with warnings)' : '';
        console.log(`✓ ${file} validated${suffix}`);
      }
    }
  });

  if (warnings.length) {
    console.warn('Warnings:');
    warnings.forEach((warn) => console.warn(`  - ${warn}`));
  }

  if (errors.length) {
    console.error('Validation failed:');
    errors.forEach((err) => console.error(`  - ${err}`));
    process.exit(1);
  }

  if (!args.quiet) console.log('All Code Connect files validated.');
}

main();
