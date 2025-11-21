#!/usr/bin/env node

/**
 * Figma Config Builder (JSON-only)
 *
 * Reads JSON files from a figma components directory (output of fetchComponents)
 * and produces figma.config.json. Manifest is JSON-only.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DEFAULT_MANIFEST = 'artifacts/codeconnect-manifest.json';

function parseFileKey(input) {
  if (!input) return '';
  const match = input.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]{10,})/);
  return match ? match[1] : input;
}

function loadEnvFile() {
  const envPath = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .forEach((line) => {
      const [key, ...rest] = line.split('=');
      if (key && rest.length && !process.env[key]) {
        process.env[key] = rest.join('=').trim();
      }
    });
}

async function promptOverwrite(filePath) {
  if (!fs.existsSync(filePath)) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(`⚠️  File ${filePath} exists. Overwrite? (y/N): `, (ans) => {
    rl.close();
    resolve(ans.trim().toLowerCase());
  }));
  return answer === 'y' || answer === 'yes';
}

function parseArgs() {
  loadEnvFile();
  const args = process.argv.slice(2);
  const config = {
    input: 'artifacts/figma-components',
    output: 'console',
    outputFile: 'figma.config.json',
    fileKey: '',
    parser: 'react',
    manifest: DEFAULT_MANIFEST,
    include: null,
    exclude: null,
    importPaths: null,
    paths: null,
    customSubstitutions: null
  };

  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    switch (flag) {
      case '--input':
        config.input = value;
        break;
      case '--output':
        config.output = value;
        break;
      case '--output-file':
        config.outputFile = value;
        break;
      case '--file-key':
        config.fileKey = parseFileKey(value);
        break;
      case '--parser':
        config.parser = value;
        break;
      case '--include':
        config.include = value ? value.split(',').map((s) => s.trim()) : [];
        break;
      case '--exclude':
        config.exclude = value ? value.split(',').map((s) => s.trim()) : [];
        break;
      case '--manifest':
        config.manifest = value;
        break;
      case '--import-paths':
        if (value) {
          config.importPaths = {};
          value.split(',').forEach((pair) => {
            const [k, v] = pair.split('=>').map((s) => s.trim());
            if (k && v) config.importPaths[k] = v;
          });
        }
        break;
      case '--paths':
        if (value) {
          config.paths = {};
          value.split(',').forEach((pair) => {
            const [k, v] = pair.split('=>').map((s) => s.trim());
            if (k && v) config.paths[k] = [v];
          });
        }
        break;
      case '--custom-subs':
        if (value) {
          config.customSubstitutions = {};
          value.split(',').forEach((pair) => {
            const [k, v] = pair.split('=>').map((s) => s.trim());
            if (k && v) {
              const full = v.startsWith('/') ? `https://www.figma.com/design${v}` : v;
              config.customSubstitutions[k] = full;
            }
          });
        }
        break;
    }
  }
  return config;
}

function loadManifest(manifestPath) {
  const resolved = path.resolve(manifestPath);
  if (!fs.existsSync(resolved)) return null;
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (err) {
    console.warn(`⚠️  Could not parse manifest at ${resolved}: ${err.message}`);
    return null;
  }
}

function loadComponents(dir) {
  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved)) throw new Error(`Input directory not found: ${resolved}`);
  const files = fs.readdirSync(resolved).filter((f) => f.endsWith('.json'));
  const components = [];
  for (const file of files) {
    if (file === 'index.json') continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(resolved, file), 'utf8'));
      if (data.componentSetId && data.componentName) {
        components.push({
          componentSetId: data.componentSetId,
          componentName: data.componentName,
          description: data.description || ''
        });
      }
    } catch (err) {
      console.warn(`⚠️  Skipping ${file}: ${err.message}`);
    }
  }
  return components;
}

function generateFigmaUrl(fileKey, nodeId) {
  return `https://www.figma.com/design/${fileKey}?node-id=${nodeId.replace(':', '-')}`;
}

function deriveImportPathsFromManifest(manifest) {
  if (!manifest || !manifest.componentRoot || !manifest.importTarget) return null;
  const normalizedRoot = manifest.componentRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const map = {};
  map[`${normalizedRoot}/**`] = manifest.importTarget;
  return map;
}

function derivePathsFromManifest(manifest) {
  if (!manifest || !manifest.tsconfigPaths) return null;
  return manifest.tsconfigPaths;
}

function generateConfig(components, fileKey, parser, options) {
  const substitutions = {};
  for (const component of components) {
    substitutions[component.componentName] = generateFigmaUrl(fileKey, component.componentSetId);
  }
  const config = {
    codeConnect: {
      interactiveSetupFigmaFileUrl: `https://www.figma.com/design/${fileKey}`,
      include: options.include ?? [],
      exclude: options.exclude ?? [],
      parser,
      importPaths: options.importPaths ?? {},
      paths: options.paths ?? {},
      documentUrlSubstitutions: options.customSubstitutions
        ? { ...substitutions, ...options.customSubstitutions }
        : substitutions
    }
  };
  return config;
}

async function outputConfig(config, outputFormat, components, outPathArg) {
  switch (outputFormat) {
    case 'console':
      console.log(JSON.stringify(config, null, 2));
      break;
    case 'json':
      console.log(JSON.stringify(config, null, 2));
      break;
    case 'file': {
      const outPath = path.resolve(outPathArg || 'figma.config.json');
      const ok = await promptOverwrite(outPath);
      if (!ok) {
        console.log('🚫 Aborted (file not overwritten)');
        return;
      }
      fs.writeFileSync(outPath, JSON.stringify(config, null, 2), 'utf8');
      console.log(`✅ Wrote figma.config.json (${components.length} components)`);
      break;
    }
    default:
      throw new Error(`Unknown output format: ${outputFormat}`);
  }
}

async function main() {
  const args = parseArgs();
  if (!args.fileKey) {
    console.error('Error: --file-key is required');
    process.exit(1);
  }
  const manifest = loadManifest(args.manifest);
  try {
    const components = loadComponents(args.input);
    if (!components.length) {
      console.log('⚠️  No components found in input directory.');
      return;
    }
    const config = generateConfig(components, args.fileKey, args.parser, {
      include: args.include ?? [],
      exclude: args.exclude ?? [],
      importPaths: args.importPaths || deriveImportPathsFromManifest(manifest) || {},
      paths: args.paths || derivePathsFromManifest(manifest) || {},
      customSubstitutions: args.customSubstitutions || null
    });
    await outputConfig(config, args.output, components, args.outputFile);
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

main();
