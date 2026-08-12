// doc/plan.md mục 2/8: rewrite HTML/CSS trỏ về local path. KHÔNG rewrite JS (xem mục 12).

import * as cheerio from "cheerio";
import { resolveUrl, isSkippableProtocol } from "../crawler/urlNormalizer";
import { ASSET_SELECTORS } from "../crawler/linkExtractor";

export type ResolveMap = Map<string, string>; // absolute URL (KHÔNG fragment) -> local relative path
// Phải khớp CHÍNH XÁC cách urlNormalizer.normalizeUrl() chuẩn hoá lúc discover (orchestrator.ts) —
// vd sort query param. Không tự import normalizeUrl trực tiếp ở đây để rewriter.ts không phụ thuộc
// CrawlConfig (stripParams) — caller (orchestrator.ts) truyền vào 1 hàm đã đóng gói sẵn config.
export type UrlNormalizer = (absoluteUrl: string) => string;

// resolveMap được build từ URL đã stripFragment() lúc discover (orchestrator.ts) — nhưng giá trị
// "raw" attribute ở đây có thể còn nguyên fragment (vd <use href="sprite.svg#icon">). Phải tách
// fragment TRƯỚC khi resolve+lookup, rồi ghép lại fragment gốc vào path local sau khi rewrite —
// nếu không, mọi reference có fragment sẽ không khớp resolveMap và bị bỏ qua âm thầm.
function splitFragment(raw: string): [string, string] {
  const idx = raw.indexOf("#");
  return idx === -1 ? [raw, ""] : [raw.slice(0, idx), raw.slice(idx)];
}

function resolveLocal(raw: string, baseUrl: string, resolveMap: ResolveMap, normalize: UrlNormalizer): string | null {
  const [withoutHash, hash] = splitFragment(raw);
  if (!withoutHash) return null;
  const absolute = resolveUrl(withoutHash, baseUrl);
  if (!absolute) return null;
  // Thử URL "thô" trước (khớp dep.finalUrl vốn không normalize — xem orchestrator.ts Phase 2), rồi
  // mới thử bản đã normalize (khớp dep.url). Nếu không thử cả 2, asset phát hiện qua --render (nơi
  // Chromium có thể tự sắp xếp lại thứ tự query param so với chuỗi HTML gốc) sẽ tải được nhưng
  // không rewrite được — resolveMap.get() trượt vì 2 chuỗi URL khác nhau dù cùng 1 resource.
  const local = resolveMap.get(absolute) ?? resolveMap.get(normalize(absolute));
  return local ? `${local}${hash}` : null;
}

function rewriteSrcsetValue(value: string, baseUrl: string, resolveMap: ResolveMap, normalize: UrlNormalizer): string {
  return value
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return trimmed;
      const spaceIdx = trimmed.search(/\s/);
      const url = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
      const descriptor = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx); // vd " 2x", " 600w" — giữ nguyên
      if (!url || isSkippableProtocol(url)) return trimmed;
      const local = resolveLocal(url, baseUrl, resolveMap, normalize);
      return local ? `${local}${descriptor}` : trimmed;
    })
    .join(",");
}

export function rewriteHtml(html: string, baseUrl: string, resolveMap: ResolveMap, normalize: UrlNormalizer): string {
  const $ = cheerio.load(html);

  // Dùng LẠI đúng danh sách selector đã dùng lúc extract (linkExtractor.ts ASSET_SELECTORS) —
  // đảm bảo mọi thứ đã được TẢI cũng được REWRITE, không cần 2 danh sách tay dễ lệch nhau.
  for (const { selector, attr } of ASSET_SELECTORS) {
    if (attr === "srcset") {
      $(selector).each((_, el) => {
        const raw = $(el).attr("srcset");
        if (!raw) return;
        $(el).attr("srcset", rewriteSrcsetValue(raw, baseUrl, resolveMap, normalize));
      });
      continue;
    }
    $(selector).each((_, el) => {
      const raw = $(el).attr(attr);
      if (!raw || isSkippableProtocol(raw)) return;
      const local = resolveLocal(raw, baseUrl, resolveMap, normalize);
      if (local) $(el).attr(attr, local);
    });
  }

  // <a href>: dùng CHUNG resolveMap (orchestrator.ts gộp cả asset lẫn htmlPathByUrl vào resolveMap
  // trước khi gọi hàm này) — chỉ rewrite nếu trang đích đã crawl xong (có trong map).
  $("a[href]").each((_, el) => {
    const raw = $(el).attr("href");
    if (!raw || isSkippableProtocol(raw)) return;
    const local = resolveLocal(raw, baseUrl, resolveMap, normalize);
    if (local) $(el).attr("href", local);
  });

  $("[style]").each((_, el) => {
    const style = $(el).attr("style") ?? "";
    const rewritten = style.replace(/url\((['"]?)([^'")]+)\1\)/g, (full, quote, raw) => {
      if (isSkippableProtocol(raw) || raw.startsWith("data:")) return full;
      const local = resolveLocal(raw, baseUrl, resolveMap, normalize);
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
    $(el).html(rewriteCss(css, baseUrl, resolveMap, normalize));
  });

  // Mọi path vừa rewrite ở trên đều tính TƯƠNG ĐỐI VỚI VỊ TRÍ FILE (không phải baseUrl gốc). Nếu để
  // nguyên <base href>, trình duyệt sẽ áp base đó lên CHÍNH các path vừa rewrite khi mở file thật,
  // resolve sai chỗ (mục 5: base href ảnh hưởng MỌI URL tương đối trong trang, kể cả path mới).
  // Trung hòa bằng href="." thay vì xoá thẻ, để giữ nguyên các thuộc tính khác như target="_blank".
  $("base[href]").attr("href", ".");

  return $.html();
}

export function rewriteCss(css: string, cssFileUrl: string, resolveMap: ResolveMap, normalize: UrlNormalizer): string {
  let result = css.replace(/url\((['"]?)([^'")]+)\1\)/g, (full, quote, raw) => {
    if (isSkippableProtocol(raw) || raw.startsWith("data:")) return full;
    const local = resolveLocal(raw, cssFileUrl, resolveMap, normalize);
    return local ? `url(${quote}${local}${quote})` : full;
  });

  // @import "foo.css"; / @import 'foo.css'; (không có url() bọc ngoài) — cssExtractor.ts đã hỗ trợ
  // cú pháp này khi discover (mục 9), nhưng regex url()-only ở trên bỏ sót lúc rewrite -> @import
  // vẫn trỏ tên file gốc, không tồn tại sau khi asset đổi tên theo content-hash.
  result = result.replace(/@import\s+(['"])([^'"]+)\1/g, (full, quote, raw) => {
    if (isSkippableProtocol(raw) || raw.startsWith("data:")) return full;
    const local = resolveLocal(raw, cssFileUrl, resolveMap, normalize);
    return local ? `@import ${quote}${local}${quote}` : full;
  });

  return result;
}

// Dùng khi --inline-css-js và 1 CSS bị inline lại @import CSS KHÁC cũng bị inline: phải thay
// @import bằng NỘI DUNG THẬT (đệ quy), không chỉ sửa path — nếu không, file A sau khi nhúng vẫn
// cần file B tồn tại riêng ngoài đĩa để @import hoạt động, phá mục tiêu "1 file duy nhất".
export function inlineCssImports(
  css: string,
  cssFileUrl: string,
  contentByUrl: Map<string, string>,
  normalize: UrlNormalizer
): string {
  return css.replace(
    /@import\s+(?:url\((['"]?)([^'")]+)\1\)|(['"])([^'"]+)\3)[^;]*;/g,
    (full, _q1: string, urlRaw: string | undefined, _q2: string, strRaw: string | undefined) => {
      const raw = urlRaw ?? strRaw;
      if (!raw || isSkippableProtocol(raw) || raw.startsWith("data:")) return full;
      const absolute = resolveUrl(raw, cssFileUrl);
      if (!absolute) return full;
      const content = contentByUrl.get(absolute) ?? contentByUrl.get(normalize(absolute));
      return content !== undefined ? content : full;
    }
  );
}

export interface InlineDependency {
  type: "css" | "js";
  relativePath: string; // path mà rewriteHtml() đã ghi vào href/src (vd "../assets/css/x.css")
  content: string; // JS: nguyên văn file; CSS: đã rewrite lại url() theo đúng vị trí HTML (caller lo)
}

// Nhúng thẳng nội dung CSS/JS vào HTML (--inline-css-js), thay <link>/<script src> bằng
// <style>/<script> chứa nội dung thật — để 1 file .html không cần thư mục assets/css,assets/js đi
// kèm mới mở được (ảnh/video/audio vẫn để riêng, xem doc/plan.md phần bàn về đánh đổi dung lượng).
export function inlineAssets(html: string, deps: InlineDependency[]): string {
  const $ = cheerio.load(html);
  for (const dep of deps) {
    if (dep.type === "css") {
      $(`link[href="${dep.relativePath}"]`).replaceWith(`<style>${dep.content}</style>`);
    } else {
      $(`script[src="${dep.relativePath}"]`).replaceWith(`<script>${dep.content}</script>`);
    }
  }
  return $.html();
}
