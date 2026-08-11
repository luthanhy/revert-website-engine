// doc/plan.md mục 5 (URL Policy): normalization, tracking vs functional param, fragment.

export interface NormalizeOptions {
  stripParams: string[];
}

export function resolveUrl(relative: string, baseUrl: string): string | null {
  try {
    return new URL(relative, baseUrl).toString();
  } catch {
    return null;
  }
}

export function normalizeUrl(rawUrl: string, options: NormalizeOptions): string {
  const u = new URL(rawUrl);
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) {
    u.port = "";
  }
  for (const param of options.stripParams) {
    if (param.endsWith("*")) {
      const prefix = param.slice(0, -1);
      for (const key of [...u.searchParams.keys()]) {
        if (key.startsWith(prefix)) u.searchParams.delete(key);
      }
    } else {
      u.searchParams.delete(param);
    }
  }
  u.searchParams.sort();
  return u.toString();
}

// Fragment chỉ ảnh hưởng crawl-dedupe (bỏ để fetch 1 lần), không ảnh hưởng rewrite (giữ nguyên khi rewrite link).
export function stripFragment(url: string): string {
  const u = new URL(url);
  u.hash = "";
  return u.toString();
}

export function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

// mailto:, tel:, javascript:, data: — xem mục 9. data: giữ nguyên, không coi là link cần tải.
export function isSkippableProtocol(url: string): boolean {
  return /^(mailto|tel|javascript|data):/i.test(url.trim());
}
