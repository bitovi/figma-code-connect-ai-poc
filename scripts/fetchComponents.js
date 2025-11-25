#!/usr/bin/env node

/**
 * Figma Component Variants Extractor (JSON-only)
 *
 * Downloads all variants from Figma components and saves them as JSON files.
 *
 * Usage:
 *   node scripts/fetchComponents.js [fileKey] [options]
 *
 * Options:
 *   --token       Figma API token (or set FIGMA_ACCESS_TOKEN env variable)
 *   --page        Specific page name to process (default: all pages)
 *   --component   Specific component name to process (default: all components)
 *   --output      Output directory (default: ./figma-variants)
 *   --file-key    Figma file key or full Figma URL
 */

const fs = require('fs');
const path = require('path');
const { fetch } = require('undici');
const { Command } = require('commander');
const chalk = require('chalk').default;

function parseFileKey(input) {
  if (!input) return '';
  const urlMatch = input.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]{10,})/);
  return urlMatch ? urlMatch[1] : input;
}

function loadEnvFile() {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const [key, ...rest] = trimmed.split('=');
      if (key && rest.length) {
        const value = rest.join('=').trim();
        if (!process.env[key]) process.env[key] = value;
      }
    });
  }
}

function parseArgs() {
  loadEnvFile();
  const program = new Command();
  program
    .argument('<fileKeyOrUrl>', 'Figma file key or URL')
    .option('--token <token>', 'Figma API token (or set FIGMA_ACCESS_TOKEN)')
    .option('--page <name>', 'Specific page name to process')
    .option('--component <name>', 'Specific component name to process')
    .option('--output <dir>', 'Output directory', './figma-variants');
  program.parse(process.argv);
  const opts = program.opts();
  return {
    fileKey: parseFileKey(program.args[0]),
    token: opts.token || process.env.FIGMA_ACCESS_TOKEN,
    page: opts.page || null,
    component: opts.component || null,
    output: opts.output
  };
}

async function figmaRequest(pathname, token) {
  const res = await fetch(`https://api.figma.com${pathname}`, {
    method: 'GET',
    headers: { 'X-Figma-Token': token }
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Figma API error: ${res.status} - ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Figma API returned malformed JSON: ${err.message}`);
  }
}

function findComponentSets(node, acc = []) {
  if (node.type === 'COMPONENT_SET') acc.push(node);
  if (node.children) node.children.forEach((child) => findComponentSets(child, acc));
  return acc;
}

function extractVariants(componentSet) {
  const variants = [];
  const propertyOptions = {};

  if (componentSet.children) {
    for (const variant of componentSet.children) {
      if (variant.type !== 'COMPONENT') continue;
      const variantData = {
        variantId: variant.id,
        name: variant.name,
        properties: {},
        description: variant.description || '',
        key: variant.key || ''
      };
      if (variant.name) {
        const propertyPairs = variant.name.split(',').map((p) => p.trim());
        for (const pair of propertyPairs) {
          const [prop, value] = pair.split('=').map((s) => s.trim());
          if (prop && value) {
            variantData.properties[prop] = value;
            if (!propertyOptions[prop]) propertyOptions[prop] = new Set();
            propertyOptions[prop].add(value);
          }
        }
      }
      variants.push(variantData);
    }
  }

  const propertyOptionsArray = {};
  Object.entries(propertyOptions).forEach(([prop, values]) => {
    propertyOptionsArray[prop] = Array.from(values).sort();
  });

  return {
    componentSetId: componentSet.id,
    componentName: componentSet.name,
    description: componentSet.description || '',
    variantProperties: propertyOptionsArray,
    variants,
    totalVariants: variants.length
  };
}

function saveJson(filePath, data, options = {}) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  const relativePath = path.relative(process.cwd(), filePath) || filePath;
  const { logMessage } = options;
  if (logMessage !== false) {
    const message = typeof logMessage === 'string' ? logMessage : `      Saved: ${relativePath}`;
    console.log(message);
  }
}

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').toLowerCase();
}

async function main() {
  const config = parseArgs();
  if (!config.fileKey) {
    console.error(chalk.red('Error: Figma file key is required'));
    process.exit(1);
  }
  if (!config.token) {
    console.error(chalk.red('Error: Figma API token is required (set FIGMA_ACCESS_TOKEN or use --token)'));
    process.exit(1);
  }

  console.log(chalk.bold('🎨 Fetching Figma file...'));
  console.log(`File Key: ${chalk.cyan(config.fileKey)}`);

  try {
    const fileData = await figmaRequest(`/v1/files/${config.fileKey}`, config.token);
    console.log(`${chalk.green('✓')} File loaded: ${fileData.name}`);
    console.log(`  Version: ${fileData.version}`);
    console.log(`  Last Modified: ${fileData.lastModified}`);

    const pages = fileData.document.children.filter((page) => !config.page || page.name === config.page);
    console.log('\nProcessing pages in Figma document:');
    pages.forEach((page) => console.log(`  - ${chalk.cyan(page.name)}`));

    const allComponentSets = pages.flatMap((page) => findComponentSets(page));

    console.log(`\n${chalk.green('✓')} Found ${allComponentSets.length} component sets`);

    let processedCount = 0;
    for (const componentSet of allComponentSets) {
      if (config.component && componentSet.name !== config.component) continue;
      const variantData = extractVariants(componentSet);
      const properties = Object.keys(variantData.variantProperties).join(', ');

      const filename = sanitizeFilename(componentSet.name);
      const jsonPath = path.join(config.output, `${filename}.json`);
      saveJson(jsonPath, variantData, { logMessage: false });
      const relativePath = path.relative(process.cwd(), jsonPath) || jsonPath;
      console.log(
        `${chalk.cyan(componentSet.name)} (${variantData.totalVariants} variants) [properties: ${properties}] => ${relativePath}`
      );
      processedCount++;
    }

    if (processedCount > 0) {
      const indexData = {
        fileName: fileData.name,
        fileKey: config.fileKey,
        version: fileData.version,
        lastModified: fileData.lastModified,
        exportDate: new Date().toISOString(),
        components: allComponentSets
          .filter((cs) => !config.component || cs.name === config.component)
          .map((cs) => ({
            name: cs.name,
            id: cs.id,
            variantCount: cs.children ? cs.children.length : 0
          }))
      };
      saveJson(path.join(config.output, 'index.json'), indexData);
    }

    console.log(`\n${chalk.green('✅')} Complete! Processed ${processedCount} component(s)`);
    console.log(`📁 Output directory: ${config.output}`);
  } catch (error) {
    console.error(`\n${chalk.red('❌ Error:')} ${error.message}`);
    process.exit(1);
  }
}

main();
