#!/usr/bin/env node

/**
 * One-shot pipeline orchestrator for Figma Code Connect.
 *
 * Goal: run the golden-path steps with three primary inputs:
 *   --figma-url <url|fileKey>
 *   --repo-path <path to code repo>
 *   --figma-token <token> (or FIGMA_ACCESS_TOKEN env/.env)
 *
 * The pipeline stitches together existing scripts plus optional agent steps
 * (orientation, matching, and codegen). Agent steps can be automated by
 * providing --agent-runner (e.g., "codex exec --cd . --model gpt-5.1-codex-max"),
 * otherwise the script will instruct the user how to run them manually.
 *
 * Flags:
 *   --figma-url <url|fileKey>    (required)
 *   --repo-path <path>           (default: ../chakra-ui)
 *   --figma-token <token>        (falls back to FIGMA_ACCESS_TOKEN or .env)
 *   --agent-runner <cmd>         (optional) command that reads agent prompt on stdin
 *   --artifacts <dir>            (default: artifacts)
 *   --non-interactive            Skips uncertain reviews (auto-accept certain only)
 *   --force                      Re-run steps even if artifacts already exist
 *   --dry-run                    Print planned commands without executing
 *   --skip-codegen               Skip codegen agent/stub
 *   --help                       Show usage
 *
 * Chakra golden-path defaults are applied when the repo name looks like chakra-ui.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { spawn } = require('child_process');

const DEFAULTS = {
  repoPath: path.resolve('../chakra-ui'),
  artifactsDir: path.resolve('artifacts')
};

function usage() {
  const lines = [
    'One-shot pipeline orchestrator',
    '',
    'Usage:',
    '  node scripts/runPipeline.js --figma-url <url|fileKey> --repo-path <path> --figma-token <token> [options]',
    '',
    'Options:',
    '  --figma-url <value>      Figma file URL or key (required)',
    `  --repo-path <path>       Path to code repo (default: ${DEFAULTS.repoPath})`,
    '  --figma-token <token>    Figma API token (or FIGMA_ACCESS_TOKEN env/.env)',
    '  --agent-runner <cmd>     Command to run agent steps (reads prompt from stdin)',
    '  --agent-stream           Stream full agent stdout/stderr to console (default: suppressed)',
    '  --agent-filter <regex>   When suppressed, echo only lines matching this regex',
    '  --agent-quiet            Suppress agent stdout in console (log file still written if configured)',
    `  --artifacts <dir>        Artifacts root (default: ${DEFAULTS.artifactsDir})`,
    '  --non-interactive        Auto-accept only certain matches (skip uncertain prompts)',
    '  --force                  Re-run steps even if artifacts exist',
    '  --dry-run                Print commands without executing them',
    '  --skip-codegen           Skip codegen validation/agent handoff',
    '  --help                   Show this help message'
  ];
  console.log(lines.join('\n'));
}

function parseArgv(argv) {
  const args = { ...DEFAULTS, flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--figma-url':
        args.figmaUrl = next;
        i++;
        break;
      case '--repo-path':
        args.repoPath = path.resolve(next);
        i++;
        break;
      case '--figma-token':
        args.figmaToken = next;
        i++;
        break;
      case '--agent-runner':
        args.agentRunner = next;
        i++;
        break;
      case '--agent-stream':
        args.flags.add('agentStream');
        break;
      case '--agent-filter':
        args.agentFilter = next;
        i++;
        break;
      case '--artifacts':
        args.artifactsDir = path.resolve(next);
        i++;
        break;
      case '--non-interactive':
        args.flags.add('nonInteractive');
        break;
      case '--agent-quiet':
        args.flags.add('agentQuiet');
        break;
      case '--dry-run':
        args.flags.add('dryRun');
        break;
      case '--skip-codegen':
        args.flags.add('skipCodegen');
        break;
      case '--force':
        args.flags.add('force');
        break;
      case '--help':
        args.flags.add('help');
        break;
      default:
        if (!arg.startsWith('--') && !args.figmaUrl) {
          args.figmaUrl = arg;
        } else if (arg.startsWith('--')) {
          console.warn(`Unknown option: ${arg}`);
        }
    }
  }
  return args;
}

function loadEnvToken() {
  const envPath = path.resolve('.env');
  if (process.env.FIGMA_ACCESS_TOKEN) return process.env.FIGMA_ACCESS_TOKEN;
  if (!fs.existsSync(envPath)) return null;
  const line = fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith('FIGMA_ACCESS_TOKEN='));
  if (!line) return null;
  const [, value] = line.split('=');
  return (value || '').trim() || null;
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
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function dirHasFiles(dir) {
  return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
}

function looksLikeChakra(repoPath) {
  return repoPath.toLowerCase().includes('chakra-ui');
}

function defaultManifestConfig(repoPath) {
  if (!looksLikeChakra(repoPath)) return null;
  return {
    componentRoot: path.join(repoPath, 'packages/react/src'),
    recipesPath: path.join(repoPath, 'packages/react/src/theme/recipes'),
    importStyle: 'package',
    importTarget: '@chakra-ui/react',
    tsconfigPaths: []
  };
}

function writeManifest(manifestPath, manifestConfig) {
  ensureDir(path.dirname(manifestPath));
  fs.writeFileSync(manifestPath, JSON.stringify(manifestConfig, null, 2), 'utf8');
}

function runCommand(label, command, options, context) {
  const { dryRun } = context;
  console.log(`• ${label}`);
  if (dryRun) {
    console.log(`  (dry-run) ${command}`);
    return { ok: true, skipped: true };
  }
  const result = spawnSync(command, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, FIGMA_ACCESS_TOKEN: context.figmaToken }
  });
  if (result.status !== 0) {
    return { ok: false, code: result.status };
  }
  return { ok: true };
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
}

function runAgentStep(name, promptPath, payloadLines, context, options = {}) {
  if (context.dryRun) {
    console.log(`• ${name} (agent)`);
    console.log(`  (dry-run) prompt: ${promptPath}`);
    return { ok: true, skipped: true };
  }
  const runner = options.runner || context.agentRunner;
  if (!runner) {
    console.log(`⚠️  ${name} requires an agent. Run manually with ${promptPath}:\n${payloadLines.join('\n')}`);
    return { ok: false, manual: true };
  }
  const cwd = options.cwd || undefined;
  console.log(`• ${name} (agent via: ${runner}${cwd ? ` @ ${cwd}` : ''})`);
  const payload = payloadLines.join('\n');
  const logFile = context.agentLogDir ? path.join(context.agentLogDir, `${slugify(name)}.log`) : null;
  let logStream = null;
  let warnedSuppressed = false;
  const filterPattern = context.agentFilter ? new RegExp(context.agentFilter) : null;
  let filterBuffer = '';

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

      if (!context.agentQuiet) {
        process.stdout.write(text);
        return;
      }

      if (filterPattern) {
        const combined = filterBuffer + text;
        const parts = combined.split(/\r?\n/);
        filterBuffer = parts.pop() || '';
        parts.forEach((line) => {
          if (filterPattern.test(line)) {
            console.log(line);
          }
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
      resolve(code === 0 ? { ok: true } : { ok: false, code });
    });
  });
}

function parseFileKey(figmaUrlOrKey) {
  if (!figmaUrlOrKey) return '';
  const match = figmaUrlOrKey.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/);
  return match ? match[1] : figmaUrlOrKey;
}

async function ensureManifestStep(config, context) {
  if (fs.existsSync(config.manifest)) {
    if (!context.force) {
      console.log(`• Manifest exists: ${config.manifest} (skipped, use --force to regenerate)`);
      return { ok: true, skipped: true };
    }
    console.log('• Regenerating manifest (force)');
  }
  const inline = defaultManifestConfig(config.repoPath);
  if (inline) {
    writeManifest(config.manifest, inline);
    console.log(`✅ Wrote manifest (Chakra defaults) → ${config.manifest}`);
    return { ok: true };
  }
  const payload = [
    `Use prompts/orientation.md.`,
    `Target repo: ${config.repoPath}`,
    `Write manifest to ${config.manifest}.`
  ];
  return runAgentStep('Orientation', 'prompts/orientation.md', payload, context, { cwd: config.repoPath });
}

function figmaFetchStep(config, context) {
  ensureDir(config.figmaDir);
  if (dirHasFiles(config.figmaDir) && !context.force) {
    console.log(`• Figma fetch skipped; artifacts present at ${config.figmaDir} (use --force to refetch)`);
    return { ok: true, skipped: true };
  }
  const fileKey = parseFileKey(config.figmaUrl);
  const cmd = [
    'node scripts/fetchComponents.js',
    `"${fileKey}"`,
    `--output "${config.figmaDir}"`,
    context.figmaToken ? `--token "${context.figmaToken}"` : ''
  ]
    .filter(Boolean)
    .join(' ');
  return runCommand('Figma fetch', cmd, {}, context);
}

function reactExtractStep(config, context) {
  ensureDir(config.reactDir);
  if (dirHasFiles(config.reactDir) && !context.force) {
    console.log(`• React props extraction skipped; artifacts present at ${config.reactDir} (use --force to re-extract)`);
    return { ok: true, skipped: true };
  }
  const cmd = [
    'node scripts/extractComponentProps.js',
    `--manifest "${config.manifest}"`,
    `--output "${config.reactDir}"`,
    '--overwrite',
    '--verbose'
  ].join(' ');
  return runCommand('React props extraction', cmd, {}, context);
}

function matchingStep(config, context) {
  if (fs.existsSync(config.matchCandidates)) {
    if (!context.force) {
      console.log(`• Matching skipped; match-candidates exist at ${config.matchCandidates} (use --force to rerun)`);
      return { ok: true, skipped: true };
    }
    console.log('• Regenerating match candidates (force)');
  }
  const payload = [
    'Use prompts/matching.md.',
    `Figma JSONs: ${config.figmaDir}`,
    `React JSONs: ${config.reactDir}`,
    `Manifest (context): ${config.manifest}`,
    `Produce match-candidates.jsonl in ${path.dirname(config.matchCandidates)}.`
  ];
  return runAgentStep('Matching', 'prompts/matching.md', payload, context, { cwd: config.repoPath });
}

function reviewStep(config, context) {
  if (fs.existsSync(config.mappings) && !context.force) {
    console.log(`• Review skipped; mappings exist at ${config.mappings} (use --force to re-review)`);
    return { ok: true, skipped: true };
  }
  const cmd = 'node scripts/review-matches.js';
  if (context.dryRun) {
    console.log(`• Review matches\n  (dry-run) ${cmd}`);
    return { ok: true, skipped: true };
  }
  if (context.nonInteractive) {
    const result = spawnSync(cmd, {
      input: 's\n',
      stdio: 'inherit',
      shell: true
    });
    if (result.status !== 0) return { ok: false, code: result.status };
    return { ok: true };
  }
  return runCommand('Review matches', cmd, {}, context);
}

function codegenStep(config, context) {
  if (context.skipCodegen) return { ok: true, skipped: true };
  if (dirHasFiles(config.codeconnectDir) && !context.force) {
    console.log(`• Codegen skipped; outputs exist at ${config.codeconnectDir} (use --force to regenerate)`);
    return { ok: true, skipped: true };
  }
  const validateCmd = [
    'node scripts/generateCodeConnect.js',
    `--manifest "${config.manifest}"`,
    `--mappings "${config.mappings}"`,
    `--figma "${config.figmaDir}"`,
    `--react "${config.reactDir}"`,
    `--out "${config.codeconnectDir}"`
  ].join(' ');
  const validation = runCommand('Codegen validation (stub)', validateCmd, {}, context);
  if (!validation.ok || context.dryRun) return validation;
  return runAgentStep(
    'Codegen',
    'prompts/codegen.md',
    [
      'Use prompts/codegen.md.',
      `Manifest: ${config.manifest}`,
      `Mappings: ${config.mappings}`,
      `React JSONs: ${config.reactDir}`,
      `Figma JSONs: ${config.figmaDir}`,
      `Output dir: ${config.codeconnectDir}`
    ],
    context,
    { runner: context.agentRunner, cwd: path.resolve(context.artifactsDir || '.') }
  );
}

function configBuilderStep(config, context) {
  ensureDir(config.codeconnectDir);
  if (fs.existsSync(config.configFile) && !context.force) {
    console.log(`• Config builder skipped; figma.config.json exists at ${config.configFile} (use --force to regenerate)`);
    ensureCodeconnectReadme(config, context);
    return { ok: true, skipped: true };
  }
  const cmd = [
    'node scripts/buildFigmaConfig.js',
    `--input "${config.figmaDir}"`,
    `--manifest "${config.manifest}"`,
    `--file-key "${config.figmaUrl}"`,
    '--output file',
    `--output-file "${config.configFile}"`
  ].join(' ');
  const result = runCommand('Figma config builder', cmd, {}, context);
  if (result.ok) ensureCodeconnectReadme(config, context);
  return result;
}

function planSteps(config, context) {
  return [
    { name: 'Manifest', run: () => ensureManifestStep(config, context) },
    { name: 'Figma fetch', run: () => figmaFetchStep(config, context) },
    { name: 'React props', run: () => reactExtractStep(config, context) },
    { name: 'Matching', run: () => matchingStep(config, context) },
    { name: 'Review', run: () => reviewStep(config, context) },
    { name: 'Codegen', run: () => codegenStep(config, context) },
    { name: 'Config builder', run: () => configBuilderStep(config, context) }
  ];
}

function maskToken(token) {
  if (!token) return 'missing';
  if (token.length <= 6) return '*'.repeat(token.length);
  const tail = token.slice(-4);
  return `${'*'.repeat(token.length - 4)}${tail}`;
}

function ensureCodeconnectReadme(config, context) {
  if (context.dryRun) return;
  ensureDir(config.codeconnectDir);
  const readmePath = path.join(config.codeconnectDir, 'README.md');
  if (fs.existsSync(readmePath) && !context.force) return;
  const lines = [
    '# Code Connect Outputs',
    '',
    'This folder was generated by the superconnect pipeline.',
    '',
    '- `*.figma.tsx`: component mappings produced from your Figma/React artifacts.',
    `- \`figma.config.json\`: Code Connect config scoped to this run (file key: ${config.figmaUrl}).`,
    '',
    'How to use:',
    '1) Copy (or move) these files into your design system repo where Code Connect expects them.',
    '2) Ensure `figma.config.json` is discoverable by your tooling (root-level by default).',
    '3) Run your Code Connect validation/build steps as you normally would.',
    '',
    'Re-run superconnect with `--force` to regenerate or overwrite this README.'
  ];
  fs.writeFileSync(readmePath, lines.join('\n'), 'utf8');
}

function printBanner(config, context) {
  console.log('=== Figma Code Connect One-Shot ===');
  console.log(`Figma URL/Key: ${config.figmaUrl}`);
  console.log(`Repo path:     ${config.repoPath}`);
  console.log(`Artifacts:     ${config.artifactsDir}`);
  console.log(`Codegen out:   ${config.codeconnectDir}`);
  if (config.configMeta.superconnectUsed) {
    console.log(`Config file:   ${config.configMeta.superconnectPath}`);
  }
  if (context.agentRunner) {
    console.log(`Agent runner:  ${context.agentRunner}`);
    if (context.agentLogDir) console.log(`Agent logs:    ${context.agentLogDir}`);
    if (context.agentFilter) console.log(`Agent filter:  ${context.agentFilter}`);
    console.log(`Agent console: ${context.agentQuiet ? 'suppressed (use --agent-stream or filter)' : 'streaming'}`);
  } else {
    console.log('Agent runner:  (not provided; agent steps will be manual)');
  }
  if (context.dryRun) console.log('Mode:          dry-run (no commands executed)');
  if (context.nonInteractive) console.log('Review mode:   non-interactive (skip uncertain)');
  if (context.force) console.log('Force:         on (regenerate artifacts)');
  if (context.skipCodegen) console.log('Codegen:       skipped');
}

function resolveConfig(args) {
  const configLoad = loadSuperconnectConfig();
  const configFile = configLoad.config || {};
  const inputs = configFile.inputs || {};
  const outputs = configFile.outputs || {};
  const cfg = configFile.config || configFile.s || {};

  const figmaUrl = args.figmaUrl || inputs.figma_url || inputs.figma_file;
  if (!figmaUrl) {
    return { error: 'Missing --figma-url <url|fileKey>' };
  }
  const figmaToken = args.figmaToken || loadEnvToken();
  if (!figmaToken) {
    return { error: 'Missing Figma token (set --figma-token or FIGMA_ACCESS_TOKEN/.env)' };
  }

  const repoPathInput = args.repoPath || inputs.component_repo || inputs.component_repo_root || DEFAULTS.repoPath;
  const artifactsDirInput = args.artifactsDir || outputs.output_dir || DEFAULTS.artifactsDir;
  const artifactsDir = path.resolve(artifactsDirInput);

  const resolved = {
    figmaUrl,
    repoPath: path.resolve(repoPathInput),
    figmaToken,
    artifactsDir,
    manifest: path.join(artifactsDir, 'codeconnect-manifest.json'),
    figmaDir: path.join(artifactsDir, 'figma-components'),
    reactDir: path.join(artifactsDir, 'react-components'),
    matchCandidates: path.join(artifactsDir, 'match-candidates.jsonl'),
    mappings: path.join(artifactsDir, 'mappings.json'),
    codeconnectDir: path.join(artifactsDir, 'codeconnect'),
    agentRunner: args.agentRunner || cfg.agent_run_command,
    agentLogDir: outputs.agents_log_directory ? path.resolve(outputs.agents_log_directory) : null,
    agentQuiet: args.flags.has('agentStream') ? false : true,
    agentFilter: args.agentFilter || null,
    nonInteractive: args.flags.has('nonInteractive'),
    dryRun: args.flags.has('dryRun'),
    skipCodegen: args.flags.has('skipCodegen'),
    force: args.flags.has('force'),
    configFile: path.join(artifactsDir, 'codeconnect', 'figma.config.json'),
    configMeta: {
      superconnectPath: configLoad.path,
      superconnectUsed: configLoad.exists
    }
  };
  return resolved;
}

async function main() {
  const args = parseArgv(process.argv.slice(2));
  if (args.flags.has('help')) {
    usage();
    process.exit(0);
  }

  const config = resolveConfig(args);
  if (config.error) {
    console.error(`❌ ${config.error}`);
    usage();
    process.exit(1);
  }

  const context = {
    figmaToken: config.figmaToken,
    agentRunner: config.agentRunner,
    artifactsDir: config.artifactsDir,
    agentLogDir: config.agentLogDir,
    agentQuiet: config.agentQuiet,
    agentFilter: config.agentFilter,
    nonInteractive: config.nonInteractive,
    dryRun: config.dryRun,
    skipCodegen: config.skipCodegen,
    force: config.force
  };

  ensureDir(config.artifactsDir);
  printBanner(config, context);
  const steps = planSteps(config, context);
  const summary = [];
  for (let idx = 0; idx < steps.length; idx++) {
    const step = steps[idx];
    console.log(`\n[${idx + 1}/${steps.length}] ${step.name}`);
    const result = await step.run();
    if (!result.ok) {
      console.error(`❌ Step failed: ${step.name}`);
      process.exit(result.manual ? 2 : 1);
    }
    summary.push({ name: step.name, status: result.skipped ? 'skipped' : 'done' });
  }
  const done = summary.filter((s) => s.status === 'done').map((s) => s.name);
  const skipped = summary.filter((s) => s.status === 'skipped').map((s) => s.name);
  console.log('\n✅ Pipeline completed.');
  if (done.length) console.log(`  Ran:     ${done.join(', ')}`);
  if (skipped.length) console.log(`  Skipped: ${skipped.join(', ')}`);
  console.log('  Outputs: check artifacts/codeconnect (figma.config.json, .figma.tsx files)');
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
