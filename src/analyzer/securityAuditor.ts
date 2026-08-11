// doc/plan.md mục 18.3: passive security (implement) + exposure detection (--security-probe, chỉ
// GET thông thường, không exploit) + dependency vulnerability (P1, cần advisory database thật).

import { request } from "undici";
import { randomUUID } from "node:crypto";

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

// Chỉ chạy khi --security-probe (mục 18.3). Chỉ GET thông thường — không exploit/intrusive testing.
const EXPOSURE_PATHS = [
  "/.env",
  "/.env.local",
  "/.env.production",
  "/.git/HEAD",
  "/.git/config",
  "/wp-config.php.bak",
  "/wp-config.php.old",
  "/.DS_Store",
  "/config.php.bak",
  "/backup.zip",
  "/database.sql",
  "/.htaccess",
];

interface ProbeResult {
  status: number;
  size: number;
}

async function probeUrl(url: string): Promise<ProbeResult | null> {
  try {
    const res = await request(url, { maxRedirections: 0, headersTimeout: 10_000, bodyTimeout: 10_000 });
    const buffer = await res.body.arrayBuffer();
    return { status: res.statusCode, size: buffer.byteLength };
  } catch {
    return null;
  }
}

function sizesSimilar(a: number, b: number): boolean {
  if (a === 0 && b === 0) return true;
  const diff = Math.abs(a - b);
  return diff / Math.max(a, b, 1) < 0.05; // lệch <5% coi là cùng 1 trang (soft-404 template)
}

// Nhiều site trả 200 cho MỌI path không tồn tại (soft-404, thường là SPA fallback hoặc trang lỗi
// tuỳ biến) — nếu không có baseline để so sánh, một path thật sự KHÔNG tồn tại vẫn sẽ bị báo nhầm
// là "lộ". Baseline = request 1 path random chắc chắn không tồn tại, dùng làm mốc so sánh.
export async function auditExposure(origin: string): Promise<SecurityFinding[]> {
  const findings: SecurityFinding[] = [];
  const probeToken = randomUUID();
  const baseline = await probeUrl(`${origin}/__craw_web_probe_${probeToken}__`);

  for (const p of EXPOSURE_PATHS) {
    const result = await probeUrl(`${origin}${p}`);
    if (!result) continue; // lỗi mạng/timeout -> bỏ qua, không kết luận

    const looksLikeSoft404 =
      baseline !== null && baseline.status === result.status && sizesSimilar(baseline.size, result.size);

    if (result.status === 200 && !looksLikeSoft404) {
      findings.push({
        severity: "HIGH",
        description: `Đường dẫn nhạy cảm có thể đang bị lộ công khai: ${p}`,
        evidence: `GET ${p} -> HTTP ${result.status}, ${result.size} bytes (khác baseline 404: ${baseline?.status ?? "n/a"}, ${baseline?.size ?? "n/a"} bytes)`,
        recommendation: `Chặn truy cập public tới ${p} (trả 403/404, hoặc xoá khỏi web root/server config).`,
      });
    }
  }

  return findings;
}

export { EXPOSURE_PATHS };

// P1 — chỉ gắn cờ khi đối chiếu được advisory database thật (mục 12/18.3), không suy đoán từ version.
export async function auditDependencyVulnerabilities(_files: string[]): Promise<SecurityFinding[]> {
  throw new Error("auditDependencyVulnerabilities: not implemented yet (P1 — cần advisory database thật)");
}
