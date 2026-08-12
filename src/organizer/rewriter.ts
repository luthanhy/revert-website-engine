// doc/plan.md mục 2/8: rewrite HTML/CSS trỏ về local path. KHÔNG rewrite JS (xem mục 12).

import * as cheerio from "cheerio";
import { resolveUrl, isSkippableProtocol } from "../crawler/urlNormalizer";
import { ASSET_SELECTORS } from "../crawler/linkExtractor";

export type ResolveMap = Map<string, string>; // absolute URL (KHÔNG fragment) -> local relative path

// resolveMap được build từ URL đã stripFragment() lúc discover (orchestrator.ts) — nhưng giá trị
// "raw" attribute ở đây có thể còn nguyên fragment (vd <use href="sprite.svg#icon">). Phải tách
// fragment TRƯỚC khi resolve+lookup, rồi ghép lại fragment gốc vào path local sau khi rewrite —
// nếu không, mọi reference có fragment sẽ không khớp resolveMap và bị bỏ qua âm thầm.
function splitFragment(raw: string): [string, string] {
  const idx = raw.indexOf("#");
  return idx === -1 ? [raw, ""] : [raw.slice(0, idx), raw.slice(idx)];
}

function resolveLocal(raw: string, baseUrl: string, resolveMap: ResolveMap): string | null {
  const [withoutHash, hash] = splitFragment(raw);
  if (!withoutHash) return null;
  const absolute = resolveUrl(withoutHash, baseUrl);
  const local = absolute && resolveMap.get(absolute);
  return local ? `${local}${hash}` : null;
}

function rewriteSrcsetValue(value: string, baseUrl: string, resolveMap: ResolveMap): string {
  return value
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return trimmed;
      const spaceIdx = trimmed.search(/\s/);
      const url = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
      const descriptor = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx); // vd " 2x", " 600w" — giữ nguyên
      if (!url || isSkippableProtocol(url)) return trimmed;
      const local = resolveLocal(url, baseUrl, resolveMap);
      return local ? `${local}${descriptor}` : trimmed;
    })
    .join(",");
}

export function rewriteHtml(html: string, baseUrl: string, resolveMap: ResolveMap): string {
  const $ = cheerio.load(html);

  // Dùng LẠI đúng danh sách selector đã dùng lúc extract (linkExtractor.ts ASSET_SELECTORS) —
  // đảm bảo mọi thứ đã được TẢI cũng được REWRITE, không cần 2 danh sách tay dễ lệch nhau.
  for (const { selector, attr } of ASSET_SELECTORS) {
    if (attr === "srcset") {
      $(selector).each((_, el) => {
        const raw = $(el).attr("srcset");
        if (!raw) return;
        $(el).attr("srcset", rewriteSrcsetValue(raw, baseUrl, resolveMap));
      });
      continue;
    }
    $(selector).each((_, el) => {
      const raw = $(el).attr(attr);
      if (!raw || isSkippableProtocol(raw)) return;
      const local = resolveLocal(raw, baseUrl, resolveMap);
      if (local) $(el).attr(attr, local);
    });
  }

  // <a href>: dùng CHUNG resolveMap (orchestrator.ts gộp cả asset lẫn htmlPathByUrl vào resolveMap
  // trước khi gọi hàm này) — chỉ rewrite nếu trang đích đã crawl xong (có trong map).
  $("a[href]").each((_, el) => {
    const raw = $(el).attr("href");
    if (!raw || isSkippableProtocol(raw)) return;
    const local = resolveLocal(raw, baseUrl, resolveMap);
    if (local) $(el).attr("href", local);
  });

  $("[style]").each((_, el) => {
    const style = $(el).attr("style") ?? "";
    const rewritten = style.replace(/url\((['"]?)([^'")]+)\1\)/g, (full, quote, raw) => {
      if (isSkippableProtocol(raw) || raw.startsWith("data:")) return full;
      const local = resolveLocal(raw, baseUrl, resolveMap);
      return local ? `url(${quote}${local}${quote})` : full;
    });
    $(el).attr("style", rewritten);
  });

  // <style>...</style> block (mục 9 "inline resource") — nhiều page-builder (LadiPage, Webflow...)
  // đặt toàn bộ background-image dưới dạng CSS rule trong 1 khối <style> thay vì <img>/style="" —
  // bỏ qua bước này sẽ khiến hầu hết ảnh trên các site dạng đó không được rewrite dù đã tải về.
  $("style").each((_, el) => {
    const css = $(el).html() ?? "";
    if (!css) return;
    $(el).html(rewriteCss(css, baseUrl, resolveMap));
  });

  // Mọi path vừa rewrite ở trên đều tính TƯƠNG ĐỐI VỚI VỊ TRÍ FILE (không phải baseUrl gốc). Nếu để
  // nguyên <base href>, trình duyệt sẽ áp base đó lên CHÍNH các path vừa rewrite khi mở file thật,
  // resolve sai chỗ (mục 5: base href ảnh hưởng MỌI URL tương đối trong trang, kể cả path mới).
  // Trung hòa bằng href="." thay vì xoá thẻ, để giữ nguyên các thuộc tính khác như target="_blank".
  $("base[href]").attr("href", ".");

  return $.html();
}

export function rewriteCss(css: string, cssFileUrl: string, resolveMap: ResolveMap): string {
  return css.replace(/url\((['"]?)([^'")]+)\1\)/g, (full, quote, raw) => {
    if (isSkippableProtocol(raw) || raw.startsWith("data:")) return full;
    const local = resolveLocal(raw, cssFileUrl, resolveMap);
    return local ? `url(${quote}${local}${quote})` : full;
  });
}
