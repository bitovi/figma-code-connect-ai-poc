import { FigmaClient, FigmaNode } from "./client";
import {
  DESIGN_ARTIFACT_KIND,
  DESIGN_ARTIFACT_VERSION,
  DesignComponentRecord,
  DesignComponentVariant,
  DesignComponentsArtifact,
  DesignVariantMetadata,
} from "./artifacts";

export interface ExtractionOptions {
  client: FigmaClient;
  figmaFile: string;
  components: readonly string[];
  generatedAt?: string;
}

interface ExtractionResult {
  artifact: DesignComponentsArtifact;
  warnings: string[];
}

export async function extractDesignComponents(
  options: ExtractionOptions,
): Promise<ExtractionResult> {
  const { client, figmaFile, components, generatedAt } = options;
  const response = await client.fetchFile(figmaFile);
  const tiles = computeExtractionTiles(response.document);

  const normalizedComponents = components.map(normalizeComponentTarget);

  const collected: DesignComponentRecord[] = [];
  const warnings: string[] = [];

  for (const target of normalizedComponents) {
    const record = extractFromTiles(tiles, target);
    if (record) {
      collected.push(record);
    } else {
      warnings.push(
        `Component "${target}" was not found in the Figma document.`,
      );
    }
  }

  const artifact: DesignComponentsArtifact = {
    kind: DESIGN_ARTIFACT_KIND,
    version: DESIGN_ARTIFACT_VERSION,
    figmaFile,
    generatedAt: generatedAt ?? new Date().toISOString(),
    components: sortComponents(collected),
    warnings,
  };

  return { artifact, warnings };
}

interface ExtractionTile {
  pageName: string;
  node: FigmaNode;
  prefix: string;
}

function computeExtractionTiles(root: FigmaNode): ExtractionTile[] {
  const tiles: ExtractionTile[] = [];
  const queue: Array<{ node: FigmaNode; pageName: string; prefix: string }> = [
    { node: root, pageName: root.name, prefix: root.name },
  ];
  while (queue.length > 0) {
    const { node, pageName, prefix } = queue.shift()!;
    const nextPrefix =
      node.type === "PAGE"
        ? node.name
        : `${prefix}/${node.name}`.replace(/\/{2,}/g, "/");
    if (node.type === "PAGE") {
      tiles.push({ pageName: node.name, node, prefix: node.name });
    } else if (isComponentNode(node)) {
      tiles.push({ pageName, node, prefix: nextPrefix });
    }
    if (node.children) {
      for (const child of node.children) {
        queue.push({ node: child, pageName: node.type === "PAGE" ? node.name : pageName, prefix: nextPrefix });
      }
    }
  }
  return tiles;
}

function extractFromTiles(
  tiles: ExtractionTile[],
  targetName: string,
): DesignComponentRecord | undefined {
  const matches = tiles
    .map((tile) => ({
      tile,
      score: scoreTileMatch(tile, targetName),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.tile.prefix.localeCompare(b.tile.prefix));

  for (const match of matches) {
    const record = extractComponentRecord(match.tile.node, match.tile.pageName, targetName);
    if (record) {
      return record;
    }
  }
  return undefined;
}

function scoreTileMatch(tile: ExtractionTile, targetName: string): number {
  const normalizedTarget = targetName.toLowerCase();
  const normalizedPrefix = tile.prefix.toLowerCase();
  const normalizedNode = tile.node.name.toLowerCase();
  if (normalizedNode === normalizedTarget) {
    return 3;
  }
  if (normalizedNode.includes(normalizedTarget)) {
    return 2;
  }
  if (normalizedPrefix.includes(normalizedTarget)) {
    return 1;
  }
  return 0;
}

function normalizeComponentTarget(name: string): string {
  return name.trim();
}

function extractComponentRecord(
  root: FigmaNode,
  pageName: string,
  targetName: string,
): DesignComponentRecord | undefined {
  const queue: Array<{ node: FigmaNode }> = [{ node: root }];
  while (queue.length > 0) {
    const { node } = queue.shift()!;
    if (isComponentNode(node) && matchesComponent(targetName, node.name)) {
      return buildComponentRecord(node, pageName);
    }
    if (node.children) {
      for (const child of node.children) {
        queue.push({ node: child });
      }
    }
  }
  return undefined;
}

function isComponentNode(node: FigmaNode): boolean {
  return node.type === "COMPONENT_SET" || node.type === "COMPONENT";
}

function matchesComponent(target: string, nodeName: string): boolean {
  const normalizedTarget = target.toLowerCase();
  return nodeName.toLowerCase().includes(normalizedTarget);
}

function buildComponentRecord(node: FigmaNode, pageName: string): DesignComponentRecord {
  const variants = collectVariants(node);
  const propertyKeys = collectPropertyKeys(variants);
  return {
    componentName: node.name,
    matchKey: normalizeMatchKey(node.name),
    propertyKeys,
    componentNodeId: node.id,
    pageName,
    variants,
  };
}

function collectVariants(node: FigmaNode): DesignComponentVariant[] {
  if (!node.children) {
    return [buildVariantFromNode(node, node.name)];
  }
  const variants: DesignComponentVariant[] = [];
  const stack = [...node.children];
  while (stack.length > 0) {
    const current = stack.shift()!;
    if (current.type === "COMPONENT") {
      variants.push(buildVariantFromNode(current, current.name));
    }
    if (current.children) {
      stack.push(...current.children);
    }
  }
  const deduped = dedupeVariants(variants.length > 0 ? variants : [buildVariantFromNode(node, node.name)]);
  return deduped;
}

function dedupeVariants(variants: DesignComponentVariant[]): DesignComponentVariant[] {
  const seen = new Set<string>();
  const result: DesignComponentVariant[] = [];
  for (const variant of variants) {
    if (!seen.has(variant.nodeId)) {
      seen.add(variant.nodeId);
      result.push(variant);
    }
  }
  return result.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function buildVariantFromNode(node: FigmaNode, label: string): DesignComponentVariant {
  const metadata = parseVariantMetadata(label);
  return {
    nodeId: node.id,
    variantName: label,
    displayName: label,
    metadata,
  };
}

function parseVariantMetadata(label: string): DesignVariantMetadata {
  const metadata: DesignVariantMetadata = {};
  const parts = label.split(/[,|]/).map((part) => part.trim());
  for (const part of parts) {
    const [key, value] = part.split("=").map((segment) => segment.trim());
    if (!value) {
      continue;
    }
    switch (key.toLowerCase()) {
      case "variant":
      case "type":
        metadata.variant = value;
        break;
      case "size":
        metadata.size = value;
        break;
      case "color":
      case "scheme":
      case "colorScheme":
        metadata.colorScheme = value;
        break;
      case "state":
        if (value.toLowerCase() === "disabled") {
          metadata.disabled = true;
        }
        break;
      default:
        break;
    }
  }
  return metadata;
}

function collectPropertyKeys(variants: DesignComponentVariant[]): string[] {
  const keys = new Set<string>();
  for (const variant of variants) {
    Object.entries(variant.metadata).forEach(([key, value]) => {
      if (value !== undefined && value !== "") {
        keys.add(key);
      }
    });
  }
  return Array.from(keys).sort();
}

function normalizeMatchKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sortComponents(components: DesignComponentRecord[]): DesignComponentRecord[] {
  return [...components].sort((a, b) => {
    if (a.componentName !== b.componentName) {
      return a.componentName.localeCompare(b.componentName);
    }
    return a.pageName.localeCompare(b.pageName);
  });
}
