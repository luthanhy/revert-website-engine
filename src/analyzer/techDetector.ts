// doc/plan.md mục 18.1: technologies.json — name, category, confidence, evidence. "Unknown" nếu evidence không đủ.

import { SIGNATURES, TechCategory } from "./signatureEngine";
import { collectEvidence, Evidence, PageContext } from "./evidenceCollector";
import { scoreConfidence } from "./confidenceScorer";

export interface TechDetectionResult {
  name: string;
  category: TechCategory;
  confidence: number;
  evidence: string[];
}

const MIN_CONFIDENCE_TO_REPORT = 20;

export function detectTechnologies(ctx: PageContext): TechDetectionResult[] {
  const results: TechDetectionResult[] = [];

  for (const signature of SIGNATURES) {
    const evidence: Evidence[] = collectEvidence(signature, ctx);
    const confidence = scoreConfidence(evidence);
    if (confidence >= MIN_CONFIDENCE_TO_REPORT) {
      results.push({
        name: signature.name,
        category: signature.category,
        confidence,
        evidence: evidence.map((e) => e.description),
      });
    }
  }

  // TODO(P1): khi SIGNATURES còn rỗng (chưa curate), kết quả luôn là "Unknown" — đúng theo
  // nguyên tắc "không đoán bừa" (mục 18.1), không phải bug.
  return results.length > 0 ? results : [{ name: "Unknown", category: "language", confidence: 0, evidence: [] }];
}
