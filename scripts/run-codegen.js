#!/usr/bin/env node

/**
 * Stage 4: Per-component Code Connect generation.
 *
 * Inputs:
 *  - Figma components index + per-component JSON (from figma-scan.js)
 *  - Orienter JSONL (one JSON object per component describing needed files)
 *  - Repo root containing the source files to read
 *  - Prompt template for the single-codegen agent
 *
 * For each component:
 *  - Look up its orienter entry
 *  - Read the requested files from the repo
 *  - Invoke the agent with FIGMA + file context
 *  - Write the returned *.figma.tsx and a compact JSON log
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Command } = require('commander');
const chalk = require('chalk').default;
const { CodexCliAgentAdapter, OpenAIAgentAdapter } = require('../src/agent/agent-adapter');

const DEFAULT_CODECONNECT_DIR = 'codeconnect';
const DEFAULT_AGENT_RUNNER = 'codex exec --model gpt-5.1-codex-mini --sandbox read-only';
const defaultPromptPath = path.join(__dirname, '..', 'prompts', 'single-codegen.md');

const readJsonSafe = async (filePath) => {
  try {
    const data = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
};

const ensureDir = (dir) => {
  if (!dir) return;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const sanitizeSlug = (value, fallback = 'component') => {
  const base = (value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return base || fallback;
};

const parseJsonLines = async (filePath) => {
  try {
    const text = await fsp.readFile(filePath, 'utf8');
    return text
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
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
};

const normalizeOrienterRecord = (record = {}) => {
  const copy = { ...record };
  if (record.figma_component_id && !record.figmaComponentId) {
    copy.figmaComponentId = record.figma_component_id;
  }
  if (record.figma_component_name && !record.figmaComponentName) {
    copy.figmaComponentName = record.figma_component_name;
  }
  if (record.canonical_name && !record.canonicalName) {
    copy.canonicalName = record.canonical_name;
  }
  if (Array.isArray(record.files) && !record.files.length && Array.isArray(record.selected_files)) {
    copy.files = record.selected_files;
  }
  return copy;
};

const loadFigmaComponents = async (figmaDir) => {
  const entries = {};
  if (!fs.existsSync(figmaDir) || !fs.statSync(figmaDir).isDirectory()) return entries;
  const files = fs.readdirSync(figmaDir).filter((f) => f.endsWith('.json') && f !== 'index.json');
  for (const file of files) {
    const full = path.join(figmaDir, file);
    const data = await readJsonSafe(full);
    if (!data) continue;
    const id = data.componentSetId || data.componentId || data.id || null;
    const name = data.componentName || data.name || null;
    const key = id || (name ? name.toLowerCase() : null);
    if (!key) continue;
    entries[key] = { data, source: full };
  }
  return entries;
};

const readRequestedFiles = async (repoRoot, requested) => {
  const uniquePaths = Array.from(new Set(requested.filter(Boolean)));
  const results = await Promise.all(
    uniquePaths.map(async (relPath) => {
      const absolute = path.join(repoRoot, relPath);
      try {
        const content = await fsp.readFile(absolute, 'utf8');
        return { path: relPath, content };
      } catch (err) {
        return { path: relPath, error: err.message };
      }
    })
  );
  return results;
};

const buildAgentPayload = (promptText, componentMeta, componentJson, orienterEntry, files, codeconnectDir) => {
  const serializedFiles = files
    .map((file) => {
      if (file.error) {
        return [`--- file: ${file.path} (missing) ---`, `(missing: ${file.error})`, '--- end file ---'].join('\n');
      }
      return [`--- file: ${file.path} ---`, file.content, '--- end file ---'].join('\n');
    })
    .join('\n\n');

  const figmaBlock = {
    indexEntry: componentMeta,
    componentJson: componentJson?.data || null
  };

  return [
    promptText.trim(),
    '',
    '# Your Inputs (included below)',
    '',
    '## Figma component metadata',
    JSON.stringify(figmaBlock, null, 2),
    '',
    '## Orientation',
    JSON.stringify(orienterEntry, null, 2),
    '',
    '## Contents of selected files',
    serializedFiles,
    ''
  ].join('\n');
};

const extractJsonResponse = (text) => {
  const trimmed = text.trim();
  const fenced = trimmed.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    try {
      return JSON.parse(fenced);
    } catch {
      return null;
    }
  }
};

const writeCodeconnectFile = async (repoRoot, dir, fileName, contents) => {
  const safeDir = path.join(repoRoot, dir || DEFAULT_CODECONNECT_DIR);
  ensureDir(safeDir);
  const target = path.join(safeDir, fileName);
  await fsp.writeFile(target, contents, 'utf8');
  return target;
};

const writeLog = async (logDir, name, entry) => {
  ensureDir(logDir);
  const file = path.join(logDir, `${sanitizeSlug(name)}.json`);
  await fsp.writeFile(file, JSON.stringify(entry, null, 2), 'utf8');
  return file;
};

const resolveBackend = () => {
  const backend = (process.env.AGENT_BACKEND || 'cli').toLowerCase();
  return backend === 'openai' ? 'openai' : 'cli';
};

const buildAdapter = (config) => {
  const backend = resolveBackend();
  if (backend === 'openai') {
    return new OpenAIAgentAdapter({
      model: process.env.AGENT_MODEL || undefined,
      logDir: config.agentLogDir,
      cwd: config.repo
    });
  }
  const runner = process.env.AGENT_RUN_COMMAND || DEFAULT_AGENT_RUNNER;
  return new CodexCliAgentAdapter({
    runner,
    logDir: config.agentLogDir,
    cwd: config.repo
  });
};

const parseArgs = (argv) => {
  const program = new Command();
  program
    .name('run-codegen')
    .requiredOption('--figma-index <file>', 'Path to figma-components-index.json')
    .requiredOption('--orienter <file>', 'Orienter JSONL output (one JSON object per line)')
    .option('--force', 'Overwrite existing *.figma.tsx files', false)
    .allowExcessArguments(false);
  program.parse(argv);
  const opts = program.opts();
  const figmaIndexPath = path.resolve(opts.figmaIndex);
  const superconnectDir = path.dirname(figmaIndexPath);
  const repoRoot = path.dirname(superconnectDir);
  return {
    repo: repoRoot,
    figmaDir: path.join(superconnectDir, 'figma-components'),
    figmaIndex: figmaIndexPath,
    orienter: path.resolve(opts.orienter),
    promptPath: defaultPromptPath,
    codeconnectDir: DEFAULT_CODECONNECT_DIR,
    logDir: path.join(superconnectDir, 'component-logs'),
    agentLogDir: path.join(superconnectDir, 'codegen-logs'),
    force: Boolean(opts.force)
  };
};

const findComponentMeta = (figmaIndex, orienterEntry) => {
  if (!figmaIndex?.components) return null;
  const byId = orienterEntry.figmaComponentId
    ? figmaIndex.components.find((c) => c.id === orienterEntry.figmaComponentId)
    : null;
  if (byId) return byId;
  const targetName = orienterEntry.figmaComponentName || orienterEntry.canonicalName || null;
  if (!targetName) return null;
  return figmaIndex.components.find((c) => (c.name || '').toLowerCase() === targetName.toLowerCase()) || null;
};

const processOrienterEntry = async (orienterEntry, ctx) => {
  const normalized = normalizeOrienterRecord(orienterEntry);
  if (normalized.status !== 'mapped') return null;

  const key = normalized.figmaComponentId || (normalized.figmaComponentName || '').toLowerCase();
  if (key && ctx.seen.has(key)) return null;
  if (key) ctx.seen.add(key);

  const componentMeta = findComponentMeta(ctx.figmaIndex, normalized) || {};
  const orienterName =
    normalized.figmaComponentName || normalized.canonicalName || normalized.figmaComponentId || 'component';
  const logBaseName = componentMeta.name || componentMeta.id || orienterName || 'component';

  const requiredPaths = Array.isArray(normalized.files)
    ? normalized.files.map((f) => (typeof f === 'string' ? f : f?.path)).filter(Boolean)
    : [];
  if (requiredPaths.length === 0) {
    const entry = {
      figmaName: componentMeta.name || normalized.figmaComponentName || null,
      figmaId: componentMeta.id || normalized.figmaComponentId || null,
      status: 'skipped',
      reason: 'Orienter provided no files to read'
    };
    await writeLog(ctx.logDir, logBaseName, entry);
    ctx.summaries.push(entry);
    return entry;
  }

  const files = await readRequestedFiles(ctx.repo, requiredPaths);
  const missingFiles = files.filter((f) => f.error).map((f) => f.path);

  const componentKey =
    componentMeta.id ||
    normalized.figmaComponentId ||
    (componentMeta.name ? componentMeta.name.toLowerCase() : orienterName ? orienterName.toLowerCase() : null);
  const componentJson = componentKey ? ctx.figmaComponents[componentKey] || null : null;

  const filesLabel = requiredPaths.join(', ');
  console.log(`Generating ${chalk.cyan(logBaseName)} with reference to ${filesLabel}`);

  const payload = buildAgentPayload(
    ctx.promptText,
    componentMeta,
    componentJson,
    normalized,
    files,
    ctx.codeconnectDir
  );

  const agentResult = await ctx.agent.codegen({
    payload,
    cwd: ctx.repo,
    logLabel: logBaseName,
    logDir: ctx.agentLogDir
  });
  const parsed = extractJsonResponse(agentResult.stdout || agentResult.stderr || '');

  const logEntry = {
    figmaName: componentMeta.name || null,
    figmaId: componentMeta.id || null,
    status: parsed?.status || 'error',
    reason: parsed?.reason || null,
    confidence: parsed?.confidence ?? null,
    reactComponentName: parsed?.reactComponentName || parsed?.reactName || null,
    missingFiles,
    agentExitCode: agentResult.code
  };

  if (parsed?.codeconnectFileContent) {
    const fileName =
      parsed.codeconnectFileName || `${sanitizeSlug(componentMeta.name || normalized.figmaComponentName || 'component')}.figma.tsx`;
    const targetPath = path.join(ctx.repo, ctx.codeconnectDir, fileName);
    const exists = fs.existsSync(targetPath);
    if (exists && !ctx.force) {
      logEntry.status = 'skipped';
      logEntry.reason =
        logEntry.reason || 'Existing Code Connect file present (rerun with --force to overwrite)';
      logEntry.codeconnectFile = path.relative(ctx.repo, targetPath);
    } else {
      const written = await writeCodeconnectFile(ctx.repo, ctx.codeconnectDir, fileName, parsed.codeconnectFileContent);
      logEntry.status = parsed.status || 'built';
      logEntry.codeconnectFile = path.relative(ctx.repo, written);
      logEntry.overwritten = exists && ctx.force;
    }
  }

  await writeLog(ctx.logDir, logBaseName, logEntry);
  ctx.summaries.push(logEntry);
  return logEntry;
};

async function main() {
  const config = parseArgs(process.argv);
  if (config.force) {
    [config.logDir, config.agentLogDir].forEach((dir) => {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  const [figmaIndex, figmaComponents, promptText] = await Promise.all([
    readJsonSafe(config.figmaIndex),
    loadFigmaComponents(config.figmaDir),
    fsp.readFile(config.promptPath, 'utf8')
  ]);

  if (!figmaIndex?.components) {
    console.error(`❌ Could not read figma index: ${config.figmaIndex}`);
    process.exit(1);
  }

  const orienterRecords = await parseJsonLines(config.orienter);
  const agent = buildAdapter(config);
  const ctx = {
    repo: config.repo,
    figmaIndex,
    figmaComponents,
    promptText,
    codeconnectDir: config.codeconnectDir,
    logDir: config.logDir,
    agentLogDir: config.agentLogDir,
    force: config.force,
    summaries: [],
    agent,
    seen: new Set()
  };

  const normalizedOrienter = orienterRecords.map(normalizeOrienterRecord).filter((rec) => rec.status === 'mapped');
  for (const orienterEntry of normalizedOrienter) {
    await processOrienterEntry(orienterEntry, ctx);
  }

  const built = ctx.summaries.filter((s) => s.status === 'built');
  const skipped = ctx.summaries.filter((s) => s.status !== 'built');
  console.log(`Done. Built ${built.length}, skipped ${skipped.length}. Logs → ${config.logDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
