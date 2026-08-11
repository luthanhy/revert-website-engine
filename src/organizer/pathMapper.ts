// doc/plan.md mục 10 (extension theo Content-Type, không theo URL) và mục 15 (Windows path constraints).

import * as path from "node:path";
import { ResourceType } from "../types";
import { MIME_TO_EXTENSION } from "../config";

const TYPE_DIR: Record<ResourceType, string> = {
  html: "html",
  css: "assets/css",
  js: "assets/js",
  image: "assets/images",
  font: "assets/fonts",
  video: "assets/videos",
  audio: "assets/videos",
  other: "assets/other",
};

// Windows cấm : * ? " < > | và ký tự điều khiển trong tên file/thư mục.
const FORBIDDEN_CHARS = /[:*?"<>|\x00-\x1f]/g;

export function sanitizePathSegment(segment: string): string {
  return segment.replace(FORBIDDEN_CHARS, "_");
}

export function extensionFromContentType(contentType: string | null, urlFallback: string): string {
  if (contentType) {
    const mime = contentType.split(";")[0].trim().toLowerCase();
    const ext = MIME_TO_EXTENSION[mime];
    if (ext) return ext;
  }
  const urlExt = path.extname(new URL(urlFallback).pathname);
  return urlExt || "";
}

const MAX_WINDOWS_PATH = 260;

export function mapToLocalPath(params: {
  domain: string;
  type: ResourceType;
  contentHash: string;
  contentType: string | null;
  url: string;
  outputRoot: string;
}): string {
  const domain = sanitizePathSegment(params.domain);
  const dir = TYPE_DIR[params.type];
  const ext = extensionFromContentType(params.contentType, params.url);
  const filename = `${params.contentHash.slice(0, 12)}${ext}`;
  const relative = path.posix.join(dir, filename);
  const full = path.join(params.outputRoot, domain, relative);

  if (full.length >= MAX_WINDOWS_PATH) {
    // Rút gọn: chỉ giữ hash ngắn, bỏ mọi phần tên gốc dài (đã không giữ tên gốc từ đầu ở đây,
    // nhưng domain dài + dir sâu vẫn có thể vượt giới hạn — cảnh báo để caller xử lý).
    throw new Error(
      `Local path exceeds ${MAX_WINDOWS_PATH} chars, not portable to Windows: ${full}`
    );
  }

  return path.posix.join(domain, relative);
}

// HTML page: đặt tên theo pathname URL (không content-hash) để dễ đọc/debug và để
// resolveMap tính được relative path ổn định giữa các trang. "/" hoặc path không có
// extension -> <path>/index.html hoặc <path>.html.
export function mapHtmlLocalPath(url: string, domain: string): string {
  const u = new URL(url);
  const segments = u.pathname.split("/").filter(Boolean).map(sanitizePathSegment);

  let fileName: string;
  if (u.pathname === "" || u.pathname.endsWith("/") || segments.length === 0) {
    fileName = "index.html";
  } else {
    const last = segments.pop()!;
    fileName = /\.[a-zA-Z0-9]+$/.test(last) ? last : `${last}.html`;
  }

  return path.posix.join(sanitizePathSegment(domain), "html", ...segments, fileName);
}
