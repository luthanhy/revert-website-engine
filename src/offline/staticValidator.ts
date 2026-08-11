// doc/plan.md mục 14: Static Offline Validation — missing local asset, broken local link.
// Chỉ dùng dữ liệu đã có trong Dependency Graph + đĩa, không cần server/Playwright.

import { access } from "node:fs/promises";
import * as path from "node:path";
import { DependencyGraph } from "../graph/dependencyGraph";

export interface StaticValidationResult {
  missingAssets: string[]; // url của resource chưa có file local hợp lệ
  brokenLinks: string[]; // resource được tham chiếu (dependency) nhưng không tồn tại trong graph
}

export async function runStaticValidation(
  graph: DependencyGraph,
  outputRoot: string
): Promise<StaticValidationResult> {
  const missingAssets: string[] = [];
  const brokenLinks: string[] = [];

  for (const resource of graph.all()) {
    if (resource.discoveredFrom === "runtime") continue; // mục 14: mẫu số static không tính runtime

    if (!resource.localPath) {
      missingAssets.push(resource.url);
      continue;
    }
    const exists = await access(path.join(outputRoot, resource.localPath))
      .then(() => true)
      .catch(() => false);
    if (!exists) missingAssets.push(resource.url);

    for (const depId of resource.dependencies) {
      if (!graph.getNode(depId)) brokenLinks.push(`${resource.url} -> ${depId}`);
    }
  }

  return { missingAssets, brokenLinks };
}

// Công thức Offline Readiness % — xem doc/plan.md mục 14. Mẫu số chỉ tính discoveredFrom in {html, css, sitemap}.
export function computeOfflineReadiness(graph: DependencyGraph, result: StaticValidationResult): number {
  const staticResources = graph.all().filter((r) => r.discoveredFrom !== "runtime");
  if (staticResources.length === 0) return 100;
  const missing = new Set(result.missingAssets);
  const ok = staticResources.filter((r) => !missing.has(r.url)).length;
  return Math.round((ok / staticResources.length) * 100);
}
