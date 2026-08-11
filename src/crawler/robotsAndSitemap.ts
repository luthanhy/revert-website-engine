// doc/plan.md mục 6: robots.txt tôn trọng mặc định + sitemap làm seed phụ.

import { request } from "undici";

export interface RobotsInfo {
  disallow: string[];
  sitemaps: string[];
}

export async function fetchRobotsTxt(origin: string): Promise<RobotsInfo> {
  const result: RobotsInfo = { disallow: [], sitemaps: [] };
  try {
    const res = await request(new URL("/robots.txt", origin).toString());
    if (res.statusCode !== 200) return result;
    const body = await res.body.text();
    let relevant = false;
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (/^user-agent:\s*\*/i.test(trimmed)) relevant = true;
      else if (/^user-agent:/i.test(trimmed)) relevant = false;
      const disallowMatch = trimmed.match(/^disallow:\s*(.*)$/i);
      if (relevant && disallowMatch && disallowMatch[1]) result.disallow.push(disallowMatch[1].trim());
      const sitemapMatch = trimmed.match(/^sitemap:\s*(.*)$/i);
      if (sitemapMatch && sitemapMatch[1]) result.sitemaps.push(sitemapMatch[1].trim());
    }
  } catch {
    // Không có robots.txt hoặc không truy cập được -> coi như không có giới hạn.
  }
  return result;
}

export function isDisallowed(pathname: string, disallow: string[]): boolean {
  return disallow.some((rule) => rule !== "" && pathname.startsWith(rule));
}

// Sitemap XML đơn giản: đọc <loc>...</loc>, hỗ trợ sitemap index lồng nhau (đệ quy nông).
export async function fetchSitemapUrls(sitemapUrl: string, depth = 0): Promise<string[]> {
  if (depth > 2) return [];
  try {
    const res = await request(sitemapUrl);
    if (res.statusCode !== 200) return [];
    const xml = await res.body.text();
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    if (/<sitemapindex/i.test(xml)) {
      const nested = await Promise.all(locs.map((loc) => fetchSitemapUrls(loc, depth + 1)));
      return nested.flat();
    }
    return locs;
  } catch {
    return [];
  }
}
