import fs from "node:fs";
import path from "node:path";
import {
  DesignComponentsArtifact,
  DesignArtifactError,
  normalizeDesignComponentsArtifact,
} from "./artifacts";

export interface DesignArtifactPaths {
  baseDir: string;
  fileName?: string;
}

const ARTIFACT_FILENAME = "design.components.json";

export function resolveDesignArtifactPath(paths: DesignArtifactPaths): string {
  const fileName = paths.fileName ?? ARTIFACT_FILENAME;
  return path.join(paths.baseDir, fileName);
}

export function writeDesignArtifact(
  artifact: DesignComponentsArtifact,
  paths: DesignArtifactPaths,
): string {
  const resolvedPath = resolveDesignArtifactPath(paths);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const payload = JSON.stringify(artifact, null, 2);
  fs.writeFileSync(resolvedPath, payload, { encoding: "utf8" });
  return resolvedPath;
}

export function loadDesignArtifact(
  paths: DesignArtifactPaths,
): DesignComponentsArtifact {
  const resolvedPath = resolveDesignArtifactPath(paths);
  const payload = fs.readFileSync(resolvedPath, { encoding: "utf8" });
  return parseDesignArtifact(payload, resolvedPath);
}

export function parseDesignArtifact(
  payload: string,
  sourceDescription = "design artifact",
): DesignComponentsArtifact {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new DesignArtifactError([
      `${sourceDescription} could not be parsed as JSON: ${String(error)}`,
    ]);
  }
  return normalizeDesignComponentsArtifact(parsed);
}
