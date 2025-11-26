#!/usr/bin/env node

/**
 * Finalizer for Superconnect.
 *
 * Responsibilities:
 * - Locate generated Code Connect files in the target repo.
 * - Build/refresh figma.config.json using harvested Figma JSON.
 * - Emit a human-friendly summary in the target repo describing built vs skipped.
 */

const fs = require('fs');
const path = require('path');
const { Command } = require('commander');

function parseArgv(argv) {
  const program = new Command();
  program
    .name('superconnect-finalize')
    .description('Finalize Superconnect outputs into figma.config.json and summary')
    .requiredOption('--target <path>', 'Target repo containing generated files')
    .requiredOption('--figma-index <file>', 'Figma components index JSON')
    .requiredOption('--figma-dir <dir>', 'Figma components directory (harvest output)')
    .option('--codeconnect-dir <dir>', 'Code Connect output directory', 'codeconnect')
    .option('--config-file <file>', 'figma.config.json path', null)
    .option('--summary-file <file>', 'Summary markdown path', null);
  program.parse(argv);
  const opts = program.opts();
  return {
    target: path.resolve(opts.target),
    figmaIndex: path.resolve(opts.figmaIndex),
    figmaDir: path.resolve(opts.figmaDir),
    codeconnectDir: opts.codeconnectDir || null,
    configFile: opts.configFile ? path.resolve(opts.configFile) : null,
    summaryFile: opts.summaryFile ? path.resolve(opts.summaryFile) : null
  };
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

function readComponentLogs(dir) {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const entries = [];
  files.forEach((file) => {
    const full = path.join(dir, file);
    const data = readJson(full, `component log ${file}`);
    if (!data) return;
    const entry = {
      figmaName: data.figmaName || data.name || null,
      reactName: data.reactName || data.component || null,
      status: data.status || null,
      confidence: data.confidence || null,
      reason: data.reason || data.rationale || (Array.isArray(data.warnings) ? data.warnings.join('; ') : null)
    };
    if (entry.figmaName) entries.push(entry);
  });
  return entries;
}

const findCodeconnectDir = (target, hint) => {
  const candidate = path.resolve(target, hint || 'codeconnect');
  return fs.existsSync(candidate) && fs.statSync(candidate).isDirectory() ? candidate : null;
};

const listFigmaFiles = (codeconnectDir) => {
  if (!codeconnectDir || !fs.existsSync(codeconnectDir)) return [];
  return fs
    .readdirSync(codeconnectDir)
    .filter((f) => f.endsWith('.figma.tsx'))
    .map((f) => path.join(codeconnectDir, f));
};

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function generateConfig(components, fileKey, codeconnectDir, target) {
  const substitutions = {};
  components.forEach((component) => {
    if (component.componentName && component.componentSetId) {
      substitutions[component.componentName] = `https://www.figma.com/design/${fileKey}?node-id=${component.componentSetId.replace(':', '-')}`;
    }
  });
  const ccRelative = codeconnectDir && target ? path.relative(target, codeconnectDir) || '.' : null;
  const include = ccRelative && ccRelative !== '.' ? [ccRelative] : codeconnectDir ? [path.basename(codeconnectDir)] : [];
  return {
    codeConnect: {
      interactiveSetupFigmaFileUrl: `https://www.figma.com/design/${fileKey}`,
      include,
      parser: 'react',
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

function deriveCoverage(figmaIndex, entries, figmaFiles) {
  const normalize = (name) => (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const figmaNames = Array.isArray(figmaIndex?.components)
    ? figmaIndex.components
        .map((c) => c.name)
        .filter(Boolean)
        .map((name) => ({ raw: name, norm: normalize(name) }))
    : [];

  const builtSet = new Set(
    entries
      .filter(
        (e) =>
          e.figmaName &&
          e.reactName &&
          (e.status === 'built' ||
            (e.status === 'matched' && (e.confidence || '').toString().toLowerCase() === 'high'))
      )
      .map((e) => normalize(e.figmaName))
  );

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
    '# Superconnect Summary',
    '',
    '## Run info',
    `- Target repo: ${content.target}`,
    `- Code Connect dir: ${content.codeconnectDir || 'not found'}`,
    `- figma.config.json: ${content.configFile}`,
    `- Figma file key: ${content.fileKey || 'unknown'}`,
    `- Run timestamp (UTC): ${content.runAt}`,
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
  if (!fs.existsSync(args.target) || !fs.statSync(args.target).isDirectory()) {
    console.error(`❌ Target repo not found or not a directory: ${args.target}`);
    process.exit(1);
  }

  const baseOutput = path.dirname(args.figmaDir);
  const superconnectDir = baseOutput;
  const runLogDir = path.join(superconnectDir, 'logs');
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

  const fileKey = figmaIndex.fileKey || 'UNKNOWN_FILE_KEY';
  const codeconnectDir = findCodeconnectDir(args.target, args.codeconnectDir);

  const entries = readComponentLogs(runLogDir);
  if (!entries.length) {
    console.error(`❌ No per-component logs found in ${runLogDir}`);
    process.exit(1);
  }

  const figmaComponents = loadFigmaComponents(args.figmaDir);
  const config = generateConfig(figmaComponents, fileKey, codeconnectDir, args.target);
  writeJson(configFile, config);
  console.log(`✅ Wrote figma.config.json → ${configFile}`);

  const coverage = deriveCoverage(figmaIndex, entries);
  const runAt = new Date().toISOString();
  const builtDetails = entries
    .filter((e) => coverage.built.includes(e.figmaName))
    .map((e) => ({
      figmaName: e.figmaName,
      reactName: e.reactName,
      reason: e.reason
    }));
  const skippedDetails = coverage.unmapped.map((name) => {
    const reason = entries.find((e) => e.figmaName === name)?.reason || null;
    return { figmaName: name, reason };
  });

  const summary = buildSummary({
    target: args.target,
    codeconnectDir,
    configFile,
    fileKey,
    runAt,
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
