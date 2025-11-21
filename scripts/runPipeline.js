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
 * providing --agent-runner (e.g., "codex exec --cd . --model gpt-5.1-codex"),
 * otherwise the script will instruct the user how to run them manually.
 *
 * Flags:
 *   --figma-url <url|fileKey>    (required)
 *   --repo-path <path>           (default: ../chakra-ui)
 *   --figma-token <token>        (falls back to FIGMA_ACCESS_TOKEN or .env)
 *   --agent-runner <cmd>         (optional) command that reads agent prompt on stdin
 *   --artifacts <dir>            (default: artifacts)
 *   --format <yaml|json|both>    (default: yaml for fetch/extract)
 *   --non-interactive            Skips uncertain reviews (auto-accept certain only)
 *   --dry-run                    Print planned commands without executing
 *   --skip-codegen               Skip codegen agent/stub
 *   --help                       Show usage
 *
 * Chakra golden-path defaults are applied when the repo name looks like chakra-ui.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULTS = {
  repoPath: path.resolve('../chakra-ui'),
  artifactsDir: path.resolve('artifacts'),
  manifest: path.resolve('artifacts/codeconnect-manifest.json'),
  figmaDir: path.resolve('artifacts/figma-components'),
  reactDir: path.resolve('artifacts/react-components'),
  matchCandidates: path.resolve('artifacts/match-candidates.jsonl'),
  mappings: path.resolve('artifacts/mappings.json'),
  codeconnectDir: path.resolve('artifacts/codeconnect'),
  format: 'yaml'
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
    `  --artifacts <dir>        Artifacts root (default: ${DEFAULTS.artifactsDir})`,
    `  --format <yaml|json|both> Output format for fetch/extract (default: ${DEFAULTS.format})`,
    '  --non-interactive        Auto-accept only certain matches (skip uncertain prompts)',
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
      case '--artifacts':
        args.artifactsDir = path.resolve(next);
        i++;
        break;
      case '--format':
        args.format = next;
        i++;
        break;
      case '--non-interactive':
        args.flags.add('nonInteractive');
        break;
      case '--dry-run':
        args.flags.add('dryRun');
        break;
      case '--skip-codegen':
        args.flags.add('skipCodegen');
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

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
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

function runAgentStep(name, promptPath, payloadLines, context) {
  if (context.dryRun) {
    console.log(`• ${name} (agent)`);
    console.log(`  (dry-run) prompt: ${promptPath}`);
    return { ok: true, skipped: true };
  }
  if (!context.agentRunner) {
    console.log(`⚠️  ${name} requires an agent. Run manually with ${promptPath}:\n${payloadLines.join('\n')}`);
    return { ok: false, manual: true };
  }
  console.log(`• ${name} (agent via: ${context.agentRunner})`);
  const result = spawnSync(context.agentRunner, {
    input: payloadLines.join('\n'),
    stdio: 'inherit',
    shell: true
  });
  if (result.status !== 0) {
    return { ok: false, code: result.status };
  }
  return { ok: true };
}

function parseFileKey(figmaUrlOrKey) {
  const match = (figmaUrlOrKey || '').match(/figma\\.com\\/(?:file|design)\\/([a-zA-Z0-9]+)/);
  return match ? match[1] : figmaUrlOrKey;
}

function ensureManifestStep(config, context) {
  if (fs.existsSync(config.manifest)) {
    console.log(`• Manifest exists: ${config.manifest}`);
    return { ok: true };
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
  return runAgentStep('Orientation', 'prompts/orientation.md', payload, context);
}

function figmaFetchStep(config, context) {
  ensureDir(config.figmaDir);
  const fileKey = parseFileKey(config.figmaUrl);
  const cmd = [
    'node scripts/fetchComponents.js',
    `"${fileKey}"`,
    `--format ${config.format}`,
    `--output "${config.figmaDir}"`,
    context.figmaToken ? `--token "${context.figmaToken}"` : ''
  ]
    .filter(Boolean)
    .join(' ');
  return runCommand('Figma fetch', cmd, {}, context);
}

function reactExtractStep(config, context) {
  ensureDir(config.reactDir);
  const cmd = [
    'node scripts/extractComponentProps.js',
    `--manifest "${config.manifest}"`,
    `--output "${config.reactDir}"`,
    `--format ${config.format}`,
    '--overwrite',
    '--verbose'
  ].join(' ');
  return runCommand('React props extraction', cmd, {}, context);
}

function matchingStep(config, context) {
  if (fs.existsSync(config.matchCandidates)) {
    console.log(`• Match candidates exist: ${config.matchCandidates}`);
    return { ok: true };
  }
  const payload = [
    'Use prompts/matching.md.',
    `Figma YAMLs: ${config.figmaDir}`,
    `React YAMLs: ${config.reactDir}`,
    `Manifest (context): ${config.manifest}`,
    `Produce match-candidates.jsonl in ${path.dirname(config.matchCandidates)}.`
  ];
  return runAgentStep('Matching', 'prompts/matching.md', payload, context);
}

function reviewStep(config, context) {
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
      `React YAMLs: ${config.reactDir}`,
      `Figma YAMLs: ${config.figmaDir}`,
      `Output dir: ${config.codeconnectDir}`
    ],
    context
  );
}

function configBuilderStep(config, context) {
  const cmd = [
    'node scripts/buildFigmaConfig.js',
    `--input "${config.figmaDir}"`,
    `--manifest "${config.manifest}"`,
    `--file-key "${config.figmaUrl}"`,
    '--output file'
  ].join(' ');
  return runCommand('Figma config builder', cmd, {}, context);
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

function printBanner(config, context) {
  console.log('=== Figma Code Connect One-Shot ===');
  console.log(`Repo path: ${config.repoPath}`);
  console.log(`Artifacts: ${config.artifactsDir}`);
  console.log(`Format: ${config.format}`);
  if (context.dryRun) console.log('Mode: dry-run (no commands executed)');
  if (context.agentRunner) console.log(`Agent runner: ${context.agentRunner}`);
}

function resolveConfig(args) {
  if (!args.figmaUrl) {
    return { error: 'Missing --figma-url <url|fileKey>' };
  }
  const figmaToken = args.figmaToken || loadEnvToken();
  if (!figmaToken) {
    return { error: 'Missing Figma token (set --figma-token or FIGMA_ACCESS_TOKEN/.env)' };
  }
  const artifactsDir = args.artifactsDir;
  const resolved = {
    figmaUrl: args.figmaUrl,
    repoPath: args.repoPath,
    figmaToken,
    artifactsDir,
    format: args.format,
    manifest: path.join(artifactsDir, 'codeconnect-manifest.json'),
    figmaDir: path.join(artifactsDir, 'figma-components'),
    reactDir: path.join(artifactsDir, 'react-components'),
    matchCandidates: path.join(artifactsDir, 'match-candidates.jsonl'),
    mappings: path.join(artifactsDir, 'mappings.json'),
    codeconnectDir: path.join(artifactsDir, 'codeconnect'),
    agentRunner: args.agentRunner,
    nonInteractive: args.flags.has('nonInteractive'),
    dryRun: args.flags.has('dryRun'),
    skipCodegen: args.flags.has('skipCodegen')
  };
  return resolved;
}

function main() {
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
    nonInteractive: config.nonInteractive,
    dryRun: config.dryRun,
    skipCodegen: config.skipCodegen
  };

  ensureDir(config.artifactsDir);
  printBanner(config, context);
  const steps = planSteps(config, context);
  for (let idx = 0; idx < steps.length; idx++) {
    const step = steps[idx];
    console.log(`\n[${idx + 1}/${steps.length}] ${step.name}`);
    const result = step.run();
    if (!result.ok) {
      console.error(`❌ Step failed: ${step.name}`);
      process.exit(result.manual ? 2 : 1);
    }
  }
  console.log('\n✅ Pipeline completed (check artifacts for outputs).');
}

main();
