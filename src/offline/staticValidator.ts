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
    // mục 14: mẫu số không tính backend/API dependency (cố tình không tải, xem mục 8 "API — không
    // download, chỉ ghi nhận"). Dùng state === "discovered" thay vì discoveredFrom === "runtime" vì
    // asset tĩnh (ảnh/CSS/JS) được PHÁT HIỆN qua Playwright vẫn tải/rewrite bình thường và NÊN được
    // tính vào offline readiness — chỉ resource chưa từng được tải mới là backend dependency thật.
    if (resource.state === "discovered") continue;

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

// Công thức Offline Readiness % — xem doc/plan.md mục 14. Mẫu số loại backend/API dependency
// (resource cố tình chưa từng tải, state === "discovered"), không loại theo discoveredFrom.
export function computeOfflineReadiness(graph: DependencyGraph, result: StaticValidationResult): number {
  const staticResources = graph.all().filter((r) => r.state !== "discovered");
  if (staticResources.length === 0) return 100;
  const missing = new Set(result.missingAssets);
  const ok = staticResources.filter((r) => !missing.has(r.url)).length;
  return Math.round((ok / staticResources.length) * 100);
}
