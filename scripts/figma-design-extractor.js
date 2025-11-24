/**
 * Lightweight, single-file helper that powers superconnect's design pull.
 * Copy this file into another repo and use the exported helpers to fetch a Figma
 * file and extract normalized component/variant metadata.
 */

const FIGMA_API_BASE = "https://api.figma.com/v1";

const DESIGN_ARTIFACT_KIND = "design.components";
const DESIGN_ARTIFACT_VERSION = 1;

class FigmaApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function createFigmaClient(token, options = {}) {
  const trimmedToken = (token ?? "").trim();
  if (!trimmedToken) {
    throw new Error("Figma token must be a non-empty string");
  }
  const fetcher = options.fetcher ?? fetch;
  const userAgent = options.userAgent ?? "superconnect-cli";

  return {
    tokenRedaction: `PAT length ${trimmedToken.length}`,
    async fetchFile(fileKey) {
      const standardKey = extractFileKey(fileKey);
      const response = await fetcher(`${FIGMA_API_BASE}/files/${standardKey}`, {
        method: "GET",
        headers: {
          "X-Figma-Token": trimmedToken,
          "User-Agent": userAgent,
        },
      });
      const payloadText = await response.text();
      if (!response.ok) {
        throw new FigmaApiError(
          `Figma API responded with ${response.status} ${response.statusText}`,
          response.status,
          payloadText,
        );
      }
      try {
        return JSON.parse(payloadText);
      } catch {
        throw new FigmaApiError(
          "Figma API returned malformed JSON",
          response.status,
          payloadText,
        );
      }
    },
  };
}

const FILE_URL_PATTERN = /(file|design|proto)\/([a-zA-Z0-9]+)(?:\/|\?|$)/;

function extractFileKey(input) {
  const trimmed = (input ?? "").trim();
  if (!trimmed) {
    throw new Error("Figma file key or URL must be a non-empty string");
  }
  const urlMatch = trimmed.match(FILE_URL_PATTERN);
  if (urlMatch) {
    return urlMatch[2];
  }
  return trimmed;
}

async function extractDesignComponents(options) {
  const { client, figmaFile, components, generatedAt } = options;
  const response = await client.fetchFile(figmaFile);
  const tiles = computeExtractionTiles(response.document);

  const normalizedComponents = components.map(normalizeComponentTarget);

  const collected = [];
  const warnings = [];

  for (const target of normalizedComponents) {
    const record = extractFromTiles(tiles, target);
    if (record) {
      collected.push(record);
    } else {
      warnings.push(`Component "${target}" was not found in the Figma document.`);
    }
  }

  const artifact = {
    kind: DESIGN_ARTIFACT_KIND,
    version: DESIGN_ARTIFACT_VERSION,
    figmaFile,
    generatedAt: generatedAt ?? new Date().toISOString(),
    components: sortComponents(collected),
    warnings,
  };

  return { artifact, warnings };
}

function computeExtractionTiles(root) {
  const tiles = [];
  const queue = [
    { node: root, pageName: root.name, prefix: root.name },
  ];
  while (queue.length > 0) {
    const { node, pageName, prefix } = queue.shift();
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
        queue.push({
          node: child,
          pageName: node.type === "PAGE" ? node.name : pageName,
          prefix: nextPrefix,
        });
      }
    }
  }
  return tiles;
}

function extractFromTiles(tiles, targetName) {
  const matches = tiles
    .map((tile) => ({
      tile,
      score: scoreTileMatch(tile, targetName),
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) => b.score - a.score || a.tile.prefix.localeCompare(b.tile.prefix),
    );

  for (const match of matches) {
    const record = extractComponentRecord(
      match.tile.node,
      match.tile.pageName,
      targetName,
    );
    if (record) {
      return record;
    }
  }
  return undefined;
}

function scoreTileMatch(tile, targetName) {
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

function normalizeComponentTarget(name) {
  return name.trim();
}

function extractComponentRecord(root, pageName, targetName) {
  const queue = [{ node: root }];
  while (queue.length > 0) {
    const { node } = queue.shift();
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

function isComponentNode(node) {
  return node.type === "COMPONENT_SET" || node.type === "COMPONENT";
}

function matchesComponent(target, nodeName) {
  const normalizedTarget = target.toLowerCase();
  return nodeName.toLowerCase().includes(normalizedTarget);
}

function buildComponentRecord(node, pageName) {
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

function collectVariants(node) {
  if (!node.children) {
    return [buildVariantFromNode(node, node.name)];
  }
  const variants = [];
  const stack = [...node.children];
  while (stack.length > 0) {
    const current = stack.shift();
    if (current.type === "COMPONENT") {
      variants.push(buildVariantFromNode(current, current.name));
    }
    if (current.children) {
      stack.push(...current.children);
    }
  }
  const baseVariants =
    variants.length > 0 ? variants : [buildVariantFromNode(node, node.name)];
  return dedupeVariants(baseVariants);
}

function dedupeVariants(variants) {
  const seen = new Set();
  const result = [];
  for (const variant of variants) {
    if (!seen.has(variant.nodeId)) {
      seen.add(variant.nodeId);
      result.push(variant);
    }
  }
  return result.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function buildVariantFromNode(node, label) {
  const metadata = parseVariantMetadata(label);
  return {
    nodeId: node.id,
    variantName: label,
    displayName: label,
    metadata,
  };
}

function parseVariantMetadata(label) {
  const metadata = {};
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
      case "colorscheme":
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

function collectPropertyKeys(variants) {
  const keys = new Set();
  for (const variant of variants) {
    Object.entries(variant.metadata).forEach(([key, value]) => {
      if (value !== undefined && value !== "") {
        keys.add(key);
      }
    });
  }
  return Array.from(keys).sort();
}

function normalizeMatchKey(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sortComponents(components) {
  return [...components].sort((a, b) => {
    if (a.componentName !== b.componentName) {
      return a.componentName.localeCompare(b.componentName);
    }
    return a.pageName.localeCompare(b.pageName);
  });
}

module.exports = {
  createFigmaClient,
  extractDesignComponents,
  DESIGN_ARTIFACT_KIND,
  DESIGN_ARTIFACT_VERSION,
  FigmaApiError,
};
