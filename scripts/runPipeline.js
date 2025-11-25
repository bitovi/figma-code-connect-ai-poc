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
const chalk = require('chalk').default;

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

function resolveTsconfigPath(repoPath) {
  const candidates = ['tsconfig.base.json', 'tsconfig.json', 'tsconfig.build.json'];
  return (
    candidates
      .map((name) => path.join(repoPath, name))
      .find((candidate) => fs.existsSync(candidate)) || null
  );
}

function writeManifest(manifestPath, manifestConfig) {
  ensureDir(path.dirname(manifestPath));
  fs.writeFileSync(manifestPath, JSON.stringify(manifestConfig, null, 2), 'utf8');
}

function readManifest(manifestPath) {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  return JSON.parse(raw);
}

function normalizeTsconfigPath(tsconfigPath, repoPath) {
  if (!tsconfigPath) return null;
  return path.isAbsolute(tsconfigPath) ? tsconfigPath : path.join(repoPath, tsconfigPath);
}

function ensureManifestTsconfig(manifest, repoPath) {
  const normalized = normalizeTsconfigPath(manifest.tsconfigPath, repoPath);
  if (normalized && fs.existsSync(normalized)) {
    return { manifest, resolvedTsconfig: normalized, updated: false };
  }
  const fallback = resolveTsconfigPath(repoPath);
  if (!fallback) {
    const expected = normalized || '(unset)';
    return {
      error: `tsconfig not found at ${expected}. Add manifest.tsconfigPath or rerun with --force to regenerate.`
    };
  }
  return { manifest: { ...manifest, tsconfigPath: fallback }, resolvedTsconfig: fallback, updated: true };
}

function extractJsonBlock(text, label) {
  const regex = new RegExp(`---BEGIN ${label}---\\s*({[\\s\\S]*?})\\s*---END ${label}---`, 'g');
  const matches = [...text.matchAll(regex)];
  if (!matches.length) return { error: `${label} block not found` };
  const last = matches[matches.length - 1][1];
  try {
    return { value: JSON.parse(last) };
  } catch (err) {
    return { error: `${label} block parse error: ${err.message}` };
  }
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
        version: parsed.version || null
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
          variantCount: data.totalVariants || (Array.isArray(data.variants) ? data.variants.length : null)
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
        null
    });
  });

  const sorted = normalized.sort(
    (a, b) => a.name.localeCompare(b.name) || (a.id || '').localeCompare(b.id || '')
  );

  return {
    fileKey: baseMeta.fileKey || null,
    fileName: baseMeta.fileName || null,
    version: baseMeta.version || null,
    generatedAt: new Date().toISOString(),
    components: sorted
  };
}

function loadFigmaComponentList(figmaIndexPath) {
  if (!fs.existsSync(figmaIndexPath)) {
    return { error: `Figma component index not found at ${figmaIndexPath}` };
  }
  try {
    const data = readJsonSafe(figmaIndexPath);
    const components = Array.isArray(data.components) ? data.components : [];
    const list = components
      .map((item) => ({
        figmaName: item.name || item.componentName || null,
        figmaId: item.id || item.componentSetId || null
      }))
      .filter((item) => item.figmaName);
    return { components: list, meta: { fileKey: data.fileKey || null, fileName: data.fileName || null } };
  } catch (err) {
    return { error: `Unable to read figma index at ${figmaIndexPath}: ${err.message}` };
  }
}

function validateComponentScope(scope) {
  const ensureArray = (value) => (Array.isArray(value) ? value : []);
  if (!scope || typeof scope !== 'object') {
    return { error: 'component-scope is missing or invalid' };
  }
  const fromFigma = ensureArray(scope.fromFigma)
    .map((entry) => ({
      figmaName: (entry.figmaName || '').trim(),
      figmaId: entry.figmaId || null,
      reactCandidates: ensureArray(entry.reactCandidates),
      parents: ensureArray(entry.parents),
      children: ensureArray(entry.children),
      notes: entry.notes || undefined
    }))
    .filter((entry) => entry.figmaName);
  const namesFromEntries = new Set();
  const add = (name) => {
    if (typeof name !== 'string') return;
    const trimmed = name.trim();
    if (trimmed) namesFromEntries.add(trimmed);
  };
  fromFigma.forEach((entry) => {
    entry.reactCandidates.forEach(add);
    entry.parents.forEach(add);
    entry.children.forEach(add);
  });

  let reactComponents = Array.from(namesFromEntries).sort();
  if (reactComponents.length === 0) {
    const fallback = ensureArray(scope.reactComponents)
      .map((name) => (typeof name === 'string' ? name.trim() : ''))
      .filter(Boolean);
    if (fallback.length === 0) {
      return {
        error: 'component-scope has no reactComponents; ensure the agent includes candidates/parents/children'
      };
    }
    reactComponents = Array.from(new Set(fallback)).sort();
  }

  const normalizedScope = {
    ...scope,
    fromFigma,
    reactComponents
  };
  const updated = !scope.reactComponents || scope.reactComponents.length !== reactComponents.length;
  return { scope: normalizedScope, updated };
}

function findFigmaComponentJson(figmaDir, name) {
  const slug = sanitizeComponentSlug(name);
  const direct = path.join(figmaDir, `${slug}.json`);
  if (fs.existsSync(direct)) return direct;
  return null;
}

function findReactComponentJson(reactDir, name) {
  const base = sanitizeComponentSlug(name).replace(/_/g, '');
  const candidates = [
    path.join(reactDir, `${base}.json`),
    path.join(reactDir, `${sanitizeComponentSlug(name)}.json`)
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function deriveImportPath(manifest, reactEntry, codeconnectDir) {
  if (manifest.importStyle === 'package' && manifest.importTarget) {
    return manifest.importTarget;
  }
  const relPath = reactEntry?.relativePath || reactEntry?.filePath;
  if (!relPath) return null;
  const abs = path.resolve(relPath);
  const withoutExt = abs.replace(/\.[^.]+$/, '');
  const relative = path.relative(codeconnectDir, withoutExt).split(path.sep).join('/');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function buildCodegenInput(config) {
  const manifest = readJsonSafe(config.manifest);
  const mappings = readJsonSafe(config.mappings);
  if (!Array.isArray(mappings)) {
    throw new Error('Mappings JSON must be an array.');
  }

  const entries = mappings.map((mapping) => {
    const figmaPath = findFigmaComponentJson(config.figmaDir, mapping.figmaName);
    const reactPath = findReactComponentJson(config.reactDir, mapping.reactName);
    const figma = figmaPath && fs.existsSync(figmaPath) ? readJsonSafe(figmaPath) : null;
    const react = reactPath && fs.existsSync(reactPath) ? readJsonSafe(reactPath) : null;
    const importPath = deriveImportPath(manifest, react, config.codeconnectDir);
    return {
      figmaName: mapping.figmaName,
      reactName: mapping.reactName,
      source: mapping.source || null,
      importPath: importPath || null,
      figmaPath: figmaPath || null,
      reactPath: reactPath || null,
      figma: figma
        ? {
            variantProperties: figma.variantProperties || {},
            componentSetId: figma.componentSetId || figma.id || null,
            totalVariants: figma.totalVariants || (figma.variants ? figma.variants.length : null)
          }
        : null,
      react: react
        ? {
            props: react.props || [],
            variantProperties: react.variantProperties || {},
            recipeVariants: react.recipeVariants || [],
            potentialFigmaMapping: react.potentialFigmaMapping || {},
            relativePath: react.relativePath || react.filePath || null
          }
        : null
    };
  });

  return { manifest, entries, generatedAt: new Date().toISOString() };
}

function validateManifestPaths(manifest, repoPath) {
  let updated = false;
  const normalize = (value) => {
    if (!value) return null;
    return path.isAbsolute(value) ? value : path.join(repoPath, value);
  };

  const normalizedRoot = normalize(manifest.componentRoot);
  if (!normalizedRoot || !fs.existsSync(normalizedRoot)) {
    return { error: `componentRoot not found at ${normalizedRoot || '(unset)'}. Rerun orientation with --force.` };
  }

  let normalizedRecipes = null;
  if (manifest.recipesPath) {
    normalizedRecipes = normalize(manifest.recipesPath);
    if (!normalizedRecipes || !fs.existsSync(normalizedRecipes)) {
      normalizedRecipes = null;
      updated = true;
    }
  }

  if (!manifest.importStyle || !['package', 'relative'].includes(manifest.importStyle)) {
    return { error: `importStyle missing/invalid in manifest (got ${manifest.importStyle || 'unset'}).` };
  }
  if (manifest.importStyle === 'package' && !manifest.importTarget) {
    return { error: 'importTarget missing for package importStyle.' };
  }

  const tsconfigCheck = ensureManifestTsconfig({ ...manifest }, repoPath);
  if (tsconfigCheck.error) return { error: tsconfigCheck.error };

  const normalizedManifest = {
    ...tsconfigCheck.manifest,
    componentRoot: normalizedRoot,
    recipesPath: normalizedRecipes
  };
  if (normalizedRoot !== manifest.componentRoot) updated = true;
  if (manifest.recipesPath !== normalizedRecipes) updated = true;
  updated = updated || tsconfigCheck.updated;

  return { manifest: normalizedManifest, updated };
}

function runCommand(label, command, options, context) {
  const { dryRun } = context;
  console.log(`${chalk.dim('•')} ${chalk.cyan(label)}`);
  if (dryRun) {
    console.log(`  ${chalk.yellow('(dry-run)')} ${command}`);
    return { ok: true, skipped: true };
  }
  const spawnOptions = {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, FIGMA_ACCESS_TOKEN: context.figmaToken },
    ...(options || {})
  };
  const result = spawnSync(command, {
    ...spawnOptions
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
    console.log(`${chalk.dim('•')} ${chalk.cyan(`${name} (agent)`)}`);
    console.log(`  ${chalk.yellow('(dry-run)')} prompt: ${promptPath}`);
    return { ok: true, skipped: true };
  }
  const runner = options.runner || context.agentRunner;
  if (!runner) {
    console.log(`⚠️  ${name} requires an agent. Run manually with ${promptPath}:\n${payloadLines.join('\n')}`);
    return { ok: false, manual: true };
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
      if (code === 0) {
        resolve({ ok: true, output: captured });
      } else {
        resolve({ ok: false, code, output: captured });
      }
    });
  });
}

function parseFileKey(figmaUrlOrKey) {
  if (!figmaUrlOrKey) return '';
  const match = figmaUrlOrKey.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/);
  return match ? match[1] : figmaUrlOrKey;
}

async function ensureManifestStep(config, context) {
  const manifestExists = fs.existsSync(config.manifest);
  const scopeExists = fs.existsSync(config.componentScope);

  if (manifestExists && scopeExists && !context.force) {
    try {
      const manifest = readManifest(config.manifest);
      const manifestValidation = validateManifestPaths(manifest, config.repoPath);
      if (manifestValidation.error) {
        console.error(`❌ ${manifestValidation.error}`);
        return { ok: false, code: 1 };
      }
      const scopeValidation = validateComponentScope(readJsonSafe(config.componentScope));
      if (scopeValidation.error) {
        console.error(`❌ ${scopeValidation.error}`);
        return { ok: false, code: 1 };
      }
      if (manifestValidation.updated) {
        writeManifest(config.manifest, manifestValidation.manifest);
        console.log(`🔧 Updated manifest paths → ${config.manifest}`);
      }
      if (scopeValidation.updated) {
        ensureDir(path.dirname(config.componentScope));
        fs.writeFileSync(config.componentScope, JSON.stringify(scopeValidation.scope, null, 2), 'utf8');
        console.log(`🔧 Normalized component scope → ${config.componentScope}`);
      }
      console.log(`• Manifest + scope exist (skipped, use --force to regenerate): ${config.manifest}, ${config.componentScope}`);
      return { ok: true, skipped: true };
    } catch (err) {
      console.error(`❌ Unable to read manifest/scope: ${err.message}`);
      return { ok: false, code: 1 };
    }
  }

  if (!fs.existsSync(config.figmaIndex)) {
    console.error(`❌ Missing Figma component index at ${config.figmaIndex} (fetch + index first).`);
    return { ok: false, code: 1 };
  }
  const figmaList = loadFigmaComponentList(config.figmaIndex);
  if (figmaList.error) {
    console.error(`❌ ${figmaList.error}`);
    return { ok: false, code: 1 };
  }

  const promptPath = path.resolve('prompts/orientation.md');
  if (!fs.existsSync(promptPath)) {
    console.error(`❌ Missing orientation prompt at ${promptPath}`);
    return { ok: false, code: 1 };
  }
  if (!context.agentRunner) {
    console.error('❌ Orientation requires an agent runner; provide --agent-runner or config.agent_run_command.');
    return { ok: false, code: 1 };
  }
  const promptContent = fs.readFileSync(promptPath, 'utf8');
  const figmaJson = JSON.stringify(figmaList.components, null, 2);
  const payload = [
    promptContent,
    '',
    'Context:',
    '- Repository root: current working directory',
    `- Figma components (${figmaList.components.length}) list:`,
    figmaJson,
    '- Emit the three JSON blocks with absolute paths using the required delimiters.'
  ];
  const result = await runAgentStep('Orientation', promptPath, payload, context, {
    cwd: config.repoPath,
    captureOutput: true
  });
  if (!result.ok) {
    console.error(`❌ Orientation agent failed${result.code ? ` (code ${result.code})` : ''}.`);
    return { ok: false, code: result.code || 1 };
  }
  const manifestBlock = extractJsonBlock(result.output || '', 'MANIFEST');
  const scopeBlock = extractJsonBlock(result.output || '', 'COMPONENT-SCOPE');
  const reportBlock = extractJsonBlock(result.output || '', 'ORIENTATION-REPORT');
  if (manifestBlock.error) {
    console.error(`❌ ${manifestBlock.error}`);
    return { ok: false, code: 1 };
  }
  if (scopeBlock.error) {
    console.error(`❌ ${scopeBlock.error}`);
    return { ok: false, code: 1 };
  }
  if (reportBlock.error) {
    console.error(`❌ ${reportBlock.error}`);
    return { ok: false, code: 1 };
  }
  const manifestValidation = validateManifestPaths(manifestBlock.value, config.repoPath);
  if (manifestValidation.error) {
    console.error(`❌ ${manifestValidation.error}`);
    console.error('ℹ️  Orientation report saved for context.');
    ensureDir(path.dirname(config.orientationReport));
    fs.writeFileSync(config.orientationReport, JSON.stringify(reportBlock.value, null, 2), 'utf8');
    return { ok: false, code: 1 };
  }
  const scopeValidation = validateComponentScope(scopeBlock.value);
  if (scopeValidation.error) {
    console.error(`❌ ${scopeValidation.error}`);
    return { ok: false, code: 1 };
  }
  writeManifest(config.manifest, manifestValidation.manifest);
  ensureDir(path.dirname(config.orientationReport));
  fs.writeFileSync(config.orientationReport, JSON.stringify(reportBlock.value, null, 2), 'utf8');
  ensureDir(path.dirname(config.componentScope));
  fs.writeFileSync(config.componentScope, JSON.stringify(scopeValidation.scope, null, 2), 'utf8');
  console.log(`✅ Wrote manifest → ${config.manifest}`);
  console.log(`🧭 Wrote component scope → ${config.componentScope}`);
  console.log(`📝 Wrote orientation report → ${config.orientationReport}`);
  return { ok: true };
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

function figmaIndexStep(config, context) {
  ensureDir(path.dirname(config.figmaIndex));
  if (fs.existsSync(config.figmaIndex) && !context.force) {
    console.log(`• Figma index exists: ${config.figmaIndex} (skipped, use --force to rebuild)`);
    return { ok: true, skipped: true };
  }
  if (!dirHasFiles(config.figmaDir)) {
    console.error(`❌ Figma components directory is empty or missing at ${config.figmaDir} (run fetch first)`);
    return { ok: false, code: 1 };
  }

  const index = buildFigmaIndex(config.figmaDir);
  if (!index.components.length) {
    console.error(`❌ Figma index is empty (no components found under ${config.figmaDir}).`);
    return { ok: false, code: 1 };
  }
  fs.writeFileSync(config.figmaIndex, JSON.stringify(index, null, 2), 'utf8');
  console.log(`✅ Wrote Figma component index → ${config.figmaIndex}`);
  return { ok: true };
}

function reactExtractStep(config, context) {
  ensureDir(config.reactDir);
  if (dirHasFiles(config.reactDir) && !context.force) {
    console.log(`• React props extraction skipped; artifacts present at ${config.reactDir} (use --force to re-extract)`);
    return { ok: true, skipped: true };
  }
  let manifest;
  try {
    manifest = readManifest(config.manifest);
  } catch (err) {
    console.error(`❌ Unable to read manifest at ${config.manifest}: ${err.message}`);
    return { ok: false, code: 1 };
  }
  if (!manifest.tsconfigPath) {
    console.error(
      '❌ Manifest missing tsconfigPath; rerun orientation with the updated prompt or add tsconfigPath manually.',
    );
    return { ok: false, code: 1 };
  }
  const tsconfigResolved = path.isAbsolute(manifest.tsconfigPath)
    ? manifest.tsconfigPath
    : path.join(config.repoPath, manifest.tsconfigPath);
  if (!fs.existsSync(tsconfigResolved)) {
    console.error(`❌ tsconfig not found at ${tsconfigResolved} (from manifest.tsconfigPath).`);
    return { ok: false, code: 1 };
  }
  const scopeArg =
    config.componentScope && fs.existsSync(config.componentScope)
      ? `--component-scope "${config.componentScope}"`
      : null;
  const cmd = [
    'node scripts/code-component-scanner.js',
    `--manifest "${config.manifest}"`,
    `--output "${config.reactDir}"`,
    `--tsconfig "${tsconfigResolved}"`,
    scopeArg,
    '--overwrite',
    '--verbose'
  ]
    .filter(Boolean)
    .join(' ');
  return runCommand('React props extraction', cmd, {}, context);
}

async function matchingStep(config, context) {
  if (fs.existsSync(config.matchCandidates)) {
    if (!context.force) {
      console.log(`• Matching skipped; match-candidates exist at ${config.matchCandidates} (use --force to rerun)`);
      return { ok: true, skipped: true };
    }
    console.log('• Regenerating match candidates (force)');
  }
  if (!dirHasFiles(config.figmaDir)) {
    console.error(`❌ Missing Figma JSONs at ${config.figmaDir} (run fetch + index first).`);
    return { ok: false, code: 1 };
  }
  if (!dirHasFiles(config.reactDir)) {
    console.error(`❌ Missing React JSONs at ${config.reactDir} (run scoped extraction first).`);
    return { ok: false, code: 1 };
  }
  if (!fs.existsSync(config.componentScope)) {
    console.error(`❌ Missing component scope at ${config.componentScope} (rerun orientation).`);
    return { ok: false, code: 1 };
  }
  const promptPath = path.resolve('prompts/matching.md');
  if (!fs.existsSync(promptPath)) {
    console.error(`❌ Missing matching prompt at ${promptPath}`);
    return { ok: false, code: 1 };
  }
  const promptContent = fs.readFileSync(promptPath, 'utf8');
  const payload = [
    promptContent,
    '',
    'Context:',
    `- Figma JSONs: ${config.figmaDir}`,
    `- React JSONs: ${config.reactDir}`,
    `- Manifest (context): ${config.manifest}`,
    `- Component scope: ${config.componentScope}`,
    `- Produce match-candidates.jsonl in ${path.dirname(config.matchCandidates)}.`
  ];
  const result = await runAgentStep('Matching', promptPath, payload, context, {
    cwd: process.cwd(),
    captureOutput: true
  });
  if (!result.ok) return result;

  if (!fs.existsSync(config.matchCandidates)) {
    const lines = (result.output || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith('{') && l.endsWith('}'));
    if (lines.length > 0) {
      ensureDir(path.dirname(config.matchCandidates));
      fs.writeFileSync(config.matchCandidates, lines.join('\n'), 'utf8');
      console.log(`🔧 Captured match candidates from agent output → ${config.matchCandidates}`);
    }
  }

  if (!fs.existsSync(config.matchCandidates)) {
    console.error(`❌ Matching output missing: expected ${config.matchCandidates}. Check ${context.agentLogDir || 'agent log'} for JSONL and copy it manually.`);
    return { ok: false, code: 1 };
  }

  return { ok: true };
}

function reviewStep(config, context) {
  if (fs.existsSync(config.mappings) && !context.force) {
    console.log(`${chalk.dim('•')} ${chalk.cyan('Review skipped; mappings exist')} at ${config.mappings} (use --force to re-review)`);
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
    console.log(`${chalk.dim('•')} ${chalk.cyan('Codegen skipped; outputs exist')} at ${config.codeconnectDir} (use --force to regenerate)`);
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
  const validation = runCommand('Codegen preflight', validateCmd, {}, context);
  if (!validation.ok || context.dryRun) return validation;

  let codegenInput = null;
  try {
    codegenInput = buildCodegenInput(config);
    ensureDir(path.dirname(config.codegenInput));
    fs.writeFileSync(config.codegenInput, JSON.stringify(codegenInput, null, 2), 'utf8');
    console.log(`🧩 Prepared codegen input → ${config.codegenInput}`);
  } catch (err) {
    console.error(`❌ Failed to prepare codegen input: ${err.message}`);
    return { ok: false, code: 1 };
  }

  return runAgentStep(
    'Codegen',
    'prompts/codegen.md',
    [
      'Use prompts/codegen.md.',
      `Manifest: ${config.manifest}`,
      `Mappings: ${config.mappings}`,
      `React JSONs: ${config.reactDir}`,
      `Figma JSONs: ${config.figmaDir}`,
      `Scoped codegen input (precomputed per-mapping data): ${config.codegenInput}`,
      `Output dir: ${config.codeconnectDir}`,
      'Do not read outside the current working directory.'
    ],
    context,
    { runner: context.agentRunner, cwd: path.resolve(context.artifactsDir || '.') }
  );
}

function coverageStep(config, context) {
  const cmd = [
    'node scripts/generateCoverageReport.js',
    `--figma-index "${config.figmaIndex}"`,
    `--figma "${config.figmaDir}"`,
    `--mappings "${config.mappings}"`,
    `--codeconnect "${config.codeconnectDir}"`,
    `--output "${config.runReport}"`
  ].join(' ');
  const result = runCommand('Coverage report', cmd, {}, context);
  if (!result.ok) return result;
  if (config.failOnCoverageGaps && fs.existsSync(config.runReport)) {
    try {
      const report = readJsonSafe(config.runReport);
      const gaps =
        (report.summary?.unmappedFigma || 0) +
        (report.summary?.codegenFilesMissing || 0) +
        (report.summary?.mappingsWithMissingVariantKeys || 0);
      if (gaps > 0) {
        console.error('❌ Coverage gaps detected. Failing run (set fail_on_coverage=false to skip).');
        return { ok: false, code: 1 };
      }
    } catch (err) {
      console.error(`⚠️  Unable to parse coverage report: ${err.message}`);
    }
  }
  return result;
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
    { name: 'Figma fetch', run: () => figmaFetchStep(config, context) },
    { name: 'Figma index', run: () => figmaIndexStep(config, context) },
    { name: 'Orientation', run: () => ensureManifestStep(config, context) },
    { name: 'React props', run: () => reactExtractStep(config, context) },
    { name: 'Matching', run: () => matchingStep(config, context) },
    { name: 'Review', run: () => reviewStep(config, context) },
    { name: 'Codegen', run: () => codegenStep(config, context) },
    { name: 'Coverage', run: () => coverageStep(config, context) },
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
  console.log(chalk.bold('=== Figma Code Connect One-Shot ==='));
  console.log(`Figma URL/Key: ${config.figmaUrl}`);
  console.log(`Repo path:     ${config.repoPath}`);
  console.log(`Artifacts:     ${config.artifactsDir}`);
  console.log(`Codegen out:   ${config.codeconnectDir}`);
  console.log(`Figma index:   ${config.figmaIndex}`);
  console.log(`Scope file:    ${config.componentScope}`);
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
    orientationReport: path.join(artifactsDir, 'orientation-report.json'),
    figmaIndex: path.join(artifactsDir, 'figma-components-index.json'),
    componentScope: path.join(artifactsDir, 'component-scope.json'),
    figmaDir: path.join(artifactsDir, 'figma-components'),
    reactDir: path.join(artifactsDir, 'react-components'),
    matchCandidates: path.join(artifactsDir, 'match-candidates.jsonl'),
    mappings: path.join(artifactsDir, 'mappings.json'),
    codeconnectDir: path.join(artifactsDir, 'codeconnect'),
    codegenInput: path.join(artifactsDir, 'codegen-input.json'),
    runReport: path.join(artifactsDir, 'run-report.json'),
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
    },
    failOnCoverageGaps: cfg.fail_on_coverage === 'true' || cfg.fail_on_coverage === true
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
  if (done.length) console.log(`  ${chalk.green('Ran')}:     ${done.join(', ')}`);
  if (skipped.length) console.log(`  ${chalk.yellow('Skipped')}: ${skipped.join(', ')}`);
  console.log(`  Outputs: check ${config.codeconnectDir} (figma.config.json, .figma.tsx files)`);
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
