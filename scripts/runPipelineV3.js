#!/usr/bin/env node

/**
 * Superconnect v3 pipeline (3 stages):
 * 1) Figma harvest (reuse existing fetch + index)
 * 2) Agent (works inside target repo as cwd; writes Code Connect + config)
 * 3) Finalizer (validates, builds config, writes summary in target repo)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const { Command } = require('commander');
const chalk = require('chalk').default;

const DEFAULTS = {
  artifactsDir: path.resolve('artifacts'),
  confidence: 'high'
};

function usage() {
  const lines = [
    'Superconnect v3 (harvest → agent → finalize)',
    '',
    'Usage:',
    '  node scripts/runPipelineV3.js --figma-url <url|key> --target <repo> --figma-token <token> [options]',
    '',
    'Options:',
    '  --figma-url <value>        Figma file URL or key (required if harvest needed)',
    '  --figma-token <token>      Figma API token (or FIGMA_ACCESS_TOKEN/.env)',
    '  --target <path>            Target repo to write Code Connect into (required)',
    `  --artifacts <dir>          Harvest output dir (default: ${DEFAULTS.artifactsDir})`,
    '  --figma-dir <dir>          Figma components dir (default: <artifacts>/figma-components)',
    '  --figma-index <file>       Figma index JSON (default: <artifacts>/figma-components-index.json)',
    '  --agent-runner <cmd>       Command to run the agent (reads prompt from stdin)',
    '  --agent-log-dir <dir>      Directory to write agent logs',
    '  --agent-filter <regex>     When output is suppressed, echo lines matching regex',
    '  --agent-stream             Stream full agent output (default suppressed)',
    '  --confidence <level>       Confidence threshold (default: high)',
    '  --components <csv>         Comma-separated Figma component names to process (required for agent; empty => agent no-op)',
    '  --codeconnect-dir <dir>    Hint for Code Connect output dir inside target (default: target/codeconnect)',
    '  --run-log <file>           Run log path inside target (default: target/superconnect/superconnect-run.json)',
    '  --config-file <file>       figma.config.json path (default: target/figma.config.json)',
    '  --summary-file <file>      Summary markdown path (default: target/superconnect/SUPERCONNECT_SUMMARY.md)',
    '  --react-meta <dir>         React metadata dir (optional; used for validation)',
    '  --skip-figma               Skip harvest stage (requires existing figma dir/index)',
    '  --force-figma              Re-run harvest even if outputs exist',
    '  --skip-agent               Skip agent stage (expects outputs to already exist in target)',
    '  --skip-finalize            Skip finalizer stage',
    '  --dry-run                  Print planned commands without executing',
    '  --help                     Show this help'
  ];
  console.log(lines.join('\n'));
}

function parseArgv(argv) {
  const program = new Command();
  program
    .name('runPipelineV3')
    .usage('[options]')
    .option('--figma-url <value>', 'Figma file URL or key')
    .option('--figma-token <token>', 'Figma API token (or FIGMA_ACCESS_TOKEN/.env)')
    .option('--target <path>', 'Target repo to write Code Connect into')
    .option('--artifacts <dir>', 'Harvest output dir', DEFAULTS.artifactsDir)
    .option('--figma-dir <dir>', 'Figma components dir')
    .option('--figma-index <file>', 'Figma index JSON')
    .option('--agent-runner <cmd>', 'Command to run the agent (reads prompt from stdin)')
    .option('--agent-log-dir <dir>', 'Directory to write agent logs')
    .option('--agent-filter <regex>', 'When output is suppressed, echo lines matching regex')
    .option('--agent-stream', 'Stream full agent output (default suppressed)')
    .option('--confidence <level>', 'Confidence threshold', DEFAULTS.confidence)
    .option('--components <csv>', 'Comma-separated Figma component names to process')
    .option('--codeconnect-dir <dir>', 'Hint for Code Connect output dir inside target')
    .option('--run-log <file>', 'Run log path inside target')
    .option('--config-file <file>', 'figma.config.json path')
    .option('--summary-file <file>', 'Summary markdown path')
    .option('--react-meta <dir>', 'React metadata dir (optional; used for validation)')
    .option('--skip-figma', 'Skip harvest stage (requires existing figma dir/index)')
    .option('--force-figma', 'Re-run harvest even if outputs exist')
    .option('--skip-agent', 'Skip agent stage')
    .option('--skip-finalize', 'Skip finalizer stage')
    .option('--dry-run', 'Print planned commands without executing')
    .allowUnknownOption(false);

  program.exitOverride();
  try {
    program.parse(argv, { from: 'user' });
  } catch (err) {
    if (err.code === 'commander.helpDisplayed') {
      process.exit(0);
    }
    throw err;
  }

  const opts = program.opts();
  const componentList = opts.components
    ? opts.components
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  return {
    figmaUrl: opts.figmaUrl || program.args[0] || undefined,
    figmaToken: opts.figmaToken,
    target: opts.target,
    artifactsDir: opts.artifacts ? path.resolve(opts.artifacts) : DEFAULTS.artifactsDir,
    figmaDir: opts.figmaDir ? path.resolve(opts.figmaDir) : undefined,
    figmaIndex: opts.figmaIndex ? path.resolve(opts.figmaIndex) : undefined,
    agentRunner: opts.agentRunner,
    agentLogDir: opts.agentLogDir ? path.resolve(opts.agentLogDir) : undefined,
    agentFilter: opts.agentFilter,
    confidence: opts.confidence || DEFAULTS.confidence,
    componentList,
    codeconnectDir: opts.codeconnectDir ? path.resolve(opts.codeconnectDir) : undefined,
    runLog: opts.runLog ? path.resolve(opts.runLog) : undefined,
    configFile: opts.configFile ? path.resolve(opts.configFile) : undefined,
    summaryFile: opts.summaryFile ? path.resolve(opts.summaryFile) : undefined,
    reactMeta: opts.reactMeta ? path.resolve(opts.reactMeta) : undefined,
    skipFigma: Boolean(opts.skipFigma),
    forceFigma: Boolean(opts.forceFigma),
    skipAgent: Boolean(opts.skipAgent),
    skipFinalize: Boolean(opts.skipFinalize),
    agentStream: Boolean(opts.agentStream),
    dryRun: Boolean(opts.dryRun)
  };
}

function loadEnvToken() {
  if (process.env.FIGMA_ACCESS_TOKEN) return process.env.FIGMA_ACCESS_TOKEN;
  const envPath = path.resolve('.env');
  if (!fs.existsSync(envPath)) return null;
  const line = fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith('FIGMA_ACCESS_TOKEN='));
  if (!line) return null;
  const [, value] = line.split('=');
  return (value || '').trim() || null;
}

function parseFileKey(input) {
  if (!input) return '';
  const match = input.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/);
  return match ? match[1] : input;
}

function parseSimpleToml(text) {
  const result = {};
  let section = null;
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1).trim();
      if (!section) continue;
      if (!result[section]) result[section] = {};
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const valueRaw = line.slice(eq + 1).trim();
    const unquoted = valueRaw.replace(/^"(.*)"$/, '$1');
    if (section) {
      result[section][key] = unquoted;
    } else {
      result[key] = unquoted;
    }
  }
  return result;
}

function loadSuperconnectConfig(filePath = 'superconnect.toml') {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return { config: {}, path: resolved, exists: false };
  try {
    const raw = fs.readFileSync(resolved, 'utf8');
    return { config: parseSimpleToml(raw), path: resolved, exists: true };
  } catch (err) {
    console.warn(`⚠️  Failed to load ${filePath}: ${err.message}`);
    return { config: {}, path: resolved, exists: true };
  }
}

function ensureDir(dir) {
  if (!dir) return;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function dirHasFiles(dir) {
  return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
}

function runCommand(label, command, context, options = {}) {
  console.log(`${chalk.dim('•')} ${chalk.cyan(label)}`);
  if (context.dryRun) {
    console.log(`  ${chalk.yellow('(dry-run)')} ${command}`);
    return { ok: true, skipped: true };
  }
  const result = spawnSync(command, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, FIGMA_ACCESS_TOKEN: context.figmaToken },
    ...(options || {})
  });
  if (result.status !== 0) {
    return { ok: false, code: result.status || 1 };
  }
  return { ok: true };
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
}

function runAgentStep(name, promptPath, payloadLines, context, options = {}) {
  if (context.dryRun) {
    console.log(`${chalk.dim('•')} ${chalk.cyan(`${name} (agent)`)}`);
    console.log(`  ${chalk.yellow('(dry-run)')} prompt: ${promptPath}`);
    return Promise.resolve({ ok: true, skipped: true });
  }
  const runner = options.runner || context.agentRunner;
  if (!runner) {
    console.log(`⚠️  ${name} requires an agent runner. Run manually with ${promptPath}:\n${payloadLines.join('\n')}`);
    return Promise.resolve({ ok: false, manual: true });
  }
  const cwd = options.cwd || undefined;
  const captureOutput = options.captureOutput || false;
  console.log(`• ${name} (agent via: ${runner}${cwd ? ` @ ${cwd}` : ''})`);
  const payload = payloadLines.join('\n');
  const logFile = context.agentLogDir ? path.join(context.agentLogDir, `${slugify(name)}.log`) : null;
  let logStream = null;
  let warnedSuppressed = false;
  const filterPattern = context.agentFilter ? new RegExp(context.agentFilter) : null;
  let filterBuffer = '';
  let captured = '';

  if (logFile) {
    ensureDir(path.dirname(logFile));
    logStream = fs.createWriteStream(logFile, { flags: 'w' });
    console.log(`  ↳ streaming log: ${logFile}`);
  }

  return new Promise((resolve) => {
    const child = spawn(runner, { shell: true, cwd });
    child.stdin.write(payload);
    child.stdin.end();

    const handleChunk = (chunk) => {
      const text = chunk.toString();
      if (logStream) logStream.write(text);
      if (captureOutput) captured += text;

      if (!context.agentQuiet) {
        process.stdout.write(text);
        return;
      }

      if (filterPattern) {
        const combined = filterBuffer + text;
        const parts = combined.split(/\r?\n/);
        filterBuffer = parts.pop() || '';
        parts.forEach((line) => {
          if (filterPattern.test(line)) console.log(line);
        });
        return;
      }

      if (!warnedSuppressed) {
        console.log('  (agent output suppressed; rerun with --agent-stream or set --agent-filter to surface messages)');
        warnedSuppressed = true;
      }
    };

    child.stdout.on('data', handleChunk);
    child.stderr.on('data', handleChunk);

    child.on('close', (code) => {
      if (logStream) logStream.end();
      if (filterPattern && filterBuffer && filterPattern.test(filterBuffer)) {
        console.log(filterBuffer);
      }
      if (code === 0) {
        resolve({ ok: true, output: captured });
      } else {
        resolve({ ok: false, code: code || 1, output: captured });
      }
    });
  });
}

function readJsonSafe(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function sanitizeComponentSlug(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function buildFigmaIndex(figmaDir) {
  const indexPath = path.join(figmaDir, 'index.json');
  let baseMeta = {};
  let components = [];
  if (fs.existsSync(indexPath)) {
    try {
      const parsed = readJsonSafe(indexPath);
      baseMeta = {
        fileKey: parsed.fileKey || null,
        fileName: parsed.fileName || null,
        version: parsed.version || null,
        schemaVersion: parsed.schemaVersion || null
      };
      components = Array.isArray(parsed.components) ? parsed.components : [];
    } catch {
      // fall through and rebuild from per-component files
    }
  }

  if (components.length === 0) {
    const files = fs.readdirSync(figmaDir).filter((name) => name.endsWith('.json') && name !== 'index.json');
    files.forEach((file) => {
      try {
        const data = readJsonSafe(path.join(figmaDir, file));
        const componentName = data.componentName || data.name;
        if (!componentName) return;
        components.push({
          name: componentName,
          id: data.componentSetId || data.id || null,
          variantCount: data.totalVariants || (Array.isArray(data.variants) ? data.variants.length : null),
          checksum: typeof data.checksum === 'string' ? data.checksum : data.checksum?.value || null,
          schemaVersion: data.schemaVersion || null,
          aliases: data.nameAliases?.candidates || data.aliases || [],
          breadcrumbs: data.breadcrumbs?.trail || data.breadcrumbs || []
        });
      } catch {
        // skip unreadable files
      }
    });
  }

  const seen = new Set();
  const normalized = [];
  components.forEach((entry) => {
    const name = (entry.name || entry.componentName || '').trim();
    if (!name || name === '-' || name === '_') return;
    const id = entry.id || entry.componentSetId || null;
    const key = `${name}::${id || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push({
      name,
      id,
      variantCount:
        entry.variantCount ??
        entry.totalVariants ??
        (Array.isArray(entry.variants) ? entry.variants.length : null) ??
        null,
      checksum: typeof entry.checksum === 'string' ? entry.checksum : entry.checksum?.value || null,
      schemaVersion: entry.schemaVersion || null,
      aliases: entry.aliases || [],
      breadcrumbs: entry.breadcrumbs || []
    });
  });

  const sorted = normalized.sort((a, b) => a.name.localeCompare(b.name) || (a.id || '').localeCompare(b.id || ''));

  return {
    schemaVersion: baseMeta.schemaVersion || null,
    fileKey: baseMeta.fileKey || null,
    fileName: baseMeta.fileName || null,
    version: baseMeta.version || null,
    generatedAt: new Date().toISOString(),
    components: sorted
  };
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function resolvePaths(args) {
  const target = args.target ? path.resolve(args.target) : null;
  const artifactsDir = args.artifactsDir || DEFAULTS.artifactsDir;
  const superconnectDir = target ? path.join(target, 'superconnect') : artifactsDir;
  const figmaDir = args.figmaDir || path.join(superconnectDir, 'figma-components');
  const figmaIndex = args.figmaIndex || path.join(superconnectDir, 'figma-components-index.json');
  const agentLogDir = args.agentLogDir || path.join(superconnectDir, 'agent-logs');
  const defaults = target
    ? {
        codeconnectDir: args.codeconnectDir || path.join(target, 'codeconnect'),
        runLog: args.runLog || path.join(superconnectDir, 'superconnect-run.json'),
        configFile: args.configFile || path.join(target, 'figma.config.json'),
        summaryFile: args.summaryFile || path.join(superconnectDir, 'SUPERCONNECT_SUMMARY.md'),
        agentLogDir
      }
    : {};
  return {
    ...args,
    target,
    artifactsDir,
    superconnectDir,
    figmaDir,
    figmaIndex,
    agentLogDir,
    ...defaults
  };
}

function printConfig(config, context = {}) {
  const header = chalk.bold.cyan('===== Superconnect: Figma Connect Code Generation Tool =====');
  const rel = (p) => {
    if (!p) return '(none)';
    if (!config.target) return p;
    const abs = path.resolve(p);
    const maybeRel = path.relative(config.target, abs);
    return maybeRel && !maybeRel.startsWith('..') && !path.isAbsolute(maybeRel) ? maybeRel : abs;
  };
  const inputs = [
    `${chalk.dim('    Figma URL/Key:')}   ${config.figmaUrl || '(none)'}`,
    `${chalk.dim('    Code repo:     ')}  ${config.target}`
  ].join('\n');
  const agentBlock = [
    chalk.bold('Code Generation Agent:'),
    `${chalk.dim('    Run command:    ')} ${config.agentRunner || '(manual)'}`,
    `${chalk.dim('    Agent log:      ')} ${rel(config.runLog)}`
  ].join('\n');
  const outputs = [
    chalk.bold('Generated Files:'),
    `${chalk.dim('    Code Connect config file: ')} ${rel(config.configFile)}`,
    `${chalk.dim('    Destination folder:       ')} ${rel(config.codeconnectDir || '')}/`
  ].join('\n');
  console.log(header);
  console.log(chalk.bold('Inputs:'));
  console.log(inputs);
  console.log(agentBlock);
  console.log(outputs);
  if (!context.skipAgent && config.componentList && config.componentList.length) {
    console.log(`\nGenerating coding for components: [${config.componentList.join(', ')}]`);
  }
  console.log('');
}

function ensureFigmaInputs(config, context) {
  if (context.skipFigma) {
    if (!fs.existsSync(config.figmaDir) || !dirHasFiles(config.figmaDir)) {
      return { error: `--skip-figma provided but figma dir missing/empty at ${config.figmaDir}` };
    }
    if (!fs.existsSync(config.figmaIndex)) {
      return { error: `--skip-figma provided but figma index missing at ${config.figmaIndex}` };
    }
    return { ok: true };
  }

  if (!config.figmaUrl && !fs.existsSync(config.figmaIndex)) {
    return { error: 'Missing --figma-url (required to fetch) and figma index does not exist.' };
  }
  if (!config.figmaUrl && !dirHasFiles(config.figmaDir)) {
    return { error: 'Missing --figma-url (required to fetch) and figma dir is empty.' };
  }
  return { ok: true };
}

function harvestStage(config, context) {
  if (context.skipFigma) {
    console.log('• Harvest stage skipped (--skip-figma)');
    return { ok: true, skipped: true };
  }

  ensureDir(config.figmaDir);
  const needsFetch = !dirHasFiles(config.figmaDir) || context.forceFigma;
  if (needsFetch) {
    const fileKey = parseFileKey(config.figmaUrl);
    const cmd = [
      'node scripts/fetchComponents.js',
      `"${fileKey}"`,
      `--output "${config.figmaDir}"`,
      `--index "${config.figmaIndex}"`,
      context.figmaToken ? `--token "${context.figmaToken}"` : ''
    ]
      .filter(Boolean)
      .join(' ');
    const result = runCommand('Figma fetch', cmd, context);
    if (!result.ok) return result;
    console.log(`✅ Figma component index: ${config.figmaIndex}`);
    return { ok: true };
  } else {
    console.log(`• Figma fetch skipped; using existing files at ${config.figmaDir} (use --force-figma to refetch)`);
  }

  if (fs.existsSync(config.figmaIndex)) {
    console.log(`• Figma index exists: ${config.figmaIndex} (use --force-figma to rebuild)`);
    return { ok: true };
  }

  console.error(`❌ Figma index missing at ${config.figmaIndex}. Use --force-figma to refetch.`);
  return { ok: false, code: 1 };
}

async function agentStage(config, context) {
  if (context.skipAgent) {
    console.log('• Agent stage skipped (--skip-agent)');
    return { ok: true, skipped: true };
  }
  if (!config.componentList || config.componentList.length === 0) {
    console.log('• Agent stage skipped (no components specified)');
    // Write a minimal run log so downstream steps have something to read.
    const stub = {
      generatedAt: new Date().toISOString(),
      summary: {
        totalComponents: 0,
        matched: 0,
        uncertain: 0,
        unmapped: 0,
        codegenFiles: 0
      },
      decisions: []
    };
    ensureDir(path.dirname(config.runLog));
    fs.writeFileSync(config.runLog, JSON.stringify(stub, null, 2), 'utf8');
    return { ok: true, skipped: true };
  }
  const promptPath = path.resolve('prompts/autopilot-agent.md');
  if (!fs.existsSync(promptPath)) {
    console.error(`❌ Missing agent prompt at ${promptPath}`);
    return { ok: false, code: 1 };
  }
  const prompt = fs.readFileSync(promptPath, 'utf8');
  const promptText = prompt
    .replace(/{FIGMA_DIR}/g, config.figmaDir)
    .replace(/{FIGMA_INDEX}/g, config.figmaIndex)
    .replace(/{COMPONENT_LIST}/g, JSON.stringify(config.componentList || []))
    .replace(/{CODECONNECT_DIR}/g, config.codeconnectDir || 'codeconnect');
  const runtimeConfig = {
    figmaDir: config.figmaDir,
    figmaIndex: config.figmaIndex,
    runLog: config.runLog,
    codeconnectDir: config.codeconnectDir,
    configFile: config.configFile,
    summaryFile: config.summaryFile,
    figmaUrl: config.figmaUrl || null,
    confidence: config.confidence,
    componentList: config.componentList || []
  };
  const payload = [
    promptText,
    '',
    'Runtime options (authoritative; use these paths/thresholds when writing files):',
    JSON.stringify(runtimeConfig, null, 2)
  ];

  const result = await runAgentStep('Autopilot mapping + codegen', promptPath, payload, context, {
    cwd: config.target
  });
  if (!result.ok) {
    console.error(`❌ Agent step failed${result.code ? ` (code ${result.code})` : ''}.`);
    return { ok: false, code: result.code || 1 };
  }

  // Post-check: ensure expected outputs exist.
  const required = [config.runLog];
  const missing = required.filter((p) => !fs.existsSync(p));
  if (missing.length) {
    console.error(`❌ Agent did not produce required outputs: ${missing.join(', ')}`);
    return { ok: false, code: 1 };
  }
  const ccDir = config.codeconnectDir;
  const hasCCFiles =
    ccDir && fs.existsSync(ccDir) && fs.readdirSync(ccDir).some((f) => f.endsWith('.figma.tsx'));
  const shouldHaveCCFiles = Array.isArray(config.componentList) && config.componentList.length > 0;
  if (shouldHaveCCFiles && !hasCCFiles) {
    console.error('❌ No Code Connect files were produced by the agent (.figma.tsx missing).');
    return { ok: false, code: 1 };
  }
  return { ok: true };
}

function finalizeStage(config, context) {
  if (context.skipFinalize) {
    console.log('• Finalizer stage skipped (--skip-finalize)');
    return { ok: true, skipped: true };
  }
  const args = [
    `--target "${config.target}"`,
    `--figma-index "${config.figmaIndex}"`,
    `--figma-dir "${config.figmaDir}"`,
    `--run-log "${config.runLog}"`,
    `--config-file "${config.configFile}"`,
    `--summary-file "${config.summaryFile}"`,
    `--codeconnect-dir "${config.codeconnectDir}"`
  ];
  if (config.reactMeta) args.push(`--react-meta "${config.reactMeta}"`);
  if (config.figmaUrl) args.push(`--figma-url "${config.figmaUrl}"`);
  const cmd = `node scripts/finalizeV3.js ${args.join(' ')}`;
  return runCommand('Finalizer', cmd, context);
}

async function main() {
  const argv = process.argv.slice(2);
  const parsed = parseArgv(argv);
  const { config: cfg } = loadSuperconnectConfig();
  // Merge config defaults if CLI not provided.
  if (!parsed.figmaUrl && cfg.inputs?.figma_url) parsed.figmaUrl = cfg.inputs.figma_url;
  if (!parsed.target && cfg.inputs?.component_repo_path) parsed.target = cfg.inputs.component_repo_path;
  if (!parsed.artifactsDir && cfg.outputs?.output_dir) parsed.artifactsDir = path.resolve(cfg.outputs.output_dir);
  if (!parsed.agentRunner && cfg.agent?.run_command) parsed.agentRunner = cfg.agent.run_command;
  if (!parsed.agentLogDir && cfg.outputs?.agents_log_directory) {
    if (parsed.target || cfg.inputs?.component_repo_path) {
      const t = parsed.target || path.resolve(cfg.inputs.component_repo_path);
      parsed.agentLogDir = path.join(path.resolve(t), cfg.outputs.agents_log_directory);
    } else {
      parsed.agentLogDir = path.resolve(cfg.outputs.agents_log_directory);
    }
  }

  const config = resolvePaths(parsed);
  if (!config.target) {
    console.error('❌ Missing --target <path to repo>');
    usage();
    process.exit(1);
  }
  if (!fs.existsSync(config.target) || !fs.statSync(config.target).isDirectory()) {
    console.error(`❌ Target repo not found or not a directory: ${config.target}`);
    process.exit(1);
  }
  const figmaToken = parsed.figmaToken || loadEnvToken();
  const context = {
    figmaToken,
    dryRun: parsed.dryRun,
    forceFigma: parsed.forceFigma,
    skipFigma: parsed.skipFigma,
    skipAgent: parsed.skipAgent,
    skipFinalize: parsed.skipFinalize,
    agentRunner: parsed.agentRunner,
    agentLogDir: config.agentLogDir,
    agentFilter: parsed.agentFilter,
    agentQuiet: parsed.agentStream ? false : true
  };

  printConfig(config, context);

  const figmaCheck = ensureFigmaInputs(config, context);
  if (figmaCheck.error) {
    console.error(`❌ ${figmaCheck.error}`);
    process.exit(1);
  }

  const willFetch = !context.skipFigma && (context.forceFigma || !dirHasFiles(config.figmaDir));
  if (willFetch && !figmaToken) {
    console.error('❌ Missing Figma token (set --figma-token or FIGMA_ACCESS_TOKEN/.env)');
    process.exit(1);
  }

  const harvest = harvestStage(config, context);
  if (!harvest.ok) process.exit(harvest.code || 1);

  let agent = { ok: true, skipped: true };
  if (!context.skipAgent) {
    agent = await agentStage(config, context);
    if (!agent.ok) process.exit(agent.code || 1);
  }

  let finalize = { ok: true, skipped: true };
  if (!context.skipFinalize) {
    finalize = finalizeStage(config, context);
    if (!finalize.ok) process.exit(finalize.code || 1);
  }

  console.log(chalk.green.bold('✅ Superconnect v3 pipeline completed'));
}

main();
