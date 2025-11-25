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
const crypto = require('crypto');
const { fetch } = require('undici');
const { Command } = require('commander');
const chalk = require('chalk').default;

const SCHEMA_VERSION = 'figma-component@1';
const INDEX_SCHEMA_VERSION = 'figma-component-index@1';

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

function findComponentSets(node, acc = [], breadcrumbs = []) {
  if (!node) return acc;
  const nextTrail = node.name ? [...breadcrumbs, node.name] : breadcrumbs;
  if (node.type === 'COMPONENT_SET') {
    acc.push({ node, breadcrumbs: nextTrail });
  }
  if (node.children) {
    node.children.forEach((child) => findComponentSets(child, acc, nextTrail));
  }
  return acc;
}

const toCamelCase = (value) => {
  const safe = (value || '').trim().toLowerCase();
  if (!safe) return '';
  const parts = safe.split(/[\s_-]+/).filter(Boolean);
  return parts
    .map((part, idx) => (idx === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
};

const normalizeVariantKey = (raw) => toCamelCase(raw);

const normalizeVariantValue = (raw) => (raw || '').trim().replace(/\s+/g, ' ');

const toEnumValue = (raw) => normalizeVariantValue(raw).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const addOption = (options, normalizedKey, rawKey, normalizedValue, enumValue) => {
  const next = options[normalizedKey] || { rawKeys: new Set(), values: new Set(), enums: new Set() };
  next.rawKeys.add(rawKey);
  next.values.add(normalizedValue);
  next.enums.add(enumValue);
  options[normalizedKey] = next;
  return options;
};

const parseVariantProperties = (variantName, options) => {
  const properties = {};
  const rawProperties = {};
  if (!variantName) return { properties, rawProperties };
  const propertyPairs = variantName.split(',').map((p) => p.trim());
  for (const pair of propertyPairs) {
    const [rawKey, rawValue] = pair.split('=').map((s) => s.trim());
    if (!rawKey || !rawValue) continue;
    const normalizedKey = normalizeVariantKey(rawKey);
    const normalizedValue = normalizeVariantValue(rawValue);
    const enumValue = toEnumValue(rawValue);
    properties[normalizedKey] = normalizedValue;
    rawProperties[rawKey] = rawValue;
    addOption(options, normalizedKey, rawKey, normalizedValue, enumValue);
  }
  return { properties, rawProperties };
};

const toSortedArray = (input) => Array.from(input || []).sort((a, b) => a.localeCompare(b));

const buildAliases = (name) => {
  const canonical = (name || '').trim();
  const slashParts = canonical.split('/').map((p) => p.trim()).filter(Boolean);
  const base = slashParts[slashParts.length - 1] || canonical;
  const withoutParens = base.replace(/\s*\(.*?\)\s*$/, '').trim();
  const trimmedSuffix = withoutParens.replace(/\b(component|components|default|base|new)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  const alias = trimmedSuffix || withoutParens || base || canonical;
  const candidates = Array.from(new Set([canonical, base, withoutParens, alias])).filter(Boolean);
  return { canonical, alias, candidates };
};

const buildBreadcrumbs = (breadcrumbs = []) => {
  const parents = breadcrumbs.slice(0, -1);
  return {
    page: parents[0] || null,
    trail: parents,
    fullPath: breadcrumbs,
    path: parents.join(' / ')
  };
};

const computeChecksum = (payload) => {
  const stable = JSON.stringify(payload);
  return crypto.createHash('sha256').update(stable).digest('hex');
};

function extractVariants(componentSet, breadcrumbs) {
  const variants = [];
  const propertyOptions = {};

  if (componentSet.children) {
    for (const variant of componentSet.children) {
      if (variant.type !== 'COMPONENT') continue;
      const { properties, rawProperties } = parseVariantProperties(variant.name, propertyOptions);
      variants.push({
        variantId: variant.id,
        name: variant.name,
        properties,
        rawProperties,
        description: variant.description || '',
        key: variant.key || ''
      });
    }
  }

  const variantValueEnums = {};
  const variantProperties = {};
  Object.keys(propertyOptions)
    .sort()
    .forEach((prop) => {
      const meta = propertyOptions[prop];
      const values = toSortedArray(meta.values);
      variantValueEnums[prop] = {
        normalizedKey: prop,
        rawKeys: toSortedArray(meta.rawKeys),
        values,
        enums: toSortedArray(meta.enums)
      };
      variantProperties[prop] = values;
    });

  const basePayload = {
    componentSetId: componentSet.id,
    componentName: componentSet.name,
    description: componentSet.description || '',
    variantProperties,
    variantValueEnums,
    variants,
    totalVariants: variants.length,
    nameAliases: buildAliases(componentSet.name),
    breadcrumbs: buildBreadcrumbs(breadcrumbs)
  };

  const checksum = computeChecksum(basePayload);

  return {
    schemaVersion: SCHEMA_VERSION,
    checksum: {
      algorithm: 'sha256',
      value: checksum
    },
    ...basePayload
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
    const componentsMeta = [];
    for (const { node: componentSet, breadcrumbs } of allComponentSets) {
      if (config.component && componentSet.name !== config.component) continue;
      const variantData = extractVariants(componentSet, breadcrumbs);
      const properties = Object.keys(variantData.variantProperties).join(', ');

      const filename = sanitizeFilename(componentSet.name);
      const jsonPath = path.join(config.output, `${filename}.json`);
      saveJson(jsonPath, variantData, { logMessage: false });
      const relativePath = path.relative(process.cwd(), jsonPath) || jsonPath;
      console.log(
        `${chalk.cyan(componentSet.name)} (${variantData.totalVariants} variants) [properties: ${properties}] => ${relativePath}`
      );
      componentsMeta.push({
        name: variantData.componentName,
        id: variantData.componentSetId,
        variantCount: variantData.totalVariants,
        checksum: variantData.checksum?.value || null,
        schemaVersion: variantData.schemaVersion,
        aliases: variantData.nameAliases?.candidates || [],
        breadcrumbs: variantData.breadcrumbs?.trail || [],
        fullBreadcrumbs: variantData.breadcrumbs?.fullPath || [],
        breadcrumbPath: variantData.breadcrumbs?.path || ''
      });
      processedCount++;
    }

    if (processedCount > 0) {
      const indexData = {
        schemaVersion: INDEX_SCHEMA_VERSION,
        fileName: fileData.name,
        fileKey: config.fileKey,
        version: fileData.version,
        lastModified: fileData.lastModified,
        exportDate: new Date().toISOString(),
        components:
          componentsMeta.length > 0
            ? componentsMeta
            : allComponentSets
                .filter(({ node }) => !config.component || node.name === config.component)
                .map(({ node }) => ({
                  name: node.name,
                  id: node.id,
                  variantCount: node.children ? node.children.length : 0
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
