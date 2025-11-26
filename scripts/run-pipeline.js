#!/usr/bin/env node

/**
 * Superconnect pipeline (3 stages):
 * 1) Figma scan (fetch + index)
 * 2) Codegen (agent inside target repo; writes Code Connect + config)
 * 3) Finalize (validates, builds config, writes summary in target repo)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const { Command } = require('commander');
const chalk = require('chalk').default;

const AGENT_OUTPUT_DEFAULT = 'stdout';


function parseArgv(argv) {
  const subcommands = new Set(['figmascan', 'codegen', 'finalize']);
  let stage = 'all';
  let args = argv.slice();
  if (args.length && subcommands.has(args[0])) {
    stage = args[0];
    args = args.slice(1);
    if (args.includes('-h') || args.includes('--help')) {
      console.log(`Usage: superconnect ${stage} [global options]\n`);
      console.log('Global options:');
      console.log('  --figma-url <value>    Figma file URL or key (needed for figma scan when not cached)');
      console.log('  --figma-token <token>  Figma API token (or FIGMA_ACCESS_TOKEN/.env)');
      console.log('  --target <path>        Target repo to write Code Connect into');
      console.log('  --components <csv>     Comma-separated Figma component names to process');
      console.log('  --agent-output <mode>  Agent output: stdout | <log-path>');
      console.log('  --force                Re-run stages even if outputs exist');
      console.log('  --dry-run              Print planned commands without executing');
      process.exit(0);
    }
  }

  const program = new Command();
  program
    .name('superconnect')
    .usage('[options] [figmascan|codegen|finalize]')
    .option('--figma-url <value>', 'Figma file URL or key (needed for figma scan when not cached)')
    .option('--figma-token <token>', 'Figma API token (or FIGMA_ACCESS_TOKEN/.env)')
    .option('--target <path>', 'Target repo to write Code Connect into')
    .option('--components <csv>', 'Comma-separated Figma component names to process')
    .option('--agent-output <mode>', 'Agent output: stdout | <log-path>', AGENT_OUTPUT_DEFAULT)
    .option('--force', 'Re-run stages even if outputs exist')
    .option('--dry-run', 'Print planned commands without executing')
    .allowUnknownOption(false)
    .allowExcessArguments(false);

  program.exitOverride();
  try {
    program.parse(args, { from: 'user' });
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

  const agentOutputRaw = opts.agentOutput || '';
  let agentOutputMode = 'stdout';
  let agentOutputPath = null;
  if (agentOutputRaw.toLowerCase() === 'stdout') {
    agentOutputMode = 'stdout';
  } else {
    agentOutputMode = 'path';
    agentOutputPath = path.resolve(agentOutputRaw);
  }

  return {
    stage,
    figmaUrl: opts.figmaUrl || undefined,
    figmaToken: opts.figmaToken,
    target: opts.target,
    componentList,
    agentOutputMode,
    agentOutputPath,
    force: Boolean(opts.force),
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

function findConfigUpwards(startDir, filename) {
  let dir = startDir;
  while (true) {
    const candidate = path.join(dir, filename);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function loadSuperconnectConfig(filePath = 'superconnect.toml') {
  const direct = path.resolve(filePath);
  const located =
    fs.existsSync(direct) ? direct : findConfigUpwards(process.cwd(), filePath) || null;
  if (!located) return {};
  try {
    const raw = fs.readFileSync(located, 'utf8');
    return parseSimpleToml(raw);
  } catch (err) {
    console.warn(`⚠️  Failed to load ${located}: ${err.message}`);
    return {};
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
    console.error(
      `❌ ${name} requires an agent runner. Set [agent].run_command in superconnect.toml and re-run.`
    );
    return Promise.resolve({ ok: false, code: 1, manual: true });
  }
  const cwd = options.cwd || undefined;
  console.log(`• ${name} (agent via: ${runner}${cwd ? ` @ ${cwd}` : ''})`);
  const payload = payloadLines.join('\n');
  const resolvedLogFile =
    options.logFile ||
    (context.agentOutputMode === 'path'
      ? context.agentOutputPath
      : context.agentLogDir
      ? path.join(context.agentLogDir, `${slugify(name)}.log`)
      : null);
  let logStream = null;

  if (resolvedLogFile) {
    ensureDir(path.dirname(resolvedLogFile));
    logStream = fs.createWriteStream(resolvedLogFile, { flags: 'w' });
    console.log(`  ↳ logging to: ${resolvedLogFile}`);
  }

  return new Promise((resolve) => {
    const child = spawn(runner, { shell: true, cwd, env: { ...process.env, FIGMA_ACCESS_TOKEN: context.figmaToken } });
    child.stdin.write(payload);
    child.stdin.end();

    const handleChunk = (chunk) => {
      const text = chunk.toString();
      if (logStream) logStream.write(text);
      if (context.agentOutputMode === 'stdout') {
        process.stdout.write(text);
        return;
      }
    };

    child.stdout.on('data', handleChunk);
    child.stderr.on('data', handleChunk);

    child.on('close', (code) => {
      if (logStream) logStream.end();
      if (code === 0) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, code: code || 1 });
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
  const baseOutput = target ? path.join(target, 'superconnect') : path.resolve('superconnect');
  const figmaDir = path.join(baseOutput, 'figma-components');
  const figmaIndex = path.join(baseOutput, 'figma-components-index.json');
  const agentLogDir = path.join(baseOutput, 'agent-logs');
  const codeconnectDir = target ? path.join(target, 'codeconnect') : path.join(baseOutput, 'codeconnect');
  const runLogDir = path.join(baseOutput, 'logs');
  const configFilePath = target ? path.join(target, 'figma.config.json') : path.join(baseOutput, 'figma.config.json');
  const summaryFile = path.join(baseOutput, 'SUPERCONNECT_SUMMARY.md');

  return {
    ...args,
    target,
    superconnectDir: baseOutput,
    figmaDir,
    figmaIndex,
    agentLogDir,
    codeconnectDir,
    runLogDir,
    configFile: configFilePath,
    summaryFile
  };
}

function printConfig(config, context = {}, stages = {}) {
  const header = chalk.bold.cyan('===== Superconnect =====');
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
    `${chalk.dim('    Agent output:   ')} ${
      context.agentOutputMode === 'path' ? `log → ${rel(context.agentOutputPath)}` : context.agentOutputMode
    }`,
    `${chalk.dim('    Agent logs:     ')} ${rel(config.agentLogDir)}`
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
  console.log(chalk.bold('Stages:'));
  console.log(
    [
      `    figma scan: ${stages.figmaScan ? 'on' : 'off'}`,
      `    codegen:    ${stages.agent ? 'on' : 'off'}`,
      `    finalize:   ${stages.finalize ? 'on' : 'off'}`
    ].join('\n')
  );
  if (stages.agent && config.componentList && config.componentList.length) {
    console.log(`\nGenerating coding for components: [${config.componentList.join(', ')}]`);
  }
  console.log('');
}

function ensureFigmaInputs(config) {
  if (!config.figmaUrl && !fs.existsSync(config.figmaIndex) && !dirHasFiles(config.figmaDir)) {
    return { error: 'Missing figma data. Provide --figma-url or configure inputs.figma_url in superconnect.toml.' };
  }
  return { ok: true };
}

function figmaScanStage(config, context) {
  if (context.forceFigma && !context.dryRun) {
    try {
      if (fs.existsSync(config.figmaDir)) {
        fs.rmSync(config.figmaDir, { recursive: true, force: true });
      }
      if (fs.existsSync(config.figmaIndex)) {
        fs.rmSync(config.figmaIndex, { force: true });
      }
    } catch (err) {
      console.warn(`⚠️  Unable to clear previous figma artifacts (${err.message}); continuing.`);
    }
  }

  ensureDir(config.figmaDir);
  const hasFiles = dirHasFiles(config.figmaDir);
  const hasIndex = fs.existsSync(config.figmaIndex);

  if (hasFiles && hasIndex && !context.forceFigma) {
    console.log(`• Using existing Figma artifacts at ${config.figmaDir}`);
    return { ok: true, reused: true };
  }

  if (!config.figmaUrl) {
    console.error('❌ Missing figma-url and no cached figma artifacts. Set inputs.figma_url or pass --figma-url.');
    return { ok: false, code: 1 };
  }
  if (!context.figmaToken) {
    console.error('❌ Missing Figma token (set FIGMA_ACCESS_TOKEN or pass --figma-token).');
    return { ok: false, code: 1 };
  }

  const fileKey = parseFileKey(config.figmaUrl);
  const cmd = [
    'node scripts/figma-scan.js',
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

  if (!fs.existsSync(config.figmaIndex) && dirHasFiles(config.figmaDir)) {
    const index = buildFigmaIndex(config.figmaDir);
    writeJson(config.figmaIndex, index);
    console.log(`• Rebuilt figma index at ${config.figmaIndex}`);
  }

  return { ok: true };
}

async function agentStage(config, context) {
  if (!config.componentList || config.componentList.length === 0) {
    console.log('• Agent stage skipped (no components specified)');
    return { ok: true, skipped: true };
  }
  if (!dirHasFiles(config.figmaDir) || !fs.existsSync(config.figmaIndex)) {
    console.error('❌ Missing figma artifacts. Run `superconnect figmascan` first.');
    return { ok: false, code: 1 };
  }
  if (context.forceAgent && !context.dryRun) {
    try {
      if (fs.existsSync(config.agentLogDir)) {
        fs.rmSync(config.agentLogDir, { recursive: true, force: true });
      }
      if (fs.existsSync(config.runLogDir)) {
        fs.rmSync(config.runLogDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.warn(`⚠️  Unable to clear previous codegen artifacts (${err.message}); continuing.`);
    }
    try {
      if (config.codeconnectDir && fs.existsSync(config.codeconnectDir)) {
        const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const targets = new Set((config.componentList || []).map((name) => normalize(name)));
        fs.readdirSync(config.codeconnectDir)
          .filter((f) => f.toLowerCase().endsWith('.figma.tsx'))
          .forEach((file) => {
            const base = file.replace(/\.figma\.tsx$/i, '');
            if (targets.has(normalize(base))) {
              const fullPath = path.join(config.codeconnectDir, file);
              fs.rmSync(fullPath, { force: true });
            }
          });
      }
    } catch (err) {
      console.warn(`⚠️  Unable to clear previous codegen output files (${err.message}); continuing.`);
    }
  }
  ensureDir(config.agentLogDir);
  ensureDir(config.runLogDir);
  const promptPath = path.resolve('prompts/codegen-agent.md');
  if (!fs.existsSync(promptPath)) {
    console.error(`❌ Missing agent prompt at ${promptPath}`);
    return { ok: false, code: 1 };
  }
  const prompt = fs.readFileSync(promptPath, 'utf8');
  const promptText = prompt
    .replace(/{FIGMA_DIR}/g, config.figmaDir)
    .replace(/{FIGMA_INDEX}/g, config.figmaIndex)
    .replace(/{COMPONENT_LIST}/g, JSON.stringify(config.componentList || []))
    .replace(/{CODECONNECT_DIR}/g, config.codeconnectDir || 'codeconnect')
    .replace(/{RUN_LOG_DIR}/g, config.runLogDir || path.join(config.target, 'superconnect', 'logs'));
  const runtimeConfig = {
    figmaDir: config.figmaDir,
    figmaIndex: config.figmaIndex,
    runLogDir: config.runLogDir,
    codeconnectDir: config.codeconnectDir,
    configFile: config.configFile,
    summaryFile: config.summaryFile,
    figmaUrl: config.figmaUrl || null,
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
  const expectedLogs = (config.componentList || []).map((name) =>
    path.join(config.runLogDir, `${sanitizeComponentSlug(name) || name}.json`)
  );
  const missingLogs = expectedLogs.filter((p) => !fs.existsSync(p));
  if (missingLogs.length) {
    console.error(`❌ Agent did not produce required per-component logs: ${missingLogs.join(', ')}`);
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
  if (context.forceFinalize && !context.dryRun) {
    [config.configFile, config.summaryFile].forEach((file) => {
      if (!file) return;
      try {
        if (fs.existsSync(file)) fs.rmSync(file, { force: true });
      } catch (err) {
        console.warn(`⚠️  Unable to clear previous finalize output (${file}): ${err.message}`);
      }
    });
  }
  const args = [
    `--target "${config.target}"`,
    `--figma-index "${config.figmaIndex}"`,
    `--figma-dir "${config.figmaDir}"`,
    `--config-file "${config.configFile}"`,
    `--summary-file "${config.summaryFile}"`,
    `--codeconnect-dir "${config.codeconnectDir}"`
  ];
  if (config.figmaUrl) args.push(`--figma-url "${config.figmaUrl}"`);
  const cmd = `node scripts/finalize.js ${args.join(' ')}`;
  return runCommand('Finalizer', cmd, context);
}

async function main() {
  const argv = process.argv.slice(2);
  const parsed = parseArgv(argv);
  const cfg = loadSuperconnectConfig();
  if (!parsed.figmaUrl && cfg.inputs?.figma_url) parsed.figmaUrl = cfg.inputs.figma_url;
  if (!parsed.target && cfg.inputs?.component_repo_path) parsed.target = cfg.inputs.component_repo_path;
  const config = resolvePaths({ ...parsed });
  const agentRunner = cfg.agent?.run_command || null;
  config.agentRunner = agentRunner;

  if (!config.target) {
    console.error('❌ Missing target repo. Set inputs.component_repo_path in superconnect.toml or pass --target.');
    process.exit(1);
  }
  if (!fs.existsSync(config.target) || !fs.statSync(config.target).isDirectory()) {
    console.error(`❌ Target repo not found or not a directory: ${config.target}`);
    process.exit(1);
  }

  const figmaToken = parsed.figmaToken || loadEnvToken();
  const stages = {
    figmaScan: parsed.stage === 'all' || parsed.stage === 'figmascan',
    agent: parsed.stage === 'all' || parsed.stage === 'codegen',
    finalize: parsed.stage === 'all' || parsed.stage === 'finalize'
  };
  const context = {
    figmaToken,
    dryRun: parsed.dryRun,
    agentRunner,
    agentLogDir: config.agentLogDir,
    agentOutputMode: parsed.agentOutputMode,
    agentOutputPath: parsed.agentOutputPath,
    forceFigma: parsed.force && stages.figmaScan,
    forceAgent: parsed.force && stages.agent,
    forceFinalize: parsed.force && stages.finalize
  };

  printConfig(config, context, stages);

  const figmaCheck = ensureFigmaInputs(config);
  if (figmaCheck.error) {
    console.error(`❌ ${figmaCheck.error}`);
    process.exit(1);
  }

  if (stages.figmaScan) {
    if (!dirHasFiles(config.figmaDir) && !figmaToken) {
      console.error('❌ Missing Figma token (set --figma-token or FIGMA_ACCESS_TOKEN/.env)');
      process.exit(1);
    }
    const figmaScan = figmaScanStage(config, context);
    if (!figmaScan.ok) process.exit(figmaScan.code || 1);
  } else {
    if (!dirHasFiles(config.figmaDir) || !fs.existsSync(config.figmaIndex)) {
      console.error('❌ Figma artifacts missing. Run `superconnect figmascan` first.');
      process.exit(1);
    }
  }

  if (stages.agent) {
    const agent = await agentStage(config, context);
    if (!agent.ok) process.exit(agent.code || 1);
  }

  if (stages.finalize) {
    const finalize = finalizeStage(config, context);
    if (!finalize.ok) process.exit(finalize.code || 1);
  }

  console.log(chalk.green.bold('✅ Superconnect pipeline completed'));
}

main();
