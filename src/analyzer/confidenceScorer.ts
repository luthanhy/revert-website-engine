// doc/plan.md mục 18.1: confidence 0-100 từ số lượng/loại evidence. Nếu evidence rỗng -> "Unknown", không đoán.

import { Evidence } from "./evidenceCollector";

const SOURCE_WEIGHT: Record<Evidence["source"], number> = {
  header: 25,
  cookie: 30,
  meta: 20,
  html: 15,
  "global-var": 20,
};

export function scoreConfidence(evidence: Evidence[]): number {
  if (evidence.length === 0) return 0;
  const raw = evidence.reduce((sum, e) => sum + SOURCE_WEIGHT[e.source], 0);
  return Math.min(100, raw);
}
