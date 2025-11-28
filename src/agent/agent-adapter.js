const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ensureDir = (dir) => {
  if (!dir) return;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const sanitizeSlug = (value, fallback = 'component') =>
  (value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || fallback;

const openLogStream = (dir, name) => {
  if (!dir) return null;
  ensureDir(dir);
  const file = path.join(dir, `${sanitizeSlug(name)}.log`);
  const stream = fs.createWriteStream(file, { flags: 'w' });
  stream.write('=== AGENT OUTPUT ===\n');
  return { stream, file };
};

/**
 * AgentAdapter interface (contract):
 *  - orient({ payload, logLabel?, outputStream?, logDir? }) -> Promise<{ code, stdout, stderr, logFile }>
 *  - codegen({ payload, logLabel?, cwd?, logDir? }) -> Promise<{ code, stdout, stderr, logFile }>
 *
 * Implementations abstract how we talk to an agent (CLI, SDK, etc.).
 */
class CodexCliAgentAdapter {
  constructor(options = {}) {
    this.runner = options.runner;
    this.defaultLogDir = options.logDir || null;
    this.defaultCwd = options.cwd;
  }

  orient({ payload, logLabel = 'orienter', outputStream = null, logDir } = {}) {
    return this.run({
      payload,
      logLabel,
      logDir,
      outputStream
    });
  }

  codegen({ payload, logLabel = 'component', cwd, logDir } = {}) {
    return this.run({
      payload,
      logLabel,
      logDir,
      cwd
    });
  }

  run({ payload, logLabel, logDir, cwd, outputStream } = {}) {
    const logStream = openLogStream(logDir || this.defaultLogDir, logLabel);
    return new Promise((resolve) => {
      const child = spawn(this.runner, { shell: true, cwd: cwd || this.defaultCwd });
      let stdout = '';
      let stderr = '';

      const writeLog = (text) => {
        if (logStream?.stream) logStream.stream.write(text);
      };
      const writeOutput = (text) => {
        if (outputStream) outputStream.write(text);
      };

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
        writeLog(text);
        writeOutput(text);
      });
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        writeLog(text);
      });

      child.on('close', (code) => {
        if (logStream?.stream) logStream.stream.end();
        if (outputStream) outputStream.end();
        resolve({ code: code || 0, stdout, stderr, logFile: logStream?.file || null });
      });

      child.stdin.write(payload);
      child.stdin.end();
    });
  }
}

module.exports = {
  CodexCliAgentAdapter
};
