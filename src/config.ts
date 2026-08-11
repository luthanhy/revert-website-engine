// Giá trị mặc định — xem doc/plan.md mục 5 (URL Policy) và mục 6 (Crawl boundary) và mục 20 (CLI spec).

export interface CrawlConfig {
  url: string;
  depth: number;
  output: string;
  concurrency: number;
  delayMs: number;
  render: boolean;
  scroll: boolean;
  scrollDelayMs: number;
  waitForNetworkIdle: boolean;
  maxRenderTimeMs: number;
  maxNetworkRequests: number;
  maxPages: number;
  maxQueryVariantsPerPath: number;
  maxFiles: number;
  maxSizeBytes: number;
  maxResourceSizeBytes: number;
  timeoutMs: number;
  retry: number;
  ignoreRobots: boolean;
  sameOriginOnly: boolean;
  includeSubdomains: boolean;
  stripParams: string[];
  storageState?: string;
  securityProbe: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
  logFile?: string;
}

// Tracking param mặc định bị loại khi normalize URL (mục 5). Danh sách này còn tạm —
// mở rộng qua --strip-param, không tự đoán thêm param riêng của từng site.
export const DEFAULT_TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
];

export const DEFAULT_CONFIG: Omit<CrawlConfig, "url"> = {
  depth: 2,
  output: "./output",
  concurrency: 5,
  delayMs: 200,
  render: false,
  scroll: false,
  scrollDelayMs: 500,
  waitForNetworkIdle: true,
  maxRenderTimeMs: 30_000,
  maxNetworkRequests: 500,
  maxPages: 1000,
  maxQueryVariantsPerPath: 20,
  maxFiles: 10_000,
  maxSizeBytes: 1024 * 1024 * 1024, // 1GB
  maxResourceSizeBytes: 100 * 1024 * 1024, // 100MB
  timeoutMs: 30_000,
  retry: 3,
  ignoreRobots: false,
  sameOriginOnly: false,
  includeSubdomains: false,
  stripParams: [],
  securityProbe: false,
  logLevel: "info",
};

// MIME -> extension cho pathMapper (mục 10): Content-Type quyết định extension, không phải URL.
export const MIME_TO_EXTENSION: Record<string, string> = {
  "text/html": ".html",
  "text/css": ".css",
  "application/javascript": ".js",
  "text/javascript": ".js",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "image/x-icon": ".ico",
  "font/woff2": ".woff2",
  "font/woff": ".woff",
  "font/ttf": ".ttf",
  "application/font-woff2": ".woff2",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
};
