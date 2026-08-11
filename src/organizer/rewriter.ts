// doc/plan.md mục 2/8: rewrite HTML/CSS trỏ về local path. KHÔNG rewrite JS (xem mục 12).

import * as cheerio from "cheerio";
import { resolveUrl, isSkippableProtocol } from "../crawler/urlNormalizer";

export type ResolveMap = Map<string, string>; // absolute URL -> local relative path (đã có sẵn từ Dependency Graph)

const REWRITE_ATTRS: Array<{ selector: string; attr: string }> = [
  { selector: "img[src]", attr: "src" },
  { selector: "source[src]", attr: "src" },
  { selector: "script[src]", attr: "src" },
  { selector: "link[href]", attr: "href" },
  { selector: "video[src]", attr: "src" },
  { selector: "video[poster]", attr: "poster" },
  { selector: "audio[src]", attr: "src" },
  { selector: "track[src]", attr: "src" },
  { selector: "iframe[src]", attr: "src" },
  { selector: "a[href]", attr: "href" }, // chỉ rewrite nếu trang đích có trong resolveMap (đã crawl xong)
];

export function rewriteHtml(html: string, baseUrl: string, resolveMap: ResolveMap): string {
  const $ = cheerio.load(html);

  for (const { selector, attr } of REWRITE_ATTRS) {
    $(selector).each((_, el) => {
      const raw = $(el).attr(attr);
      if (!raw || isSkippableProtocol(raw)) return;
      const absolute = resolveUrl(raw, baseUrl);
      const local = absolute && resolveMap.get(absolute);
      if (local) $(el).attr(attr, local);
    });
  }

  $("[style]").each((_, el) => {
    const style = $(el).attr("style") ?? "";
    const rewritten = style.replace(/url\((['"]?)([^'")]+)\1\)/g, (full, quote, raw) => {
      if (isSkippableProtocol(raw) || raw.startsWith("data:")) return full;
      const absolute = resolveUrl(raw, baseUrl);
      const local = absolute && resolveMap.get(absolute);
      return local ? `url(${quote}${local}${quote})` : full;
    });
    $(el).attr("style", rewritten);
  });

  return $.html();
}

export function rewriteCss(css: string, cssFileUrl: string, resolveMap: ResolveMap): string {
  return css.replace(/url\((['"]?)([^'")]+)\1\)/g, (full, quote, raw) => {
    if (isSkippableProtocol(raw) || raw.startsWith("data:")) return full;
    const absolute = resolveUrl(raw, cssFileUrl);
    const local = absolute && resolveMap.get(absolute);
    return local ? `url(${quote}${local}${quote})` : full;
  });
}
