// doc/plan.md mục 9: HTML tag coverage đầy đủ + inline resource (style block, style attr, inline SVG).

import * as cheerio from "cheerio";
import { isHttpUrl, isSkippableProtocol, resolveUrl } from "./urlNormalizer";

export interface ExtractedLink {
  url: string;
  attr: "href" | "src" | "srcset" | "poster" | "action" | "style-inline";
  tag: string;
  isNavigable: boolean; // <a href> -> có thể crawl tiếp (nếu same-origin); asset -> chỉ tải
}

const ASSET_SELECTORS: Array<{ selector: string; attr: string; tag: string }> = [
  { selector: "img[src]", attr: "src", tag: "img" },
  { selector: "img[srcset]", attr: "srcset", tag: "img" },
  { selector: "source[src]", attr: "src", tag: "source" },
  { selector: "source[srcset]", attr: "srcset", tag: "source" },
  { selector: "script[src]", attr: "src", tag: "script" },
  { selector: "link[href]", attr: "href", tag: "link" },
  { selector: "video[src]", attr: "src", tag: "video" },
  { selector: "video[poster]", attr: "poster", tag: "video" },
  { selector: "audio[src]", attr: "src", tag: "audio" },
  { selector: "track[src]", attr: "src", tag: "track" },
  { selector: "iframe[src]", attr: "src", tag: "iframe" },
  { selector: "object[data]", attr: "data", tag: "object" },
  { selector: "embed[src]", attr: "src", tag: "embed" },
  { selector: "input[type=image][src]", attr: "src", tag: "input" },
  { selector: "meta[property='og:image']", attr: "content", tag: "meta" },
  { selector: "use[href]", attr: "href", tag: "use" },
];

function parseSrcset(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

export function extractLinks(html: string, baseUrlIn: string): ExtractedLink[] {
  const $ = cheerio.load(html);
  let baseUrl = baseUrlIn;
  const baseHref = $("base[href]").first().attr("href");
  if (baseHref) {
    const resolved = resolveUrl(baseHref, baseUrlIn);
    if (resolved) baseUrl = resolved;
  }

  const links: ExtractedLink[] = [];
  const push = (raw: string, attr: ExtractedLink["attr"], tag: string, isNavigable = false) => {
    if (!raw || isSkippableProtocol(raw)) return;
    const resolved = raw.startsWith("data:") ? raw : resolveUrl(raw, baseUrl);
    if (!resolved) return;
    if (!raw.startsWith("data:") && !isHttpUrl(resolved)) return;
    links.push({ url: resolved, attr, tag, isNavigable });
  };

  for (const { selector, attr, tag } of ASSET_SELECTORS) {
    $(selector).each((_, el) => {
      const value = $(el).attr(attr);
      if (!value) return;
      if (attr === "srcset") {
        for (const url of parseSrcset(value)) push(url, "srcset", tag);
      } else {
        push(value, attr as ExtractedLink["attr"], tag);
      }
    });
  }

  $("a[href]").each((_, el) => {
    push($(el).attr("href") ?? "", "href", "a", true);
  });

  $("form[action]").each((_, el) => {
    push($(el).attr("action") ?? "", "action", "form");
  });

  $("[style]").each((_, el) => {
    const style = $(el).attr("style") ?? "";
    for (const match of style.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
      push(match[2], "style-inline", "style-attr");
    }
  });

  return links;
}

// <style>...</style> blocks: parse như file CSS riêng bằng cssExtractor.ts (caller ghép lại).
export function extractInlineStyleBlocks(html: string): string[] {
  const $ = cheerio.load(html);
  return $("style")
    .map((_, el) => $(el).text())
    .get();
}
