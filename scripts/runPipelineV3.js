#!/usr/bin/env node

/**
 * Barebones v3 pipeline runner (fetch → index → autopilot mapping+codegen → finalize).
 *
 * This runner keeps things simple for testing:
 * - Minimal flags: --figma-url, --repo-path, --figma-token, --artifacts, --force
 * - Autopilot agent writes directly under artifacts/autopilot; this script copies validated outputs into artifacts.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const chalk = require('chalk').default;

const DEFAULTS = {
  repoPath: path.resolve('../chakra-ui'),
  artifactsDir: path.resolve('artifacts'),
  agentProvider: 'codex',
  agentModel: 'gpt-5.1-codex-max'
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function ensureAgentsOverride(dir) {
  const overridePath = path.join(dir, 'AGENTS.md');
  if (fs.existsSync(overridePath)) return overridePath;
  const contents = ['# For Agents', 'You must only refer to this agents file, ignore any others.'].join('\n');
  fs.writeFileSync(overridePath, contents, 'utf8');
  return overridePath;
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

function joinUniquePaths(paths = []) {
  const uniq = new Set(
    paths
      .filter(Boolean)
      .map((p) => path.resolve(p))
  );
  return Array.from(uniq).join(path.delimiter);
}

function buildAgentRunner(provider, model) {
  const prov = provider || DEFAULTS.agentProvider;
  const mdl = model || '';
  const parts = ['node scripts/agentRunner.js', `--provider=${prov}`];
  if (mdl) parts.push(`--model=${mdl}`);
  return parts.join(' ');
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
      case '--artifacts':
        args.artifactsDir = path.resolve(next);
        i++;
        break;
      case '--tmp-root':
        // deprecated; ignored
        i++;
        break;
      case '--force':
        args.flags.add('force');
        break;
      case '--help':
        args.flags.add('help');
        break;
      default:
        // ignore unknowns for now
        break;
    }
  }
  return args;
}

function usage() {
  console.log(
    [
      'Usage: node scripts/runPipelineV3.js --figma-url <url|key> --repo-path <path> --figma-token <token>',
      '',
      'Flags:',
      '  --artifacts <dir>   Artifacts directory (default: artifacts or superconnect.toml outputs.output_dir)',
      '  --tmp-root <dir>    (ignored) legacy; autopilot writes under artifacts/',
      '  --force             Re-run all steps even if outputs exist',
      '  --help              Show this help'
    ].join('\n')
  );
}

function maskToken(token) {
  if (!token) return 'missing';
  if (token.length <= 6) return '*'.repeat(token.length);
  const tail = token.slice(-4);
  return `${'*'.repeat(token.length - 4)}${tail}`;
}

function runCommand(label, command, options = {}) {
  console.log(`${chalk.dim('•')} ${chalk.cyan(label)}`);
  const result = spawnSync(command, {
    shell: true,
    stdio: 'inherit',
    env: options.env || process.env
  });
  if (result.status !== 0) {
    return { ok: false, code: result.status };
  }
  return { ok: true };
}

function ensureTools(tools = []) {
  const missing = [];
  tools.forEach((tool) => {
    const result = spawnSync('which', [tool], { stdio: 'ignore' });
    if (result.status !== 0) {
      missing.push(tool);
    }
  });
  if (missing.length) {
    console.error(
      chalk.red(
        `❌ Missing required CLI tool(s): ${missing.join(
          ', '
        )}. Install via homebrew (e.g., brew install ast-grep ripgrep fd jq) and retry.`
      )
    );
    return false;
  }
  return true;
}

function buildFigmaIndex(figmaDir) {
  const indexPath = path.join(figmaDir, 'index.json');
  let baseMeta = {};
  let components = [];
  if (fs.existsSync(indexPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      baseMeta = {
        fileKey: parsed.fileKey || null,
        fileName: parsed.fileName || null,
        version: parsed.version || null,
        schemaVersion: parsed.schemaVersion || null
      };
      components = Array.isArray(parsed.components) ? parsed.components : [];
    } catch {
      // fall through
    }
  }

  if (components.length === 0) {
    const files = fs.readdirSync(figmaDir).filter((name) => name.endsWith('.json') && name !== 'index.json');
    components = files.reduce((acc, file) => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(figmaDir, file), 'utf8'));
        const componentName = data.componentName || data.name;
        if (!componentName) return acc;
        acc.push({
          name: componentName,
          id: data.componentSetId || data.id || null,
          variantCount:
            data.totalVariants || (Array.isArray(data.variants) ? data.variants.length : null) || null,
          checksum: data.checksum?.value || data.checksum || null,
          schemaVersion: data.schemaVersion || null,
          aliases: data.nameAliases?.candidates || data.aliases || [],
          breadcrumbs: data.breadcrumbs?.trail || data.breadcrumbs || []
        });
        return acc;
      } catch {
        return acc;
      }
    }, []);
  }

  const seen = new Set();
  const normalized = [];
  components.forEach((entry) => {
    const name = (entry.name || '').trim();
    if (!name) return;
    const id = entry.id || null;
    const key = `${name}::${id || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push({
      name,
      id,
      variantCount: entry.variantCount || null,
      checksum: entry.checksum || null,
      schemaVersion: entry.schemaVersion || null,
      aliases: entry.aliases || [],
      breadcrumbs: entry.breadcrumbs || []
    });
  });

  const sorted = normalized.sort(
    (a, b) => a.name.localeCompare(b.name) || (a.id || '').localeCompare(b.id || '')
  );

  return {
    ...baseMeta,
    generatedAt: new Date().toISOString(),
    components: sorted
  };
}

function runAgentStep(name, promptPath, payloadLines, context) {
  if (!context.agentRunner) {
    console.error(`❌ ${name} requires --agent-runner`);
    return { ok: false, code: 1 };
  }
  const runner = context.agentRunner;
  console.log(`• ${name} (agent via: ${runner})`);
  const payload = payloadLines.join('\n');
  return new Promise((resolve) => {
    const env = { ...process.env };
    const root = context.agentCwd || context.repoPath || process.cwd();
    env.AGENT_ROOT = root;
    env.AGENT_EXEC_CWD = root;
    const readPaths = joinUniquePaths([context.repoPath, context.agentCwd]);
    if (readPaths) env.AGENT_ALLOW_READ = readPaths;
    const writePaths = joinUniquePaths([context.agentCwd]);
    if (writePaths) env.AGENT_ALLOW_WRITE = writePaths;
    const child = spawn(runner, {
      shell: true,
      cwd: context.agentCwd || context.repoPath,
      env
    });
    child.stdin.write(payload);
    child.stdin.end();
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    child.on('close', (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, code });
    });
  });
}

function copyDir(src, dest, { force } = {}) {
  if (!fs.existsSync(src)) return;
  if (force && fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  ensureDir(dest);
  fs.cpSync(src, dest, { recursive: true });
}

async function main() {
  const configLoad = loadSuperconnectConfig();
  const sc = configLoad.config || {};
  const inputs = sc.inputs || {};
  const outputs = sc.outputs || {};
  const config = sc.config || {};
  const args = parseArgv(process.argv.slice(2));
  if (args.flags.has('help')) {
    usage();
    process.exit(0);
  }
  const figmaUrl = args.figmaUrl || inputs.figma_url;
  const figmaToken = args.figmaToken || process.env.FIGMA_ACCESS_TOKEN;
  if (!figmaUrl || !figmaToken) {
    usage();
    process.exit(1);
  }

  const repoPath = args.repoPath || (inputs.component_repo_path ? path.resolve(inputs.component_repo_path) : DEFAULTS.repoPath);
  const artifactsDir = args.artifactsDir || (outputs.output_dir ? path.resolve(outputs.output_dir) : DEFAULTS.artifactsDir);
  const agentProvider = config.agent_provider || DEFAULTS.agentProvider;
  const agentModel = config.model || DEFAULTS.agentModel;
  const agentRunner = buildAgentRunner(agentProvider, agentModel);
  const figmaDir = path.join(artifactsDir, 'figma-components');
  const figmaIndexPath = path.join(artifactsDir, 'figma-components-index.json');
  const codeconnectDir = path.join(artifactsDir, 'codeconnect');
  const mappingsPath = path.join(artifactsDir, 'mappings.json');
  const manifestPath = path.join(artifactsDir, 'codeconnect-manifest.json');

  console.log(chalk.bold('=== Superconnect v3 (barebones) ==='));
  console.log(`Figma URL/Key: ${figmaUrl}`);
  console.log(`Repo path:     ${repoPath}`);
  console.log(`Artifacts:     ${artifactsDir}`);
  console.log(`Agent:         provider=${agentProvider} model=${agentModel}`);
  console.log(`Token:         ${maskToken(figmaToken)}`);
  if (configLoad.exists) {
    console.log(`${chalk.dim('•')} Loaded config from ${configLoad.path}`);
  } else {
    console.log(`${chalk.dim('•')} No superconnect.toml found; using defaults`);
  }

  ensureDir(artifactsDir);
  const overridePath = ensureAgentsOverride(artifactsDir);
  console.log(`${chalk.dim('•')} Ensured AGENTS override at ${overridePath}`);

  if (!ensureTools(['ast-grep', 'rg', 'fd', 'jq'])) {
    process.exit(1);
  }

  // Step 1: Figma fetch
  if (!fs.existsSync(figmaDir) || args.flags.has('force')) {
    ensureDir(figmaDir);
    const fetchCmd = [
      'node scripts/fetchComponents.js',
      `"${figmaUrl}"`,
      `--output "${figmaDir}"`,
      figmaToken ? `--token "${figmaToken}"` : ''
    ]
      .filter(Boolean)
      .join(' ');
    const fetched = runCommand('Figma fetch', fetchCmd);
    if (!fetched.ok) process.exit(fetched.code || 1);
  } else {
    console.log(`• Figma fetch skipped (found ${figmaDir})`);
  }

  // Step 2: Figma index
  if (!fs.existsSync(figmaIndexPath) || args.flags.has('force')) {
    const index = buildFigmaIndex(figmaDir);
    fs.writeFileSync(figmaIndexPath, JSON.stringify(index, null, 2), 'utf8');
    console.log(`✅ Wrote Figma index → ${figmaIndexPath}`);
  } else {
    console.log(`• Figma index exists at ${figmaIndexPath} (use --force to rebuild)`);
  }

  // Step 3: Autopilot mapping + codegen under artifacts/autopilot
  const autopilotDir = path.join(artifactsDir, 'autopilot');
  const autopilotCodeconnectDir = path.join(autopilotDir, 'codeconnect');
  ensureDir(autopilotCodeconnectDir);
  const promptPath = path.resolve('prompts/autopilot-mapping-codegen.md');
  if (!fs.existsSync(promptPath)) {
    console.error(`❌ Missing prompt at ${promptPath}`);
    process.exit(1);
  }
  const promptTemplate = fs.readFileSync(promptPath, 'utf8');
  const prompt = promptTemplate
    .replace(/{FIGMA_DIR}/g, path.relative(artifactsDir, figmaDir) || '.')
    .replace(/{FIGMA_INDEX}/g, path.relative(artifactsDir, figmaIndexPath) || '.')
    .replace(/{REPO_PATH}/g, repoPath)
    .replace(/{OUTPUT_DIR}/g, path.relative(artifactsDir, autopilotDir) || '.');
  const payload = [prompt];
  const agentResult = await runAgentStep('Autopilot mapping+codegen', promptPath, payload, {
    agentRunner,
    repoPath,
    agentCwd: artifactsDir
  });
  if (!agentResult.ok) process.exit(agentResult.code || 1);

  const tmpManifest = path.join(autopilotDir, 'manifest.json');
  const tmpMappings = path.join(autopilotDir, 'mappings.json');
  const tmpCodeconnect = path.join(autopilotDir, 'codeconnect');
  if (!fs.existsSync(tmpManifest) || !fs.existsSync(tmpMappings) || !fs.existsSync(tmpCodeconnect)) {
    console.error('❌ Autopilot outputs missing (expected manifest.json, mappings.json, codeconnect/ in artifacts/autopilot).');
    process.exit(1);
  }

  // Step 4: Finalize into artifacts
  ensureDir(codeconnectDir);
  if (args.flags.has('force')) {
    if (fs.existsSync(codeconnectDir)) fs.rmSync(codeconnectDir, { recursive: true, force: true });
  }
  copyDir(tmpCodeconnect, codeconnectDir, { force: false });
  fs.copyFileSync(tmpMappings, mappingsPath);
  fs.copyFileSync(tmpManifest, manifestPath);
  console.log(`✅ Copied mappings → ${mappingsPath}`);
  console.log(`✅ Copied manifest → ${manifestPath}`);
  console.log(`✅ Copied codeconnect files → ${codeconnectDir}`);

  // Build figma.config.json
  const configPath = path.join(codeconnectDir, 'figma.config.json');
  const configCmd = [
    'node scripts/buildFigmaConfig.js',
    `--input "${figmaDir}"`,
    `--manifest "${manifestPath}"`,
    `--file-key "${figmaUrl}"`,
    '--output file',
    `--output-file "${configPath}"`
  ].join(' ');
  const configResult = runCommand('Figma config builder', configCmd);
  if (!configResult.ok) process.exit(configResult.code || 1);

  // Coverage report
  const runReport = path.join(artifactsDir, 'run-report.json');
  const coverageCmd = [
    'node scripts/generateCoverageReport.js',
    `--figma-index "${figmaIndexPath}"`,
    `--figma "${figmaDir}"`,
    `--mappings "${mappingsPath}"`,
    `--codeconnect "${codeconnectDir}"`,
    `--output "${runReport}"`
  ].join(' ');
  const coverageResult = runCommand('Coverage report', coverageCmd);
  if (!coverageResult.ok) process.exit(coverageResult.code || 1);

  const summaryPath = path.join(autopilotDir, 'run-summary.json');
  if (fs.existsSync(summaryPath)) {
    const destSummary = path.join(artifactsDir, 'run-summary.json');
    fs.copyFileSync(summaryPath, destSummary);
    console.log(`✅ Copied run summary → ${destSummary}`);
  } else {
    console.log('ℹ️ No run-summary.json emitted by agent (optional).');
  }

  console.log(chalk.green('\nPipeline complete.'));
  console.log(`  Artifacts: ${artifactsDir}`);
  console.log(`  Autopilot outputs: ${autopilotDir}`);
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
