#!/usr/bin/env node

/**
 * Stage 3: Orienter runner.
 *
 * Inputs (named):
 *  - --figma-index <file>: path to figma-components-index.json
 *  - --repo-summary <file>: path to repo-summary.json
 *  - --output <file>: path for orientation JSONL (default: superconnect/orientation.jsonl)
 *
 * Behavior:
 *  - Reads the orienter prompt (prompts/orienter.md)
 *  - Invokes the agent ONCE with {figma index + repo summary}
 *  - Streams agent stdout to both the orientation.jsonl output and the log
 *  - Always overwrites the output file
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Command } = require('commander');
const { CodexCliAgentAdapter, OpenAIAgentAdapter } = require('../src/agent/agent-adapter');

const DEFAULT_AGENT_RUNNER = 'codex exec --model gpt-5.1-codex-mini --sandbox read-only';

const promptPath = path.join(__dirname, '..', 'prompts', 'orienter.md');
const defaultOutput = path.join(process.cwd(), 'superconnect', 'orientation.jsonl');

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const readJson = async (filePath) => {
  const data = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(data);
};

const parseArgs = (argv) => {
  const program = new Command();
  program
    .name('run-orienter')
    .requiredOption('--figma-index <file>', 'Path to figma-components-index.json')
    .requiredOption('--repo-summary <file>', 'Path to repo-summary.json')
    .option('--output <file>', 'Orientation JSONL output path', defaultOutput)
    .allowExcessArguments(false);
  program.parse(argv);
  const opts = program.opts();
  const outputPath = path.resolve(opts.output);
  const superconnectDir = path.dirname(outputPath);
  return {
    figmaIndex: path.resolve(opts.figmaIndex),
    repoSummary: path.resolve(opts.repoSummary),
    output: outputPath,
    agentLogDir: path.join(superconnectDir, 'orienter-logs')
  };
};

const buildPayload = (promptText, figmaIndex, repoSummary) =>
  [
    promptText.trim(),
    '',
    'FIGMA_INDEX:',
    JSON.stringify(figmaIndex, null, 2),
    '',
    'REPO_SUMMARY:',
    JSON.stringify(repoSummary, null, 2),
    ''
  ].join('\n');

const parseAgentJson = (text) => {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  const withoutFence = trimmed.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    try {
      return JSON.parse(withoutFence);
    } catch {
      return null;
    }
  }
};

const resolveBackend = () => {
  const backend = (process.env.AGENT_BACKEND || 'cli').toLowerCase();
  return backend === 'openai' ? 'openai' : 'cli';
};

const buildAdapter = (config) => {
  const backend = resolveBackend();
  if (backend === 'openai') {
    return new OpenAIAgentAdapter({
      model: process.env.AGENT_MODEL || undefined,
      logDir: config.agentLogDir
    });
  }
  const runner = process.env.AGENT_RUN_COMMAND || DEFAULT_AGENT_RUNNER;
  return new CodexCliAgentAdapter({
    runner,
    logDir: config.agentLogDir
  });
};

async function main() {
  const config = parseArgs(process.argv);

  const [promptText, figmaIndex, repoSummary] = await Promise.all([
    fsp.readFile(promptPath, 'utf8'),
    readJson(config.figmaIndex),
    readJson(config.repoSummary)
  ]);

  const components = Array.isArray(figmaIndex?.components) ? figmaIndex.components : [];
  if (components.length === 0) {
    console.error('❌ No components found in figma index.');
    process.exit(1);
  }

  const adapter = buildAdapter(config);
  ensureDir(path.dirname(config.output));
  const outputStream = fs.createWriteStream(config.output, { flags: 'w' }); // stomp existing

  const payload = buildPayload(promptText, figmaIndex, repoSummary);
  const result = await adapter.orient({
    payload,
    outputStream,
    logLabel: 'orienter'
  });
  if (result.code !== 0) {
    console.error(`❌ Orienter agent failed with code ${result.code}`);
    process.exit(result.code);
  }

  console.log(`Orientation written to ${config.output}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
