#!/usr/bin/env node

/**
 * Finalizer: summarize a Superconnect run.
 *
 * Inputs:
 *  - superconnect directory (figma-components-index.json, component-logs, codegen-logs, orientation.jsonl)
 *  - codeconnect directory (generated *.figma.tsx)
 *
 * Outputs:
 *  - Colorized summary printed to stdout
 *  - figma.config.json at repo root pointing Code Connect to generated files
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Command } = require('commander');
const Table = require('cli-table3');
const chalk = require('chalk').default;
const fg = require('fast-glob');
const { figmaColor, codeColor, generatedColor, highlight } = require('./colors');
const METADATA_FILE_NAME = 'figma.config.json';

const readJsonSafe = async (filePath) => {
  try {
    const data = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
};

const readJsonLines = async (filePath) => {
  try {
    const data = await fsp.readFile(filePath, 'utf8');
    return data
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const listCodeconnectFiles = (dir) => {
  if (!dir) return [];
  return fg
    .sync('*.figma.tsx', { cwd: dir, absolute: true })
    .map((file) => path.resolve(file));
};

const createTable = () =>
  new Table({
    colWidths: [3, 32, 60],
    wordWrap: true,
    style: { border: [], head: [], 'padding-left': 0, 'padding-right': 1 },
    chars: {
      top: '',
      'top-mid': '',
      'top-left': '',
      'top-right': '',
      bottom: '',
      'bottom-mid': '',
      'bottom-left': '',
      'bottom-right': '',
      left: '',
      'left-mid': '',
      mid: '',
      'mid-mid': '',
      right: '',
      'right-mid': '',
      middle: ' '
    }
  });

const readComponentLogs = async (dir) => {
  if (!dir) return [];
  const files = fg.sync('*.json', { cwd: dir, absolute: true });
  const results = [];
  for (const full of files) {
    const data = await readJsonSafe(full);
    if (!data) continue;
    results.push({
      file: path.basename(full),
      figmaName: data.figmaName || null,
      figmaId: data.figmaId || null,
      status: data.status || null,
      reactName: data.reactComponentName || null,
      reason: data.reason || null,
      codeconnectFile: data.codeconnectFile || null,
      confidence: data.confidence ?? null
    });
  }
  return results;
};

const buildSummary = (context) => {
  const lines = [];
  lines.push('');
  lines.push(highlight('=== SUPERCONNECT RUN SUMMARY ==='));
  lines.push('');

  lines.push(chalk.bold('=== SCANNING STAGE'));
  const scanTable = createTable();
  scanTable.push(
    [
      '🟢',
      `Read from ${figmaColor('Figma')}:`,
      figmaColor(context.figmaUrl || context.figmaFileKey || context.figmaFileName || context.figmaIndexRel)
    ],
    [
      '🟢',
      `Wrote ${figmaColor('Figma')} index file (${context.figmaCount} components):`,
      figmaColor(context.figmaIndexRel)
    ],
    [
      '🟢',
      `Wrote extracts for ${context.figmaCount} components:`,
      figmaColor(context.figmaComponentsDirRel || '(not found)')
    ],
    [
      context.repoSummaryExists ? '🟢' : '🟡',
      'Generated repo overview:',
      codeColor(context.repoSummaryRel || '(not found)')
    ],
    [
      context.orientationMapped >= context.figmaCount
        ? '🟢'
        : context.orientationMapped > 0
        ? '🟡'
        : '🔴',
      `Generated orientation info for ${context.orientationMapped}/${context.figmaCount}:`,
      codeColor(context.orientationRel)
    ]
  );
  lines.push(scanTable.toString());
  lines.push('');

  const codegenSummary = `(${context.orientationMapped} candidates from orientation step, ${context.builtCount} generated, ${context.skippedCount} skipped)`;
  lines.push(highlight(`=== CODE GENERATION STAGE ${codegenSummary}`));
  const agentRuns = context.builtCount + context.skippedCount;
  const codegenTable = createTable();
  codegenTable.push(
    ['🟢', `${agentRuns} code generation agents ran, logs at:`, generatedColor(context.codegenLogsRel)],
    ['🟢', `${agentRuns} code generation results at:`, generatedColor(context.componentLogsRel)]
  );
  lines.push(codegenTable.toString());

  lines.push(`🟢 ${highlight(context.builtDetails.length)} Code Connect files generated:`);
  if (context.builtDetails.length) {
    const builtTable = createTable();
    context.builtDetails.forEach((item) => {
      const name = generatedColor(item.figmaName || '');
      const target = generatedColor(item.codeconnectFile || '(not written)');
      const react = item.reactName ? codeColor(` (maps to React: ${item.reactName})`) : '';
      builtTable.push([' ', `${name} →`, `${target}${react}`]);
    });
    lines.push(builtTable.toString());
  } else {
    lines.push('    - (none)');
  }
  lines.push(`🟡 Declined to codegen for ${context.skippedDetails.length} component candidates:`);
  if (context.skippedDetails.length) {
    const skippedTable = createTable();
    context.skippedDetails.forEach((item) => {
      const name = highlight(item.figmaName || item.file || '(unknown)');
      const reason = item.reason ? chalk.dim(` — ${item.reason}`) : '';
      skippedTable.push([' ', name, reason]);
    });
    lines.push(skippedTable.toString());
  } else {
    lines.push('    - (none)');
  }

  return lines.join('\n');
};

const parseArgs = (argv) => {
  const program = new Command();
  program
    .name('finalize')
    .option('--superconnect <dir>', 'Superconnect directory containing pipeline artifacts', 'superconnect')
    .option('--codeconnect <dir>', 'Codeconnect directory', 'codeconnect')
    .option('--cwd <dir>', 'Working directory to resolve paths from', '.')
    .allowExcessArguments(false);
  program.parse(argv);
  const opts = program.opts();
  const baseCwd = path.resolve(opts.cwd || '.');
  const superconnectDir = path.resolve(baseCwd, opts.superconnect);
  const figmaIndex = path.join(superconnectDir, 'figma-components-index.json');
  return {
    figmaIndex,
    orientation: path.join(superconnectDir, 'orientation.jsonl'),
    codeconnectDir: path.resolve(baseCwd, opts.codeconnect),
    componentLogsDir: path.join(superconnectDir, 'component-logs'),
    codegenLogsDir: path.join(superconnectDir, 'codegen-logs'),
    superconnectDir,
    baseCwd
  };
};

async function main() {
  const config = parseArgs(process.argv);
  const figmaIndex = await readJsonSafe(config.figmaIndex);
  if (!figmaIndex) {
    console.error(`❌ Cannot read figma index at ${config.figmaIndex}`);
    process.exit(1);
  }

  const orientationEntries = await readJsonLines(config.orientation);
  const componentLogsRaw = await readComponentLogs(config.componentLogsDir);
  const orientationIdSet = new Set(
    orientationEntries
      .map((e) => e.figmaComponentId || e.figma_component_id || null)
      .filter(Boolean)
  );
  const orientationNameSet = new Set(
    orientationEntries
      .map((e) => e.figmaComponentName || e.figma_component_name || e.canonicalName || null)
      .filter(Boolean)
      .map((name) => name.toLowerCase())
  );
  const componentLogs = componentLogsRaw.filter((log) => {
    if (log.figmaId && orientationIdSet.has(log.figmaId)) return true;
    if (log.figmaName && orientationNameSet.has(log.figmaName.toLowerCase())) return true;
    if (log.codeconnectFile) return true;
    return false;
  });
  const codegenFiles = listCodeconnectFiles(config.codeconnectDir);
  const codegenLogsPresent =
    fs.existsSync(config.codegenLogsDir) &&
    fs.statSync(config.codegenLogsDir).isDirectory() &&
    fs.readdirSync(config.codegenLogsDir).length > 0;

  const builtDetails = componentLogs.filter((log) => Boolean(log.codeconnectFile));
  const skippedDetails = componentLogs.filter((log) => !log.codeconnectFile);

  const context = {
    figmaIndexRel: path.relative(config.baseCwd, config.figmaIndex) || config.figmaIndex,
    componentLogsRel: path.relative(config.baseCwd, config.componentLogsDir) || config.componentLogsDir,
    codegenLogsRel: path.relative(config.baseCwd, config.codegenLogsDir) || config.codegenLogsDir,
    codeconnectRel: path.relative(config.baseCwd, config.codeconnectDir) || config.codeconnectDir,
    orientationRel: path.relative(config.baseCwd, config.orientation) || config.orientation,
    figmaCount: Array.isArray(figmaIndex.components) ? figmaIndex.components.length : 0,
    orientationTotal: orientationEntries.length,
    orientationMapped: orientationEntries.filter((e) => e.status === 'mapped').length,
    builtCount: builtDetails.length,
    skippedCount: skippedDetails.length,
    builtDetails,
    skippedDetails,
    codegenFiles: codegenFiles.map((f) => path.relative(config.baseCwd, f) || f),
    codegenLogsPresent,
    figmaFileKey: figmaIndex.fileKey || null,
    figmaFileName: figmaIndex.fileName || null,
    figmaUrl: figmaIndex.fileKey ? `https://www.figma.com/design/${figmaIndex.fileKey}` : null,
    repoSummaryRel:
      path.relative(config.baseCwd, path.join(config.superconnectDir, 'repo-summary.json')) || null,
    repoSummaryExists: fs.existsSync(path.join(config.superconnectDir, 'repo-summary.json')),
    figmaComponentsDirRel:
      path.relative(config.baseCwd, path.join(config.superconnectDir, 'figma-components')) || null
  };

  const summary = buildSummary(context);
  const metadata = {
    schemaVersion: 1,
    figma: {
      fileKey: figmaIndex.fileKey || null,
      fileName: figmaIndex.fileName || null
    },
    codeconnect: {
      rootDir: path.relative(config.baseCwd, config.codeconnectDir) || config.codeconnectDir,
      files: context.codegenFiles
    }
  };
  const metadataPath = path.join(config.baseCwd, METADATA_FILE_NAME);
  ensureDir(path.dirname(metadataPath));
  await fsp.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

  console.log(summary);
  console.log(`${chalk.green('✓')} Wrote ${metadataPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
