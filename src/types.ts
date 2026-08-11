// Xem doc/plan.md mục 3-4 (Resource entity & lifecycle) và mục 16 (Error model).

export type ResourceType =
  | "html"
  | "css"
  | "js"
  | "image"
  | "font"
  | "video"
  | "audio"
  | "other";

export type DiscoveredFrom = "html" | "css" | "runtime" | "sitemap" | "robots";

export type ResourceState =
  | "discovered"
  | "queued"
  | "fetching"
  | "downloaded"
  | "failed"
  | "blocked"
  | "rewritten"
  | "validated";

export interface Resource {
  id: string;
  url: string;
  finalUrl: string | null;
  type: ResourceType;
  contentType: string | null;
  status: number | null;
  localPath: string | null;
  sha256: string | null;
  size: number | null;
  source: string | null;
  dependencies: string[];
  dependents: string[];
  redirectChain: string[];
  discoveredFrom: DiscoveredFrom;
  state: ResourceState;
  blockedReason?: string;
  errorType?: ErrorType;
}

export type ErrorType =
  | "DNS_ERROR"
  | "TLS_ERROR"
  | "TIMEOUT"
  | "HTTP_403"
  | "HTTP_404"
  | "HTTP_429"
  | "HTTP_5XX"
  | "REDIRECT_LIMIT"
  | "ROBOTS_BLOCKED"
  | "MAX_SIZE_EXCEEDED"
  | "MAX_QUERY_VARIANTS_EXCEEDED"
  | "PARSE_ERROR"
  | "WRITE_ERROR"
  | "INVALID_CONTENT";

export interface CrawlError {
  url: string;
  type: ErrorType;
  status: number | null;
  message: string;
  retryCount: number;
  timestamp: string;
}
