const FIGMA_API_BASE = "https://api.figma.com/v1";

export interface FigmaClient {
  readonly tokenRedaction: string;
  fetchFile(fileKey: string): Promise<FigmaFileResponse>;
}

export interface FigmaClientOptions {
  fetcher?: typeof fetch;
  userAgent?: string;
}

export interface FigmaFileResponse {
  document: FigmaNode;
  components: Record<string, FigmaComponentSummary>;
  styles: Record<string, FigmaStyleSummary>;
  name: string;
  lastModified: string;
  version: string;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  componentId?: string;
  componentSets?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface FigmaComponentSummary {
  key: string;
  name: string;
  description?: string;
  remote: boolean;
  documentationLinks?: Array<{ uri: string }>;
}

export interface FigmaStyleSummary {
  key: string;
  name: string;
  description?: string;
  styleType: string;
}

export class FigmaApiError extends Error {
  readonly status: number;
  readonly details?: string;

  constructor(message: string, status: number, details?: string) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function createFigmaClient(
  token: string,
  options: FigmaClientOptions = {},
): FigmaClient {
  const trimmedToken = token.trim();
  if (!trimmedToken) {
    throw new Error("Figma token must be a non-empty string");
  }
  const fetcher = options.fetcher ?? fetch;
  const userAgent = options.userAgent ?? "superconnect-cli";

  return {
    tokenRedaction: `PAT length ${trimmedToken.length}`,
    async fetchFile(fileKey: string): Promise<FigmaFileResponse> {
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
        return JSON.parse(payloadText) as FigmaFileResponse;
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

function extractFileKey(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Figma file key or URL must be a non-empty string");
  }
  const urlMatch = trimmed.match(FILE_URL_PATTERN);
  if (urlMatch) {
    return urlMatch[2];
  }
  return trimmed;
}
