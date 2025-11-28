#!/usr/bin/env node

/**
 * Finalizer v2: summarize a Superconnect run.
 *
 * Inputs:
 *  - superconnect directory (contains figma-components-index.json, component-logs, codegen-logs, orientation.jsonl)
 *  - codeconnect directory
 *
 * Output:
 *  - SUPERCONNECT_SUMMARY.md at repo root (always overwritten)
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Command } = require('commander');

const DEFAULT_SUMMARY_NAME = 'SUPERCONNECT_SUMMARY.md';
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
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.figma.tsx')).map((f) => path.join(dir, f));
};

const VALUE_COL = 50;

const formatRow = (statusEmoji, label, value, indent = '') => {
  const pad = Math.max(0, VALUE_COL - indent.length - 3); // emoji + space + space before value
  return `${indent}${statusEmoji} ${label.padEnd(pad)} ${value}`;
};

const continuationRow = (indent = '', value = '') => {
  const pad = Math.max(0, VALUE_COL - indent.length - 3);
  return `${indent}${' '.repeat(pad + 3)}${value}`;
};

const readComponentLogs = async (dir) => {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  const entries = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((file) => ({ file, full: path.join(dir, file) }));

  const results = [];
  for (const entry of entries) {
    const data = await readJsonSafe(entry.full);
    if (!data) continue;
    results.push({
      file: entry.file,
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
  const scanStatus =
    context.orientationMapped >= context.figmaCount && context.figmaCount > 0
      ? '🟢 (complete)'
      : context.orientationMapped > 0
      ? '🟡 (partial)'
      : '🔴 (failed)';
  const codegenStatus =
    context.builtCount >= context.orientationMapped && context.orientationMapped > 0
      ? '🟢 (complete)'
      : context.builtCount > 0
      ? '🟡 (partial)'
      : '🔴 (failed)';

  lines.push('# SUPERCONNECT RUN SUMMARY');
  lines.push('');

  lines.push('## Scanning Stage');
  lines.push(
    formatRow(
      '🟢',
      'Read from Figma:',
      context.figmaUrl || context.figmaFileKey || context.figmaFileName || context.figmaIndexRel
    )
  );
  lines.push(
    formatRow(
      '🟢',
      `Wrote Figma index file (${context.figmaCount} components):`,
      context.figmaIndexRel
    )
  );
  lines.push(
    formatRow(
      '🟢',
      `Wrote extracts for ${context.figmaCount} components:`,
      context.figmaComponentsDirRel || '(not found)'
    )
  );
  lines.push(
    formatRow(
      context.repoSummaryExists ? '🟢' : '🟡',
      'Generated repo overview:',
      context.repoSummaryRel || '(not found)'
    )
  );
  lines.push(
    formatRow(
      context.orientationMapped >= context.figmaCount
        ? '🟢'
        : context.orientationMapped > 0
        ? '🟡'
        : '🔴',
      `Generated orientation info for ${context.orientationMapped}/${context.figmaCount}:`,
      context.orientationRel
    )
  );
  lines.push('');

  const codegenSummary = `(${context.orientationMapped} candidates from orientation step, ${context.builtCount} generated, ${context.skippedCount} skipped)`;
  lines.push(`## Codegen Stage ${codegenSummary}`);
  const agentRuns = context.builtCount + context.skippedCount;
  lines.push(formatRow('🟢', `${agentRuns} code generation agents ran, logs at:`, context.codegenLogsRel));
  lines.push(formatRow('🟢', `${agentRuns} code generation results at:`, context.componentLogsRel));
  lines.push(`🟢 ${context.builtDetails.length} Code Connect files generated:`);
  if (context.builtDetails.length) {
    context.builtDetails.forEach((item) => {
      const name = (item.figmaName || '').padEnd(20);
      const target = item.codeconnectFile || '(not written)';
      const react = item.reactName ? ` (React: ${item.reactName})` : '';
      lines.push(`    - ${name} → ${target}${react}`);
    });
  } else {
    lines.push('    - (none)');
  }
  lines.push(`🟡 Declined to codegen for ${context.skippedDetails.length} component candidates:`);
  if (context.skippedDetails.length) {
    context.skippedDetails.forEach((item) => {
      const name = item.figmaName || item.file || '(unknown)';
      const reason = item.reason ? ` — ${item.reason}` : '';
      lines.push(`    - ${name}${reason}`);
    });
  } else {
    lines.push('    - (none)');
  }

  return lines.join('\n');
};

const parseArgs = (argv) => {
  const program = new Command();
  program
    .name('finalizer2')
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
    summaryFile: path.resolve(baseCwd, DEFAULT_SUMMARY_NAME),
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

  const builtDetails = componentLogs.filter((log) => log.status === 'built' && log.codeconnectFile);
  const skippedDetails = componentLogs.filter((log) => log.status !== 'built');

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
  ensureDir(path.dirname(config.summaryFile));
  await fsp.writeFile(config.summaryFile, summary, 'utf8');
  console.log(`Summary written to ${config.summaryFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
