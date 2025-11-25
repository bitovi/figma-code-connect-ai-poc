#!/usr/bin/env node

/**
 * Provider-agnostic agent runner for Superconnect v3.
 *
 * Contract:
 * - Reads a single prompt from stdin.
 * - Writes only the model's final message to stdout (keep it clean for pipeline parsers).
 * - Optional stderr logs for diagnostics.
 *
 * Providers:
 * - Codex CLI: spawn a local codex executable (`codex --exec` style).
 * - Claude Agent SDK: call Anthropic directly with a shared toolset.
 *
 * Tools (Claude only):
 * - list_files(globs?, limit?)
 * - read_file(path, maxBytes?)
 * - rg_search(pattern, globs?, limit?, maxBytes?)
 * - exec_shell(command, timeoutMs?, maxBytes?)  // enabled by default; disable with --no-exec
 * - write_file(path, content)                   // scoped to allowed write roots
 *
 * Guardrails:
 * - Root defaults to cwd; allowlists via AGENT_ALLOW_READ / --allow-read and AGENT_ALLOW_WRITE / --allow-write.
 * - Output clamped to byte limits to avoid token blow-ups.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const fg = require('fast-glob');

const DEFAULTS = {
  provider: process.env.AGENT_PROVIDER || 'codex',
  model: process.env.AGENT_MODEL || '',
  root: path.resolve(process.env.AGENT_ROOT || process.cwd()),
  maxTurns: parseInt(process.env.AGENT_MAX_TURNS || '12', 10) || 12,
  allowRead: parsePathList(process.env.AGENT_ALLOW_READ),
  allowWrite: parsePathList(process.env.AGENT_ALLOW_WRITE),
  allowExec: process.env.AGENT_ALLOW_EXEC !== 'false',
  codexCmd: process.env.AGENT_CODEX_CMD || 'codex --exec',
  systemPrompt: process.env.AGENT_SYSTEM_PROMPT || '',
  execCwd: path.resolve(process.env.AGENT_EXEC_CWD || process.cwd()),
  limits: {
    readBytes: parseInt(process.env.AGENT_MAX_READ_BYTES || '64000', 10) || 64000,
    searchBytes: parseInt(process.env.AGENT_MAX_SEARCH_BYTES || '32000', 10) || 32000,
    searchLimit: parseInt(process.env.AGENT_MAX_SEARCH_MATCHES || '200', 10) || 200,
    execBytes: parseInt(process.env.AGENT_MAX_EXEC_BYTES || '64000', 10) || 64000,
    execTimeoutMs: parseInt(process.env.AGENT_EXEC_TIMEOUT_MS || '20000', 10) || 20000
  }
};

function parsePathList(value) {
  if (!value) return [];
  return value
    .split(path.delimiter)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => path.resolve(p));
}

function usage() {
  const lines = [
    'agentRunner.js --provider codex|claude [options]',
    '',
    'Options:',
    '  --provider <name>        Provider to use (codex|claude); default: env AGENT_PROVIDER or codex',
    '  --model <name>           Model name (passed to provider when supported)',
    '  --max-turns <n>          Max turns for Claude tool sessions (default 12)',
    '  --root <path>            Primary root for read/write guards (default: cwd)',
    '  --allow-read <path>      Extra read allowlist path (repeatable)',
    '  --allow-write <path>     Extra write allowlist path (repeatable)',
    '  --codex-cmd "<cmd>"      Codex command (default: "codex --exec")',
    '  --system-prompt "<txt>"  Override system prompt (Claude)',
    '  --exec-cwd <path>        CWD for exec_shell (default: root or env AGENT_EXEC_CWD)',
    '  --exec-timeout <ms>      Timeout for exec_shell (default 20000)',
    '  --exec-bytes <n>         Output clamp for exec_shell (default 64000)',
    '  --search-limit <n>       Max matches for rg_search (default 200)',
    '  --search-bytes <n>       Output clamp for rg_search (default 32000)',
    '  --read-bytes <n>         Max bytes for read_file (default 64000)',
    '  --no-exec                Disable exec_shell tool',
    '  --help                   Show this help'
  ];
  console.log(lines.join('\n'));
}

function parseArgs(argv) {
  const cfg = { ...DEFAULTS, allowRead: [...DEFAULTS.allowRead], allowWrite: [...DEFAULTS.allowWrite] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--provider':
        cfg.provider = next || cfg.provider;
        i++;
        break;
      case '--model':
        cfg.model = next || cfg.model;
        i++;
        break;
      case '--max-turns':
        cfg.maxTurns = parseInt(next, 10) || cfg.maxTurns;
        i++;
        break;
      case '--root':
        cfg.root = path.resolve(next);
        i++;
        break;
      case '--allow-read':
        cfg.allowRead.push(path.resolve(next));
        i++;
        break;
      case '--allow-write':
        cfg.allowWrite.push(path.resolve(next));
        i++;
        break;
      case '--codex-cmd':
        cfg.codexCmd = next || cfg.codexCmd;
        i++;
        break;
      case '--system-prompt':
        cfg.systemPrompt = next || cfg.systemPrompt;
        i++;
        break;
      case '--exec-cwd':
        cfg.execCwd = path.resolve(next);
        i++;
        break;
      case '--exec-timeout':
        cfg.limits.execTimeoutMs = parseInt(next, 10) || cfg.limits.execTimeoutMs;
        i++;
        break;
      case '--exec-bytes':
        cfg.limits.execBytes = parseInt(next, 10) || cfg.limits.execBytes;
        i++;
        break;
      case '--search-limit':
        cfg.limits.searchLimit = parseInt(next, 10) || cfg.limits.searchLimit;
        i++;
        break;
      case '--search-bytes':
        cfg.limits.searchBytes = parseInt(next, 10) || cfg.limits.searchBytes;
        i++;
        break;
      case '--read-bytes':
        cfg.limits.readBytes = parseInt(next, 10) || cfg.limits.readBytes;
        i++;
        break;
      case '--no-exec':
        cfg.allowExec = false;
        break;
      case '--help':
        cfg.help = true;
        break;
      default:
        break;
    }
  }
  cfg.root = path.resolve(cfg.root);
  cfg.execCwd = cfg.execCwd ? path.resolve(cfg.execCwd) : cfg.root;
  const allowRead = new Set([cfg.root, cfg.execCwd, ...cfg.allowRead]);
  const allowWrite = new Set([cfg.root, cfg.execCwd, ...cfg.allowWrite]);
  cfg.allowRead = Array.from(allowRead);
  cfg.allowWrite = Array.from(allowWrite);
  return cfg;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function isSubpath(target, base) {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveWithin(root, allowList, inputPath) {
  const abs = path.isAbsolute(inputPath) ? path.normalize(inputPath) : path.normalize(path.join(root, inputPath));
  const match = allowList.find((allowed) => isSubpath(abs, allowed));
  if (!match) {
    return { ok: false, error: `Path not allowed: ${inputPath}` };
  }
  return { ok: true, path: abs };
}

function clampText(text, limit) {
  const buf = Buffer.from(text, 'utf8');
  if (buf.byteLength <= limit) return { text, truncated: false };
  const slice = buf.subarray(0, limit);
  return { text: slice.toString('utf8'), truncated: true };
}

async function readFileBounded(absPath, maxBytes) {
  const stat = await fs.promises.stat(absPath);
  if (stat.isDirectory()) {
    return { error: 'Path is a directory' };
  }
  if (stat.size > maxBytes) {
    const fd = await fs.promises.open(absPath, 'r');
    const buffer = Buffer.allocUnsafe(maxBytes);
    const { bytesRead } = await fd.read(buffer, 0, maxBytes, 0);
    await fd.close();
    return {
      content: buffer.subarray(0, bytesRead).toString('utf8'),
      truncated: true,
      size: stat.size
    };
  }
  const content = await fs.promises.readFile(absPath, 'utf8');
  return { content, truncated: false, size: stat.size };
}

async function listFiles(root, globs, limit) {
  const patterns = globs && globs.length ? globs : ['**/*'];
  const files = await fg(patterns, { cwd: root, dot: false, suppressErrors: true });
  const sliced = files.slice(0, limit);
  return {
    files: sliced,
    truncated: files.length > sliced.length
  };
}

async function rgSearch(root, pattern, globs, limit, maxBytes) {
  const args = ['-n', '--no-heading', '--color', 'never', '--max-count', String(limit), pattern, '.'];
  (globs || []).forEach((g) => {
    args.push('--glob', g);
  });
  return new Promise((resolve) => {
    const child = spawn('rg', args, { cwd: root });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      resolve({ error: `rg failed to start: ${err.message}` });
    });
    child.on('close', (code) => {
      const clamped = clampText(stdout, maxBytes);
      const stderrClamped = clampText(stderr, maxBytes);
      resolve({
        code,
        stdout: clamped.text,
        stderr: stderrClamped.text,
        truncated: clamped.truncated || stderrClamped.truncated
      });
    });
  });
}

async function execShell(command, cwd, limits, allowExec) {
  if (!allowExec) {
    return { error: 'exec_shell disabled (enabled by default; re-enable by removing --no-exec)' };
  }
  return new Promise((resolve) => {
    const child = spawn('bash', ['-lc', command], {
      cwd,
      env: { ...process.env },
      timeout: limits.execTimeoutMs,
      killSignal: 'SIGTERM'
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      resolve({ error: `exec failed: ${err.message}` });
    });
    child.on('close', (code, signal) => {
      const outClamp = clampText(stdout, limits.execBytes);
      const errClamp = clampText(stderr, limits.execBytes);
      resolve({
        code,
        signal,
        stdout: outClamp.text,
        stderr: errClamp.text,
        truncated: outClamp.truncated || errClamp.truncated
      });
    });
  });
}

async function writeFileSafe(root, allowList, targetPath, content) {
  const resolved = resolveWithin(root, allowList, targetPath);
  if (!resolved.ok) return { error: resolved.error };
  await fs.promises.mkdir(path.dirname(resolved.path), { recursive: true });
  await fs.promises.writeFile(resolved.path, content, 'utf8');
  return { ok: true, path: resolved.path };
}

function buildSystemPrompt(config) {
  if (config.systemPrompt) return config.systemPrompt;
  const lines = [
    'You are a local agent with structured tools. Keep stdout concise and write outputs exactly where instructed.',
    `Root: ${config.root}`,
    `Exec cwd: ${config.execCwd}`,
    'Tools: list_files, read_file, rg_search, exec_shell, write_file.',
    'Prefer rg_search + targeted reads over large dumps. Keep outputs short.'
  ];
  return lines.join('\n');
}

function buildTools(config) {
  const { root, allowRead, allowWrite, limits, allowExec, execCwd } = config;
  return [
    {
      name: 'list_files',
      description: 'List files under the root using optional glob filters.',
      inputSchema: {
        type: 'object',
        properties: {
          globs: { type: 'array', items: { type: 'string' } },
          limit: { type: 'integer' }
        }
      },
      execute: async ({ globs, limit }) => {
        const result = await listFiles(root, globs, limit || limits.searchLimit);
        return JSON.stringify(result, null, 2);
      }
    },
    {
      name: 'read_file',
      description: 'Read a text file relative to root or absolute if allowlisted.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          maxBytes: { type: 'integer' }
        },
        required: ['path']
      },
      execute: async ({ path: inputPath, maxBytes }) => {
        const resolved = resolveWithin(root, allowRead, inputPath);
        if (!resolved.ok) return resolved.error;
        const result = await readFileBounded(resolved.path, maxBytes || limits.readBytes);
        if (result.error) return result.error;
        const note = result.truncated ? `\n[truncated to ${maxBytes || limits.readBytes} bytes of ${result.size}]` : '';
        return `${result.content}${note}`;
      }
    },
    {
      name: 'rg_search',
      description: 'ripgrep search with optional globs. Returns trimmed text output.',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          globs: { type: 'array', items: { type: 'string' } },
          limit: { type: 'integer' },
          maxBytes: { type: 'integer' }
        },
        required: ['pattern']
      },
      execute: async ({ pattern, globs, limit, maxBytes }) => {
        const result = await rgSearch(root, pattern, globs, limit || limits.searchLimit, maxBytes || limits.searchBytes);
        if (result.error) return result.error;
        const base = [`code=${result.code}`, result.stdout || '(no matches)'];
        if (result.stderr) base.push(`stderr: ${result.stderr}`);
        if (result.truncated) base.push('[output truncated]');
        return base.join('\n');
      }
    },
    {
      name: 'exec_shell',
      description: 'Run a bounded shell command (reads only).',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          timeoutMs: { type: 'integer' },
          maxBytes: { type: 'integer' }
        },
        required: ['command']
      },
      execute: async ({ command, timeoutMs, maxBytes }) => {
        const result = await execShell(command, execCwd, {
          ...limits,
          execTimeoutMs: timeoutMs || limits.execTimeoutMs,
          execBytes: maxBytes || limits.execBytes
        }, allowExec);
        if (result.error) return result.error;
        const parts = [`code=${result.code}${result.signal ? ` signal=${result.signal}` : ''}`];
        if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
        if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
        if (result.truncated) parts.push('[output truncated]');
        return parts.join('\n');
      }
    },
    {
      name: 'write_file',
      description: 'Write a UTF-8 file within the allowed roots.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['path', 'content']
      },
      execute: async ({ path: targetPath, content }) => {
        const result = await writeFileSafe(root, allowWrite, targetPath, content);
        if (result.error) return result.error;
        return `wrote ${result.path}`;
      }
    }
  ];
}

async function runClaude(prompt, config) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY for Claude provider.');
  }
  let Agent;
  try {
    ({ Agent } = await import('@anthropic-ai/claude-agent-sdk'));
  } catch (err) {
    throw new Error(`Failed to load @anthropic-ai/claude-agent-sdk. Install it or set provider=codex. (${err.message})`);
  }
  const tools = buildTools(config);
  const agent = new Agent({
    apiKey,
    systemPrompt: buildSystemPrompt(config),
    tools
  });
  const result = await agent.run({ prompt, maxTurns: config.maxTurns });
  if (typeof result === 'string') return result;
  return JSON.stringify(result, null, 2);
}

function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildCodexCommand(config) {
  const modelPart = config.model ? ` --model ${shellQuote(config.model)}` : '';
  const cdPart = config.execCwd ? ` --cd ${shellQuote(config.execCwd)}` : '';
  return `${config.codexCmd}${modelPart}${cdPart}`;
}

async function runCodex(prompt, config) {
  const command = buildCodexCommand(config);
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-lc', command], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk.toString());
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve(output.trimEnd());
      else reject(new Error(`Codex runner exited with code ${code}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  if (config.help) {
    usage();
    process.exit(0);
  }
  const prompt = await readStdin();
  if (!prompt.trim()) {
    console.error('No prompt supplied on stdin.');
    process.exit(1);
  }
  try {
    const provider = (config.provider || 'codex').toLowerCase();
    const result =
      provider === 'claude' ? await runClaude(prompt, config) : await runCodex(prompt, config);
    if (result) process.stdout.write(result);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}

main();
