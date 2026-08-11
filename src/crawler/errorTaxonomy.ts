// doc/plan.md mục 16 (Error model).

import { ErrorType, CrawlError } from "../types";

export function classifyHttpStatus(status: number): ErrorType | null {
  if (status === 403) return "HTTP_403";
  if (status === 404) return "HTTP_404";
  if (status === 429) return "HTTP_429";
  if (status >= 500) return "HTTP_5XX";
  return null;
}

export function classifyException(err: unknown): ErrorType {
  const code = (err as { code?: string })?.code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "DNS_ERROR";
  if (code === "CERT_HAS_EXPIRED" || code?.startsWith("ERR_TLS")) return "TLS_ERROR";
  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") return "TIMEOUT";
  return "INVALID_CONTENT";
}

export function makeError(
  url: string,
  type: ErrorType,
  message: string,
  status: number | null = null,
  retryCount = 0
): CrawlError {
  return { url, type, status, message, retryCount, timestamp: new Date().toISOString() };
}
