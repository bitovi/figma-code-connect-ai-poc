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
const { Command } = require('commander');
const prompts = require('prompts');
const execa = require('execa');
const chalk = require('chalk').default;
const TOML = require('@iarna/toml');
const { figmaColor, codeColor, generatedColor, highlight } = require('./colors');

const DEFAULT_AGENT_RUNNER = 'codex exec --model gpt-5.1-codex-mini --sandbox read-only';
const DEFAULT_CONFIG_FILE = 'superconnect.toml';
const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5';
const DEFAULT_OPENAI_MODEL = 'gpt-5.1-codex-mini';
const DEFAULT_BACKEND = 'claude';
const DEFAULT_MAX_TOKENS = 12000;

const parseMaybeInt = (value) => {
  const n = value ? parseInt(value, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

function loadSuperconnectConfig(filePath = 'superconnect.toml') {
  const direct = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(direct)) return null;
  try {
    const raw = fs.readFileSync(direct, 'utf8');
    return TOML.parse(raw);
  } catch (err) {
    console.warn(`⚠️  Failed to load ${direct}: ${err.message}`);
    return null;
  }
}

function ensureDir(dir) {
  if (!dir) return;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function normalizeAgentConfig(agentSection = {}) {
  const backendRaw = (agentSection.backend || DEFAULT_BACKEND).toLowerCase();
  const backend = backendRaw === 'openai' || backendRaw === 'claude' || backendRaw === 'cli' ? backendRaw : DEFAULT_BACKEND;
  const model =
    agentSection.sdk_model ||
    (backend === 'openai'
      ? DEFAULT_OPENAI_MODEL
      : backend === 'claude'
      ? DEFAULT_CLAUDE_MODEL
      : null);
  const cliCommand = agentSection.cli_command || DEFAULT_AGENT_RUNNER;
  const maxTokens = parseMaybeInt(agentSection.max_tokens);
  const resolvedMaxTokens = backend === 'claude' ? maxTokens || DEFAULT_MAX_TOKENS : maxTokens || null;
  return { backend, model, cliCommand, maxTokens: resolvedMaxTokens };
}

function buildAgentSection(active, activeModel) {
  const blocks = [
    {
      name: 'claude',
      header: '# Using Claude SDK (requires ANTHROPIC_API_KEY environment var)',
      lines: [
        'backend = "claude"                  # options: cli, openai, claude',
        `sdk_model = "${(active === 'claude' ? activeModel : null) || DEFAULT_CLAUDE_MODEL}"`
      ]
    },
    {
      name: 'openai',
      header: '# Using OpenAI SDK (requires OPENAI_API_KEY environment var)',
      lines: ['backend = "openai"', `sdk_model = "${(active === 'openai' ? activeModel : null) || DEFAULT_OPENAI_MODEL}"`]
    },
    {
      name: 'cli',
      header: '# Using CLI (Codex CLI)',
      lines: ['backend = "cli"', `cli_command = "${DEFAULT_AGENT_RUNNER}"`]
    }
  ];

  return blocks.flatMap((block) => {
    const isActive = block.name === active;
    return [
      block.header,
      ...block.lines.map((line) => (isActive ? line : `# ${line}`)),
      ''
    ];
  });
}

async function promptForConfig() {
  console.log(`${chalk.yellow('No superconnect.toml found in this directory.')}`);
  const responses = await prompts(
    [
      {
        type: 'text',
        name: 'figmaUrl',
        message: 'Enter Figma file URL or key',
        validate: (value) => (value && value.trim() ? true : 'Figma URL is required')
      },
      {
        type: 'text',
        name: 'repoPath',
        message: 'Enter component repo path',
        initial: '.'
      },
      {
        type: 'select',
        name: 'backend',
        message: 'Agent backend',
        choices: [
          { title: 'claude (default)', value: 'claude' },
          { title: 'openai', value: 'openai' },
          { title: 'cli', value: 'cli' }
        ],
        initial: 0
      }
    ],
    {
      onCancel: () => {
        console.log(chalk.red('Aborted.'));
        process.exit(1);
      }
    }
  );

  const active = responses.backend || DEFAULT_BACKEND;
  const chooseModel = (b) => {
    if (b === 'openai') return DEFAULT_OPENAI_MODEL;
    if (b === 'claude') return DEFAULT_CLAUDE_MODEL;
    return null;
  };
  const sdkModel = chooseModel(active);
  const maxTokens = DEFAULT_MAX_TOKENS;

  const agentSection = buildAgentSection(active, sdkModel);

  const toml = [
    '[inputs]',
    `figma_url = "${responses.figmaUrl}"`,
    `component_repo_path = "${responses.repoPath || '.'}"`,
    '',
    '[agent]',
    `max_tokens = ${maxTokens}`,
    ...agentSection,
    ''
  ].join('\n');

  const outPath = path.resolve(DEFAULT_CONFIG_FILE);
  fs.writeFileSync(outPath, toml, 'utf8');
  console.log(`${chalk.green('✓')} Wrote ${DEFAULT_CONFIG_FILE}`);
  return TOML.parse(toml);
}

async function runCommand(label, command, options = {}) {
  console.log(`${chalk.dim('•')} ${label}`);
  const { env: extraEnv, allowInterrupt = false, ...rest } = options || {};
  const mergedEnv = { ...process.env, ...(extraEnv || {}) };
  try {
    await execa.command(command, {
      stdio: 'inherit',
      shell: true,
      env: mergedEnv,
      ...rest
    });
  } catch (err) {
    if (allowInterrupt && err.signal === 'SIGINT') {
      console.warn(`⚠️  ${label} interrupted by SIGINT; continuing to finalize...`);
      return;
    }
    const code = err.exitCode || 1;
    console.error(`❌ ${label} failed with code ${code}`);
    process.exit(code);
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

async function main() {
  let interrupted = false;
  process.on('SIGINT', () => {
    if (interrupted) return;
    interrupted = true;
    console.log(`\n${chalk.yellow('Received SIGINT. Attempting graceful stop after current stage...')}`);
  });

  const args = parseArgv(process.argv);
  let cfg = loadSuperconnectConfig(DEFAULT_CONFIG_FILE);
  if (cfg) {
    console.log(`${chalk.green('✓')} Using ${highlight(DEFAULT_CONFIG_FILE)} in ${process.cwd()}`);
  } else {
    cfg = await promptForConfig();
    if (!cfg) {
      console.error('❌ Failed to initialize superconnect.toml');
      process.exit(1);
    }
  }
  const figmaUrl = args.figmaUrl || cfg.inputs?.figma_url || undefined;
  const target =
    args.target ||
    (cfg.inputs?.component_repo_path ? path.resolve(cfg.inputs.component_repo_path) : path.resolve('.'));
  const figmaToken = args.figmaToken || loadEnvToken();
  const agentConfig = normalizeAgentConfig(cfg.agent || {});
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    console.error(`❌ Target repo not found or not a directory: ${target}`);
    process.exit(1);
  }
  const paths = resolvePaths({ ...args, figmaUrl, target, figmaToken });

  const agentLabel =
    agentConfig.backend === 'openai'
      ? `openai${agentConfig.model ? ` (model ${agentConfig.model})` : ''}`
      : agentConfig.backend === 'claude'
      ? `claude${agentConfig.model ? ` (model ${agentConfig.model})` : ''}`
      : `cli (${agentConfig.cliCommand})`;
  console.log(`${chalk.dim('•')} ${highlight('Agent backend')}: ${highlight(agentLabel)}`);

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
    await runCommand(`${highlight('Figma scan')} → ${figmaColor(rel(paths.figmaIndex))}`, cmd);
  } else {
    console.log(
      `${chalk.dim('•')} ${highlight('Figma scan')} (skipped, ${figmaColor(
        rel(paths.figmaIndex)
      )} already present)`
    );
  }

  if (needRepoSummary) {
    const cmd = [
      `node ${path.join(paths.scriptDir, 'summarize-repo.js')}`,
      `--root "${paths.target}"`,
      '>',
      `"${paths.repoSummary}"`
    ].join(' ');
    await runCommand(`${highlight('Repo summary')} → ${codeColor(rel(paths.repoSummary))}`, cmd, { shell: '/bin/zsh' });
  } else {
    console.log(
      `${chalk.dim('•')} ${highlight('Repo summary')} (skipped, ${codeColor(
        rel(paths.repoSummary)
      )} present)`
    );
  }

  if (needOrientation) {
    const cmd = [
      `node ${path.join(paths.scriptDir, 'run-orienter.js')}`,
      `--figma-index "${paths.figmaIndex}"`,
      `--repo-summary "${paths.repoSummary}"`,
      `--output "${paths.orientation}"`,
      `--agent-backend "${agentConfig.backend}"`,
      agentConfig.model ? `--agent-model "${agentConfig.model}"` : '',
      agentConfig.maxTokens ? `--agent-max-tokens "${agentConfig.maxTokens}"` : '',
      agentConfig.backend === 'cli' ? `--agent-cli "${agentConfig.cliCommand}"` : ''
    ].join(' ');
    await runCommand(`${highlight('Orienter')} → ${codeColor(rel(paths.orientation))}`, cmd);
  } else {
    console.log(
      `${chalk.dim('•')} ${highlight('Orienter')} (skipped, ${codeColor(
        rel(paths.orientation)
      )} already present)`
    );
  }

  {
    const codegenCmd = [
      `node ${path.join(paths.scriptDir, 'run-codegen.js')}`,
      `--figma-index "${paths.figmaIndex}"`,
      `--orienter "${paths.orientation}"`,
      `--agent-backend "${agentConfig.backend}"`,
      agentConfig.model ? `--agent-model "${agentConfig.model}"` : '',
      agentConfig.maxTokens ? `--agent-max-tokens "${agentConfig.maxTokens}"` : '',
      agentConfig.backend === 'cli' ? `--agent-cli "${agentConfig.cliCommand}"` : '',
      args.force ? '--force' : ''
    ]
      .filter(Boolean)
      .join(' ');
    await runCommand(
      `${highlight('Code Generation')} (${codeColor(rel(paths.orientation))} → ${generatedColor(rel(paths.codeconnectDir))})`,
      codegenCmd,
      { cwd: paths.target, allowInterrupt: true }
    );
  }

  {
    const cmd = [
      `node ${path.join(paths.scriptDir, 'finalize.js')}`,
      `--superconnect "${paths.superconnectDir}"`,
      `--codeconnect "${paths.codeconnectDir}"`,
      `--cwd "${paths.target}"`
    ].join(' ');
    await runCommand(`${highlight('Finalize')} (summarizing ${generatedColor(rel(paths.superconnectDir))})`, cmd);
  }

  console.log(`${chalk.green('✓')} Pipeline complete.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
