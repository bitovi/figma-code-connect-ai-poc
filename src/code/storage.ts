import fs from "node:fs";
import path from "node:path";

import {
  CodeComponentsArtifact,
  CodeArtifactError,
  normalizeCodeComponentsArtifact,
} from "./artifacts";

export interface CodeArtifactPaths {
  baseDir: string;
  fileName?: string;
}

const CODE_ARTIFACT_FILENAME = "code.components.json";

export function resolveCodeArtifactPath(paths: CodeArtifactPaths): string {
  const fileName = paths.fileName ?? CODE_ARTIFACT_FILENAME;
  return path.join(paths.baseDir, fileName);
}

export function writeCodeArtifact(
  artifact: CodeComponentsArtifact,
  paths: CodeArtifactPaths,
): string {
  const resolvedPath = resolveCodeArtifactPath(paths);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const payload = JSON.stringify(artifact, null, 2);
  fs.writeFileSync(resolvedPath, payload, { encoding: "utf8" });
  return resolvedPath;
}

export function loadCodeArtifact(paths: CodeArtifactPaths): CodeComponentsArtifact {
  const resolvedPath = resolveCodeArtifactPath(paths);
  const payload = fs.readFileSync(resolvedPath, { encoding: "utf8" });
  return parseCodeArtifact(payload, resolvedPath);
}

export function parseCodeArtifact(
  payload: string,
  sourceDescription = "code artifact",
): CodeComponentsArtifact {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new CodeArtifactError([
      `${sourceDescription} could not be parsed as JSON: ${String(error)}`,
    ]);
  }
  return normalizeCodeComponentsArtifact(parsed);
}
