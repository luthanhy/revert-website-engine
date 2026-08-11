// doc/plan.md mục 6 (crawl boundary/explosion guard) và mục 7 (same-origin/cross-origin).

export interface Origin {
  scheme: string;
  host: string;
  port: string;
}

export function getOrigin(url: string): Origin {
  const u = new URL(url);
  return { scheme: u.protocol, host: u.hostname, port: u.port || (u.protocol === "https:" ? "443" : "80") };
}

export function isSameOrigin(a: string, b: string): boolean {
  const oa = getOrigin(a);
  const ob = getOrigin(b);
  return oa.scheme === ob.scheme && oa.host === ob.host && oa.port === ob.port;
}

export function isSameSite(a: string, b: string, includeSubdomains: boolean): boolean {
  if (isSameOrigin(a, b)) return true;
  if (!includeSubdomains) return false;
  const ha = new URL(a).hostname;
  const hb = new URL(b).hostname;
  return ha.endsWith(`.${hb}`) || hb.endsWith(`.${ha}`);
}

// Chặn crawl explosion kiểu /search?q=a,aa,aaa... — đếm số biến thể query khác nhau/pathname.
export class QueryVariantGuard {
  private counts = new Map<string, number>();

  constructor(private readonly maxVariantsPerPath: number) {}

  // Trả về true nếu URL này được phép (chưa vượt giới hạn biến thể cho pathname của nó).
  allow(url: string): boolean {
    const u = new URL(url);
    const key = `${u.origin}${u.pathname}`;
    const count = this.counts.get(key) ?? 0;
    if (count >= this.maxVariantsPerPath) return false;
    this.counts.set(key, count + 1);
    return true;
  }
}
