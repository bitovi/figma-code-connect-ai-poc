#!/usr/bin/env node

/**
 * Superconnect pipeline v4 (5 stages):
 * 1) Figma scan
 * 2) Repo summarizer
 * 3) Orienter
 * 4) Codegen
 * 5) Finalizer (summary)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Command } = require('commander');
const chalk = require('chalk').default;

const DEFAULT_AGENT_RUNNER = 'codex exec --model gpt-5.1-codex-mini --sandbox read-only';

function parseSimpleToml(text) {
  const result = {};
  let section = null;
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1).trim() || null;
      if (section && !result[section]) result[section] = {};
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
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function runCommand(label, command, options = {}) {
  console.log(`${chalk.dim('•')} ${chalk.cyan(label)}`);
  const { env: extraEnv, ...rest } = options || {};
  const mergedEnv = { ...process.env, ...(extraEnv || {}) };
  const result = spawnSync(command, {
    stdio: 'inherit',
    shell: true,
    env: mergedEnv,
    ...rest
  });
  if (result.status !== 0) {
    console.error(`❌ ${label} failed with code ${result.status || 1}`);
    process.exit(result.status || 1);
  }
}

function parseArgv(argv) {
  const program = new Command();
  program
    .name('run-pipeline-4')
    .usage('[options]')
    .option('--figma-url <value>', 'Figma file URL or key (needed for figma scan when not cached)')
    .option('--figma-token <token>', 'Figma API token (or FIGMA_ACCESS_TOKEN/.env)')
    .option('--target <path>', 'Target repo to write Code Connect into')
    .option('--force', 'Re-run stages even if outputs exist');
  program.parse(argv);
  const opts = program.opts();

  return {
    figmaUrl: opts.figmaUrl || undefined,
    figmaToken: opts.figmaToken,
    target: opts.target ? path.resolve(opts.target) : undefined,
    force: Boolean(opts.force)
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

function resolvePaths(config) {
  const target = config.target;
  const scriptDir = __dirname;
  const superconnectDir = path.join(target, 'superconnect');
  const figmaDir = path.join(superconnectDir, 'figma-components');
  const figmaIndex = path.join(superconnectDir, 'figma-components-index.json');
  const repoSummary = path.join(superconnectDir, 'repo-summary.json');
  const orientation = path.join(superconnectDir, 'orientation.jsonl');
  const agentLogDir = path.join(superconnectDir, 'orienter-logs');
  const codegenLogDir = path.join(superconnectDir, 'codegen-logs');
  const codeconnectDir = path.join(target, 'codeconnect');
  const summaryFile = path.join(config.target, 'SUPERCONNECT_SUMMARY.md');

  return {
    ...config,
    scriptDir,
    superconnectDir,
    figmaDir,
    figmaIndex,
    repoSummary,
    orientation,
    agentLogDir,
    codegenLogDir,
    codeconnectDir,
    summaryFile
  };
}

function main() {
  const args = parseArgv(process.argv);
  const cfg = loadSuperconnectConfig();
  const figmaUrl = args.figmaUrl || cfg.inputs?.figma_url || undefined;
  const target =
    args.target ||
    (cfg.inputs?.component_repo_path ? path.resolve(cfg.inputs.component_repo_path) : path.resolve('.'));
  const figmaToken = args.figmaToken || loadEnvToken();
  const agentBackend = (cfg.agent?.backend || 'cli').toLowerCase() === 'openai' ? 'openai' : 'cli';
  const cliCommand =
    process.env.AGENT_RUN_COMMAND ||
    cfg.agent?.cli_command ||
    DEFAULT_AGENT_RUNNER;
  const agentModel = cfg.agent?.model || null;
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    console.error(`❌ Target repo not found or not a directory: ${target}`);
    process.exit(1);
  }
  const paths = resolvePaths({ ...args, figmaUrl, target, figmaToken });
  const agentEnv =
    agentBackend === 'openai'
      ? {
          AGENT_BACKEND: 'openai',
          ...(agentModel ? { AGENT_MODEL: agentModel } : {})
        }
      : {
          AGENT_BACKEND: 'cli',
          AGENT_RUN_COMMAND: cliCommand
        };

  const agentLabel =
    agentBackend === 'openai'
      ? `openai${agentModel ? ` (model ${agentModel})` : ''}`
      : `cli (${cliCommand})`;
  console.log(`${chalk.dim('•')} ${chalk.cyan('Agent backend')}: ${agentLabel}`);

  ensureDir(paths.superconnectDir);
  ensureDir(paths.figmaDir);

  const needFigmaScan = args.force || !fs.existsSync(paths.figmaIndex);
  const needRepoSummary = args.force || !fs.existsSync(paths.repoSummary);
  const needOrientation = args.force || !fs.existsSync(paths.orientation);
  const rel = (p) => path.relative(process.cwd(), p) || p;

  if (needFigmaScan) {
    if (!paths.figmaUrl) {
      console.error('❌ --figma-url is required for figma scan when no index exists.');
      process.exit(1);
    }
    const cmd = [
      `node ${path.join(paths.scriptDir, 'figma-scan.js')}`,
      `"${paths.figmaUrl}"`,
      `--token "${figmaToken || ''}"`,
      `--output "${paths.figmaDir}"`,
      `--index "${paths.figmaIndex}"`
    ].join(' ');
    runCommand('Figma scan', cmd);
  } else {
    console.log(
      `${chalk.dim('•')} ${chalk.cyan('Figma scan')} (skipped, ${rel(paths.figmaIndex)} already present)`
    );
  }

  if (needRepoSummary) {
    const cmd = [
      `node ${path.join(paths.scriptDir, 'summarize-repo.js')}`,
      `--root "${paths.target}"`,
      '>',
      `"${paths.repoSummary}"`
    ].join(' ');
    runCommand('Repo summary', cmd, { shell: '/bin/zsh' });
  } else {
    console.log(`${chalk.dim('•')} ${chalk.cyan('Repo summary')} (skipped, ${rel(paths.repoSummary)} present)`);
  }

  if (needOrientation) {
    const cmd = [
      `node ${path.join(paths.scriptDir, 'run-orienter.js')}`,
      `--figma-index "${paths.figmaIndex}"`,
      `--repo-summary "${paths.repoSummary}"`,
      `--output "${paths.orientation}"`
    ].join(' ');
    runCommand('Orienter', cmd, { env: agentEnv });
  } else {
    console.log(
      `${chalk.dim('•')} ${chalk.cyan('Orienter')} (skipped, ${rel(paths.orientation)} already present)`
    );
  }

  {
    const codegenCmd = [
      `node ${path.join(paths.scriptDir, 'run-codegen.js')}`,
      `--figma-index "${paths.figmaIndex}"`,
      `--orienter "${paths.orientation}"`,
      args.force ? '--force' : ''
    ]
      .filter(Boolean)
      .join(' ');
    runCommand('Codegen', codegenCmd, { cwd: paths.target, env: agentEnv });
  }

  {
    const cmd = [
      `node ${path.join(paths.scriptDir, 'finalize.js')}`,
      `--superconnect "${paths.superconnectDir}"`,
      `--codeconnect "${paths.codeconnectDir}"`,
      `--cwd "${paths.target}"`
    ].join(' ');
    runCommand('Finalize', cmd);
  }

  console.log(`${chalk.green('✓')} Pipeline complete.`);
}

main();
