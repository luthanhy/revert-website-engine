// doc/plan.md mục 18.8: summary.json + summary.md — tổng hợp toàn bộ audit thành output cuối.

import { TechDetectionResult } from "./techDetector";
import { MinificationResult } from "./minifyDetector";
import { SecurityFinding, Severity } from "./securityAuditor";
import { FrontendBackendReport } from "./stackSplitter";
import { CrawlError } from "../types";

export interface AuditSummary {
  technologies: TechDetectionResult[];
  minification: MinificationResult[];
  securityFindings: SecurityFinding[];
  frontendBackend: FrontendBackendReport;
  offlineReadinessPercent: number;
  errors: CrawlError[];
}

export interface SummaryReport {
  json: Record<string, unknown>;
  markdown: string;
}

export function buildSummary(input: AuditSummary): SummaryReport {
  const severityCounts: Record<Severity, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0,
  };
  for (const f of input.securityFindings) severityCounts[f.severity]++;

  const json = {
    offlineReadinessPercent: input.offlineReadinessPercent,
    technologies: input.technologies,
    severityCounts,
    frontendBackend: input.frontendBackend,
    errorCount: input.errors.length,
  };

  const topTech = input.technologies
    .filter((t) => t.name !== "Unknown")
    .slice(0, 5)
    .map((t) => `- ${t.name} (${t.category}, confidence ${t.confidence}%)`)
    .join("\n") || "- Unknown";

  const markdown = `# Craw_Web Audit Summary

## Offline Readiness
${input.offlineReadinessPercent}% (xem doc/plan.md mục 14 cho công thức)

## Technology Stack
${topTech}

## Security Findings (theo severity, KHÔNG dùng điểm số tổng hợp — xem mục 18.3)
- CRITICAL: ${severityCounts.CRITICAL}
- HIGH: ${severityCounts.HIGH}
- MEDIUM: ${severityCounts.MEDIUM}
- LOW: ${severityCounts.LOW}
- INFO: ${severityCounts.INFO}

## Frontend/Backend
- Static dependencies: ${input.frontendBackend.staticDependencyCount}
- Runtime dependencies: ${input.frontendBackend.runtimeDependencyCount}
- External dependencies: ${input.frontendBackend.externalDependencyCount}
- API endpoints detected: ${input.frontendBackend.apiEndpoints.length}

## Errors
${input.errors.length} lỗi — xem errors.json
`;

  return { json, markdown };
}
