#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ARTIFACTS_DIR = path.resolve('artifacts');
const FIGMA_DIR = path.join(ARTIFACTS_DIR, 'figma-components');
const REACT_DIR = path.join(ARTIFACTS_DIR, 'react-components');
const MANIFEST_PATH = path.join(ARTIFACTS_DIR, 'codeconnect-manifest.json');
const SCOPE_PATH = path.join(ARTIFACTS_DIR, 'component-scope.json');
const OUTPUT_PATH = path.join(ARTIFACTS_DIR, 'match-candidates.jsonl');

const GUARDED_TOKENS = new Set(['status', 'progress']);

const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const listComponentFiles = dir =>
  fs
    .readdirSync(dir)
    .filter(file => file.endsWith('.json'))
    .map(file => path.join(dir, file));

const normalizeKey = name => (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const splitWords = name =>
  (name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const canonicalizeToken = token => {
  if (!token) return token;
  if (GUARDED_TOKENS.has(token)) return token;
  if (token.endsWith('ies')) return token.slice(0, -3) + 'y';
  if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
};

const tokenize = name => new Set(splitWords(name).map(canonicalizeToken).filter(Boolean));

const parseDotParts = name => {
  const parts = (name || '').split('.');
  if (parts.length <= 1) return [];
  return parts.map(p => canonicalizeToken(p.toLowerCase()));
};

const buildNameInfo = name => ({
  name,
  normalized: normalizeKey(name),
  tokens: tokenize(name),
  dotParts: parseDotParts(name),
});

const loadScopedFigma = scope => {
  const filesByName = listComponentFiles(FIGMA_DIR).reduce((acc, filePath) => {
    const json = readJson(filePath);
    if (json.componentName) {
      acc.set(json.componentName, { filePath, data: json });
    }
    return acc;
  }, new Map());

  return scope.fromFigma.map(entry => {
    const component = filesByName.get(entry.figmaName);
    return {
      scope: entry,
      figma: component?.data || null,
      info: buildNameInfo(entry.figmaName),
      filePath: component?.filePath || null,
    };
  });
};

const loadScopedReact = scopeNames => {
  const allowed = new Set(scopeNames);
  return listComponentFiles(REACT_DIR)
    .map(filePath => {
      const json = readJson(filePath);
      return { filePath, data: json };
    })
    .filter(entry => allowed.has(entry.data.componentName))
    .map(entry => ({
      name: entry.data.componentName,
      info: buildNameInfo(entry.data.componentName),
      filePath: entry.filePath,
    }));
};

const tokenOverlap = (a, b) => {
  const overlap = [];
  a.forEach(token => {
    if (b.has(token)) overlap.push(token);
  });
  return overlap;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const isDotAligned = (figmaInfo, overlap) => {
  if (figmaInfo.dotParts.length <= 1) return false;
  const [parent, child] = figmaInfo.dotParts;
  return overlap.includes(parent) && overlap.includes(child);
};

const scoreCandidate = (figma, react, scopeCandidates = new Set()) => {
  const overlap = tokenOverlap(figma.tokens, react.tokens);
  const unionSize = new Set([...figma.tokens, ...react.tokens]).size || 1;
  const coverage = figma.tokens.size ? overlap.length / figma.tokens.size : 0;
  const jaccard = overlap.length / unionSize;
  const normalizedMatch = figma.normalized === react.normalized;

  if (!overlap.length && !normalizedMatch) {
    return { score: 1, overlap, coverage, jaccard, reason: 'no token overlap' };
  }

  let score = 1 - (coverage * 0.65 + jaccard * 0.35);

  const [parent, child] = figma.dotParts;
  const hasParent = parent ? react.tokens.has(parent) : false;
  const hasChild = child ? react.tokens.has(child) : false;
  const parentChildBoost = hasParent && hasChild ? 0.1 : hasParent || hasChild ? 0.05 : 0;
  score = clamp(score - parentChildBoost, 0, 1);

  const scopeBoost = scopeCandidates.has(react.name) ? 0.05 : 0;
  score = clamp(score - scopeBoost, 0, 1);

  const reasonParts = [];
  if (normalizedMatch) {
    reasonParts.push('exact normalized match');
    score = 0;
  } else if (coverage === 1 && overlap.length) {
    reasonParts.push('all figma tokens covered');
  }
  if (parentChildBoost >= 0.1) {
    reasonParts.push('parent/child tokens align');
  } else if (parentChildBoost > 0) {
    reasonParts.push('partial parent/child overlap');
  }
  if (overlap.length) {
    reasonParts.push(`tokens ${overlap.join('+')} overlap`);
  }

  if (!reasonParts.length) reasonParts.push('name similarity');

  return {
    score,
    overlap,
    coverage,
    jaccard,
    reason: reasonParts.join('; '),
  };
};

const isHighConfidence = (figmaEntry, bestCandidate, scopeCandidates) => {
  const scopeBacked = scopeCandidates.has(bestCandidate.reactName);
  const multiTokenCoverage =
    figmaEntry.info.tokens.size > 1 &&
    bestCandidate.coverage === 1 &&
    bestCandidate.overlap.length === figmaEntry.info.tokens.size;
  const normalizedMatch = bestCandidate.score === 0 && bestCandidate.reason.includes('exact normalized match');
  const dotAligned = isDotAligned(figmaEntry.info, bestCandidate.overlap);
  const reorderedTokens = bestCandidate.coverage === 1 && bestCandidate.overlap.length >= 2;
  const scopedStrong = scopeBacked && bestCandidate.coverage >= 0.75;
  const highJaccard = bestCandidate.jaccard >= 0.7 && bestCandidate.overlap.length > 0;

  return normalizedMatch || dotAligned || scopedStrong || multiTokenCoverage || reorderedTokens || highJaccard;
};

const classifyFigma = (figmaEntry, reactEntries) => {
  const scopeCandidates = new Set(figmaEntry.scope.reactCandidates || []);
  const scored = reactEntries
    .map(react => {
      const scoredCandidate = scoreCandidate(figmaEntry.info, react.info, scopeCandidates);
      return { ...scoredCandidate, reactName: react.name };
    })
    .filter(c => c.overlap.length || figmaEntry.scope.reactCandidates?.includes(c.reactName));

  const scoredByName = scored.reduce((acc, candidate) => acc.set(candidate.reactName, candidate), new Map());
  const sorted = [...scoredByName.values()].sort((a, b) => a.score - b.score);

  if (!sorted.length) {
    return { type: 'uncertain', figmaName: figmaEntry.info.name, candidates: [] };
  }

  const best = sorted[0];
  if (isHighConfidence(figmaEntry, best, scopeCandidates)) {
    return {
      type: 'certain',
      figmaName: figmaEntry.info.name,
      reactName: best.reactName,
      reason: best.reason,
    };
  }

  const scopeNames = figmaEntry.scope.reactCandidates || [];
  const prioritized = [];
  scopeNames.forEach(name => {
    const match = scoredByName.get(name);
    if (match && !prioritized.find(c => c.reactName === name)) {
      prioritized.push(match);
    }
  });
  sorted.forEach(candidate => {
    if (prioritized.length >= 5) return;
    if (!prioritized.find(c => c.reactName === candidate.reactName)) {
      prioritized.push(candidate);
    }
  });

  const candidates = prioritized
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .map(c => ({
      reactName: c.reactName,
      score: Number(c.score.toFixed(4)),
      reason: c.reason,
    }));

  return { type: 'uncertain', figmaName: figmaEntry.info.name, candidates };
};

const writeJsonl = (entries, outputPath) => {
  const content = entries.map(entry => JSON.stringify(entry)).join('\n');
  fs.writeFileSync(outputPath, content + '\n', 'utf8');
};

const main = () => {
  const manifest = readJson(MANIFEST_PATH);
  const scope = readJson(SCOPE_PATH);

  if (!scope.fromFigma || !scope.reactComponents) {
    throw new Error('component-scope.json is missing expected fields.');
  }

  const figmaEntries = loadScopedFigma(scope);
  const reactEntries = loadScopedReact(scope.reactComponents);

  const matches = figmaEntries.map(entry => classifyFigma(entry, reactEntries));
  writeJsonl(matches, OUTPUT_PATH);

  const certainCount = matches.filter(m => m.type === 'certain').length;
  const uncertainCount = matches.filter(m => m.type === 'uncertain').length;

  console.log('Manifest import target:', manifest.importTarget);
  console.log(`Wrote ${matches.length} match candidates to ${OUTPUT_PATH}`);
  console.log(`Certain: ${certainCount} | Uncertain: ${uncertainCount}`);
};

main();
