#!/usr/bin/env node

/**
 * Review match candidates (JSONL) and produce approved mappings.
 *
 * Input: artifacts/match-candidates.jsonl (one object per line)
 *  - certain: {type:"certain", figmaName, reactName, reason}
 *  - uncertain: {type:"uncertain", figmaName, candidates:[{reactName, score, reason}]}
 *
 * Output: artifacts/mappings.json (array of {figmaName, reactName, source})
 *  - certain entries are auto-approved with source "certain"
 *  - uncertain entries are prompted for approval; approved ones get source "review"
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Command } = require('commander');
const chalk = require('chalk').default;

const DEFAULT_INPUT = path.resolve('artifacts/match-candidates.jsonl');
const DEFAULT_OUTPUT = path.resolve('artifacts/mappings.json');

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Input JSONL not found: ${filePath}`);
  }
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.map((line, idx) => {
    try {
      return JSON.parse(line);
    } catch (err) {
      throw new Error(`Failed to parse JSON on line ${idx + 1}: ${err.message}`);
    }
  });
}

function writeMappings(mappings, outputPath) {
  fs.writeFileSync(outputPath, JSON.stringify(mappings, null, 2), 'utf8');
  console.log(`\n${chalk.green('✅')} Wrote ${mappings.length} mappings to ${outputPath}`);
}

async function promptUser(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => {
    rl.close();
    resolve(answer.trim());
  }));
}

async function reviewUncertain(uncertainEntries, mappings) {
  if (!uncertainEntries.length) return;
  console.log('\nReview uncertain mappings. Choose a code component for each Figma component that still needs a decision.');
  for (const entry of uncertainEntries) {
    const { figmaName, candidates = [] } = entry;
    console.log(`\nFigma: ${chalk.cyan(figmaName)}`);
    candidates.forEach((c, idx) => {
      console.log(`  [${idx + 1}] ${c.reactName} (score: ${c.score}, reason: ${c.reason})`);
    });
    const answer = await promptUser('Which code component should this map to? (number=approve, Enter=skip, s=skip all): ');
    if (answer.toLowerCase() === 's') {
      console.log('Skipping all remaining uncertain mappings.');
      break;
    }
    if (!answer) continue;
    const idx = parseInt(answer, 10) - 1;
    if (Number.isNaN(idx) || idx < 0 || idx >= candidates.length) {
      console.log('  Skipped (invalid choice).');
      continue;
    }
    const chosen = candidates[idx];
    mappings.push({ figmaName, reactName: chosen.reactName, source: 'review' });
    console.log(`  ${chalk.green('Approved')}: ${figmaName} -> ${chosen.reactName}`);
  }
}

async function main() {
  try {
    const program = new Command();
    program
      .option('--input <path>', 'Input match-candidates JSONL', DEFAULT_INPUT)
      .option('--output <path>', 'Output mappings JSON', DEFAULT_OUTPUT);
    program.parse(process.argv);
    const opts = program.opts();

    const entries = readJsonl(path.resolve(opts.input));
    const mappings = [];
    const certain = entries.filter(e => e.type === 'certain');
    const uncertain = entries.filter(e => e.type === 'uncertain');

    certain.forEach(e => mappings.push({ figmaName: e.figmaName, reactName: e.reactName, source: 'certain' }));
    console.log(chalk.bold('=== Match Review for Code Connect ==='));
    console.log('We need to link each Figma component to its code component to generate CodeConnect files.');
    console.log(`Input: ${path.resolve(opts.input)}`);
    console.log(`Auto-approved matches: ${certain.length}`);
    certain.forEach(e => {
      const reason = e.reason ? ` (${e.reason})` : '';
      console.log(`  - ${e.figmaName} -> ${e.reactName}${reason}`);
    });
    console.log(`Needs your decision: ${uncertain.length} (unmapped items will be skipped).`);
    console.log('For each unresolved Figma component, pick which code component to connect: number = approve, Enter = skip, s = skip all remaining.');

    await reviewUncertain(uncertain, mappings);
    writeMappings(mappings, path.resolve(opts.output));
  } catch (err) {
    console.error(`${chalk.red('❌ Error:')} ${err.message}`);
    process.exit(1);
  }
}

main();
