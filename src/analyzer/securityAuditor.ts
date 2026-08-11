// doc/plan.md mục 18.3: passive security (implement) + exposure detection (P1, cần --security-probe)
// + dependency vulnerability (P1, cần advisory database thật — chưa làm ở bước scaffold này).

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export interface SecurityFinding {
  severity: Severity;
  description: string;
  evidence: string;
  recommendation: string;
}

const REQUIRED_HEADERS: Array<{ header: string; severity: Severity; recommendation: string }> = [
  { header: "strict-transport-security", severity: "MEDIUM", recommendation: "Thêm header HSTS." },
  { header: "content-security-policy", severity: "MEDIUM", recommendation: "Thêm Content-Security-Policy." },
  { header: "x-content-type-options", severity: "LOW", recommendation: "Thêm X-Content-Type-Options: nosniff." },
  { header: "x-frame-options", severity: "LOW", recommendation: "Thêm X-Frame-Options hoặc frame-ancestors CSP." },
  { header: "referrer-policy", severity: "INFO", recommendation: "Thêm Referrer-Policy." },
  { header: "permissions-policy", severity: "INFO", recommendation: "Thêm Permissions-Policy." },
];

export function auditPassiveSecurity(headers: Record<string, string>, isHttps: boolean): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  if (!isHttps) {
    findings.push({
      severity: "HIGH",
      description: "Site không phục vụ qua HTTPS",
      evidence: "protocol = http",
      recommendation: "Chuyển sang HTTPS.",
    });
  }

  for (const { header, severity, recommendation } of REQUIRED_HEADERS) {
    if (!headers[header]) {
      findings.push({
        severity,
        description: `Thiếu header ${header}`,
        evidence: "header không có trong response",
        recommendation,
      });
    }
  }

  const setCookie = headers["set-cookie"];
  if (setCookie) {
    if (!/secure/i.test(setCookie)) {
      findings.push({
        severity: "MEDIUM",
        description: "Cookie thiếu flag Secure",
        evidence: setCookie,
        recommendation: "Thêm flag Secure cho cookie.",
      });
    }
    if (!/httponly/i.test(setCookie)) {
      findings.push({
        severity: "MEDIUM",
        description: "Cookie thiếu flag HttpOnly",
        evidence: setCookie,
        recommendation: "Thêm flag HttpOnly cho cookie.",
      });
    }
    if (!/samesite/i.test(setCookie)) {
      findings.push({
        severity: "LOW",
        description: "Cookie thiếu flag SameSite",
        evidence: setCookie,
        recommendation: "Thêm flag SameSite cho cookie.",
      });
    }
  }

  return findings;
}

// P1 — chỉ chạy khi --security-probe (mục 18.3). Không exploit/intrusive testing.
const EXPOSURE_PATHS = ["/.env", "/.git/HEAD", "/wp-config.php.bak", "/.DS_Store"];

export async function auditExposure(_origin: string): Promise<SecurityFinding[]> {
  throw new Error(
    "auditExposure: not implemented yet (P1 — gated behind --security-probe, xem doc/plan.md mục 18.3)"
  );
}

export { EXPOSURE_PATHS };

// P1 — chỉ gắn cờ khi đối chiếu được advisory database thật (mục 12/18.3), không suy đoán từ version.
export async function auditDependencyVulnerabilities(_files: string[]): Promise<SecurityFinding[]> {
  throw new Error("auditDependencyVulnerabilities: not implemented yet (P1 — cần advisory database thật)");
}
