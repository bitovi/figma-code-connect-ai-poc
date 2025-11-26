#!/usr/bin/env node

/**
 * Finalizer for Superconnect v3.
 *
 * Responsibilities:
 * - Locate generated Code Connect files in the target repo.
 * - Build/refresh figma.config.json using harvested Figma JSON.
 * - Optionally validate .figma.tsx files against React metadata if provided.
 * - Emit a human-friendly summary in the target repo describing built vs skipped.
 */

const fs = require('fs');
const path = require('path');
const fg = require('fast-glob');
const { spawnSync } = require('child_process');
const chalk = require('chalk').default;

function usage() {
  const lines = [
    'Superconnect v3 finalizer',
    '',
    'Usage:',
    '  node scripts/finalizeV3.js --target <repo> --figma-index <file> --figma-dir <dir>',
    '',
    'Required:',
    '  --target <path>         Target repo containing generated files',
    '  --figma-index <file>    Figma components index JSON',
    '  --figma-dir <dir>       Figma components directory (harvest output)',
    '',
    'Optional:',
    '  --run-log <file>        Run log path (default: target/superconnect/superconnect-run.json)',
    '  --codeconnect-dir <dir> Hint/override for Code Connect output directory',
    '  --config-file <file>    figma.config.json path (default: target/figma.config.json)',
    '  --summary-file <file>   Summary markdown path (default: target/superconnect/SUPERCONNECT_SUMMARY.md)',
    '  --react-meta <dir>      React metadata directory for validation (optional)',
    '  --figma-url <url|key>   Figma file URL/key (used if index lacks fileKey)',
    '  --skip-validate         Skip validation even if react metadata is present',
    '  --help                  Show this help'
  ];
  console.log(lines.join('\n'));
}

function parseArgv(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--target':
        args.target = path.resolve(next);
        i++;
        break;
      case '--figma-index':
        args.figmaIndex = path.resolve(next);
        i++;
        break;
      case '--figma-dir':
        args.figmaDir = path.resolve(next);
        i++;
        break;
      case '--run-log':
        args.runLog = path.resolve(next);
        i++;
        break;
      case '--codeconnect-dir':
        args.codeconnectDir = path.resolve(next);
        i++;
        break;
      case '--config-file':
        args.configFile = path.resolve(next);
        i++;
        break;
      case '--summary-file':
        args.summaryFile = path.resolve(next);
        i++;
        break;
      case '--react-meta':
        args.reactMeta = path.resolve(next);
        i++;
        break;
      case '--figma-url':
        args.figmaUrl = next;
        i++;
        break;
      case '--skip-validate':
        args.skipValidate = true;
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

function ensureDir(dir) {
  if (!dir) return;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, label) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.warn(`⚠️  Could not parse ${label || filePath}: ${err.message}`);
    return null;
  }
}

function parseFileKey(input) {
  if (!input) return '';
  const match = input.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]{10,})/);
  return match ? match[1] : input;
}

function deriveFileKey(figmaIndex, figmaUrl) {
  const indexKey = figmaIndex?.fileKey;
  if (indexKey) return indexKey;
  if (figmaUrl) return parseFileKey(figmaUrl);
  return '';
}

function findCodeconnectDir(target, hint) {
  if (hint) {
    const resolved = path.resolve(hint);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      return resolved;
    }
  }
  const matches = fg.sync(['**/*.figma.tsx'], {
    cwd: target,
    absolute: true,
    ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**']
  });
  if (!matches.length) return null;
  const dirCounts = matches.reduce((acc, file) => {
    const dir = path.dirname(file);
    acc.set(dir, (acc.get(dir) || 0) + 1);
    return acc;
  }, new Map());
  let bestDir = null;
  let bestCount = -1;
  dirCounts.forEach((count, dir) => {
    if (count > bestCount) {
      bestCount = count;
      bestDir = dir;
    }
  });
  return bestDir;
}

function listFigmaFiles(codeconnectDir) {
  if (!codeconnectDir || !fs.existsSync(codeconnectDir)) return [];
  return fs
    .readdirSync(codeconnectDir)
    .filter((f) => f.endsWith('.figma.tsx'))
    .map((f) => path.join(codeconnectDir, f));
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function generateConfig(components, fileKey, manifest, codeconnectDir, target) {
  const substitutions = {};
  components.forEach((component) => {
    if (component.componentName && component.componentSetId) {
      substitutions[component.componentName] = `https://www.figma.com/design/${fileKey}?node-id=${component.componentSetId.replace(':', '-')}`;
    }
  });
  const importPaths = manifest?.componentRoot && manifest?.importTarget
    ? { [`${manifest.componentRoot.replace(/\\/g, '/').replace(/\/+$/, '')}/**`]: manifest.importTarget }
    : manifest?.tsconfigPaths || {};
  const paths = manifest?.tsconfigPaths || {};
  const ccRelative = codeconnectDir && target ? path.relative(target, codeconnectDir) || '.' : null;
  const include = ccRelative && ccRelative !== '.' ? [ccRelative] : codeconnectDir ? [path.basename(codeconnectDir)] : [];
  return {
    codeConnect: {
      interactiveSetupFigmaFileUrl: `https://www.figma.com/design/${fileKey}`,
      include,
      exclude: [],
      parser: 'react',
      importPaths: importPaths || {},
      paths: paths || {},
      documentUrlSubstitutions: substitutions
    }
  };
}

function loadFigmaComponents(figmaDir) {
  if (!fs.existsSync(figmaDir)) return [];
  return fs
    .readdirSync(figmaDir)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((file) => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(figmaDir, file), 'utf8'));
        return {
          componentName: data.componentName || data.name || null,
          componentSetId: data.componentSetId || data.id || null
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function runValidate(codeconnectDir, reactMetaDir) {
  const cmd = [
    'node scripts/validateCodeconnect.js',
    `--codeconnect "${codeconnectDir}"`,
    `--react "${reactMetaDir}"`,
    '--quiet'
  ].join(' ');
  const result = spawnSync(cmd, { stdio: 'inherit', shell: true });
  return result.status === 0;
}

function normalizeRunEntries(runLog, mappings) {
  const source = Array.isArray(runLog)
    ? runLog
    : runLog?.entries || runLog?.components || runLog?.items || [];
  if (Array.isArray(source) && source.length) {
    return source
      .map((item) => ({
        figmaName: item.figmaName || item.name || null,
        reactName: item.reactName || item.component || null,
        status: item.status || item.state || (item.built ? 'built' : null),
        confidence: item.confidence || item.score || null,
        reason: item.reason || item.rationale || item.notes || null
      }))
      .filter((item) => item.figmaName);
  }
  if (Array.isArray(mappings) && mappings.length) {
    return mappings
      .map((item) => ({
        figmaName: item.figmaName || item.name || null,
        reactName: item.reactName || null,
        status: item.status || (item.reactName ? 'matched' : 'unmapped'),
        confidence: item.confidence || null,
        reason: item.notes || null
      }))
      .filter((item) => item.figmaName);
  }
  return [];
}

function deriveCoverage(figmaIndex, entries, figmaFiles) {
  const normalize = (name) => (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const figmaNames = Array.isArray(figmaIndex?.components)
    ? figmaIndex.components
        .map((c) => c.name)
        .filter(Boolean)
        .map((name) => ({ raw: name, norm: normalize(name) }))
    : [];

  const fileLookup = new Set(
    figmaFiles.map((file) => path.basename(file)).map((name) => normalize(name.replace('.figma.tsx', '')))
  );
  const expectedFromLog = entries
    .filter(
      (e) =>
        e.figmaName &&
        e.reactName &&
        (e.status === 'built' ||
          (e.status === 'matched' && (e.confidence || '').toString().toLowerCase() === 'high'))
    )
    .map((e) => ({
      figma: e.figmaName,
      react: normalize(e.reactName)
    }));

  const builtByLog = expectedFromLog
    .filter((item) => fileLookup.has(item.react))
    .map((item) => normalize(item.figma));

  const builtByFiles = figmaFiles
    .map((file) => path.basename(file, '.figma.tsx'))
    .map((name) => normalize(name));

  const builtSet = new Set([...builtByLog, ...builtByFiles].filter(Boolean));
  const built = figmaNames.filter((entry) => builtSet.has(entry.norm)).map((entry) => entry.raw);
  const unmapped = figmaNames.filter((entry) => !builtSet.has(entry.norm)).map((entry) => entry.raw);
  return {
    figmaTotal: figmaNames.length,
    built,
    unmapped
  };
}

function buildSummary(content) {
  const lines = [
    '# Superconnect v3 Summary',
    '',
    '## Run info',
    `- Target repo: ${content.target}`,
    `- Code Connect dir: ${content.codeconnectDir || 'not found'}`,
    `- figma.config.json: ${content.configFile}`,
    `- Figma file key: ${content.fileKey || 'unknown'}`,
    `- Figma components: ${content.coverage.figmaTotal}`,
    `- Built components: ${content.coverage.built.length}`,
    `- Skipped/Unmapped: ${content.coverage.unmapped.length}`,
    '',
    '## Built',
    content.builtDetails.length
      ? content.builtDetails.map((item) => `- ${item.figmaName || item.reactName || item.fileName}${item.reactName ? ` → ${item.reactName}` : ''}`).join('\n')
      : '- (none)',
    '',
    '## Skipped / Unmapped',
    content.skippedDetails.length
      ? content.skippedDetails
          .map((item) => `- ${item.figmaName}${item.reason ? ` — ${item.reason}` : ''}`)
          .join('\n')
      : '- (none)',
    '',
    '## Next steps',
    '- Connect this repo (or branch/fork) to Figma Code Connect in dev mode.',
    '- Open a mapped component in Figma and verify props/variants match the controls.',
    '- If something is missing or wrong, update the mapping or rerun with adjusted allow/deny lists.',
    '- Commit/push the generated Code Connect files and config.'
  ];
  return lines.join('\n');
}

function main() {
  const args = parseArgv(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }
  if (!args.target || !args.figmaIndex || !args.figmaDir) {
    console.error('❌ Missing required arguments. Provide --target, --figma-index, --figma-dir.');
    usage();
    process.exit(1);
  }
  if (!fs.existsSync(args.target) || !fs.statSync(args.target).isDirectory()) {
    console.error(`❌ Target repo not found or not a directory: ${args.target}`);
    process.exit(1);
  }

  const superconnectDir = path.join(args.target, 'superconnect');
  const runLog = args.runLog || path.join(superconnectDir, 'superconnect-run.json');
  const configFile = args.configFile || path.join(args.target, 'figma.config.json');
  const summaryFile = args.summaryFile || path.join(superconnectDir, 'SUPERCONNECT_SUMMARY.md');
  if (!fs.existsSync(args.figmaDir)) {
    console.error(`❌ Figma components directory not found at ${args.figmaDir}`);
    process.exit(1);
  }
  const figmaIndex = readJson(args.figmaIndex, 'figma index');
  if (!figmaIndex) {
    console.error(`❌ Unable to read figma index at ${args.figmaIndex}`);
    process.exit(1);
  }

  const fileKey = deriveFileKey(figmaIndex, args.figmaUrl);
  if (!fileKey) {
    console.warn('⚠️  Figma file key missing; figma.config.json will use a placeholder.');
  }

  const codeconnectDir = findCodeconnectDir(args.target, args.codeconnectDir || path.join(args.target, 'codeconnect'));
  if (!codeconnectDir) {
    console.warn('⚠️  No Code Connect directory found; summary will reflect zero generated files.');
  }

  const figmaFiles = codeconnectDir ? listFigmaFiles(codeconnectDir) : [];
  if (!figmaFiles.length) {
    console.warn('⚠️  No .figma.tsx files found; this run may have skipped all components due to low confidence.');
  }

  const manifestData = null;
  const runLogData = readJson(runLog, 'run log');
  const entries = normalizeRunEntries(runLogData, null);

  const figmaComponents = loadFigmaComponents(args.figmaDir);
  const config = generateConfig(figmaComponents, fileKey || 'UNKNOWN_FILE_KEY', manifestData, codeconnectDir, args.target);
  writeJson(configFile, config);
  console.log(`✅ Wrote figma.config.json → ${configFile}`);

  if (args.reactMeta && !args.skipValidate) {
    const ok = runValidate(codeconnectDir, args.reactMeta);
    if (!ok) {
      console.warn('⚠️  Validation failed; see messages above.');
    } else {
      console.log('✅ Code Connect files validated against React metadata.');
    }
  } else if (args.reactMeta && args.skipValidate) {
    console.log('• Validation skipped (--skip-validate set)');
  } else {
    console.log('• React metadata not provided; skipping validation.');
  }

  const coverage = deriveCoverage(figmaIndex, entries, figmaFiles, codeconnectDir);
  const builtDetails = entries.length
    ? entries.filter((e) => coverage.built.includes(e.figmaName)).map((e) => ({
        figmaName: e.figmaName,
        reactName: e.reactName,
        reason: e.reason
      }))
    : figmaFiles.map((file) => ({ fileName: path.basename(file) }));
  const skippedDetails = entries.length
    ? coverage.unmapped.map((name) => {
        const reason = entries.find((e) => e.figmaName === name)?.reason || null;
        return { figmaName: name, reason };
      })
    : coverage.unmapped.map((name) => ({ figmaName: name, reason: null }));

  const summary = buildSummary({
    target: args.target,
    codeconnectDir,
    configFile,
    fileKey,
    coverage,
    builtDetails,
    skippedDetails
  });
  ensureDir(path.dirname(summaryFile));
  fs.writeFileSync(summaryFile, summary, 'utf8');
  console.log(`✅ Wrote summary → ${summaryFile}`);

  const skipCount = coverage.unmapped.length;
  console.log(`Coverage: ${coverage.built.length}/${coverage.figmaTotal} built (${skipCount} skipped/unmapped)`);
}

main();
