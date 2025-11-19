import fs from "node:fs";
import path from "node:path";
import {
  MappingArtifact,
  MappingArtifactError,
  normalizeMappingArtifact,
} from "./artifacts";

export interface MappingArtifactPaths {
  baseDir: string;
  fileName?: string;
}

const ARTIFACT_FILENAME = "mapping.components.json";

export function resolveMappingArtifactPath(paths: MappingArtifactPaths): string {
  const fileName = paths.fileName ?? ARTIFACT_FILENAME;
  return path.join(paths.baseDir, fileName);
}

export function writeMappingArtifact(
  artifact: MappingArtifact,
  paths: MappingArtifactPaths,
): string {
  const resolvedPath = resolveMappingArtifactPath(paths);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const payload = JSON.stringify(artifact, null, 2);
  fs.writeFileSync(resolvedPath, payload, { encoding: "utf8" });
  return resolvedPath;
}

export function loadMappingArtifact(paths: MappingArtifactPaths): MappingArtifact {
  const resolvedPath = resolveMappingArtifactPath(paths);
  const payload = fs.readFileSync(resolvedPath, { encoding: "utf8" });
  return parseMappingArtifact(payload, resolvedPath);
}

export function parseMappingArtifact(
  payload: string,
  sourceDescription = "mapping artifact",
): MappingArtifact {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new MappingArtifactError([
      `${sourceDescription} could not be parsed as JSON: ${String(error)}`,
    ]);
  }
  return normalizeMappingArtifact(parsed);
}
