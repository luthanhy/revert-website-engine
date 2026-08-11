// doc/plan.md mục 13/18.4: frontend-backend.json — static/runtime/external/backend dependency classification.

import { DependencyGraph } from "../graph/dependencyGraph";
import { isSameOrigin } from "../crawler/urlPolicy";

export interface ApiEndpoint {
  url: string;
  method: string;
  kind: "rest" | "graphql" | "websocket" | "unknown";
}

export interface FrontendBackendReport {
  staticDependencyCount: number;
  runtimeDependencyCount: number;
  externalDependencyCount: number;
  apiEndpoints: ApiEndpoint[];
}

export function splitFrontendBackend(graph: DependencyGraph, rootUrl: string): FrontendBackendReport {
  const all = graph.all();
  const staticDependencyCount = all.filter((r) => r.discoveredFrom !== "runtime").length;
  const runtimeResources = all.filter((r) => r.discoveredFrom === "runtime");
  const externalDependencyCount = all.filter((r) => !isSameOrigin(r.url, rootUrl)).length;

  // TODO(P1): apiEndpoints cần dữ liệu network capture thật từ renderer.ts (chưa implement).
  const apiEndpoints: ApiEndpoint[] = runtimeResources
    .filter((r) => r.type === "other")
    .map((r) => ({ url: r.url, method: "GET", kind: guessApiKind(r.url) }));

  return {
    staticDependencyCount,
    runtimeDependencyCount: runtimeResources.length,
    externalDependencyCount,
    apiEndpoints,
  };
}

function guessApiKind(url: string): ApiEndpoint["kind"] {
  if (url.startsWith("wss://") || url.startsWith("ws://")) return "websocket";
  if (url.includes("/graphql")) return "graphql";
  if (url.includes("/api/")) return "rest";
  return "unknown";
}
