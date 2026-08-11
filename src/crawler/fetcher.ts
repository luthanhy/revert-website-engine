// doc/plan.md mục 5 (redirect chain đầy đủ), mục 10 (Content-Encoding, charset trước khi decode, streaming).

import { request } from "undici";
import { Readable } from "node:stream";
import * as zlib from "node:zlib";
import * as iconv from "iconv-lite";

export interface FetchResult {
  finalUrl: string;
  redirectChain: string[];
  status: number;
  contentType: string | null;
  headers: Record<string, string>;
  body: Readable; // đã giải nén (gzip/br/deflate), CHƯA decode charset — dùng cho binary streaming
}

const MAX_REDIRECTS = 10;

export async function fetchResource(
  url: string,
  opts: { timeoutMs: number; retry: number } = { timeoutMs: 30_000, retry: 0 }
): Promise<FetchResult> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.retry; attempt++) {
    try {
      return await fetchOnce(url, opts.timeoutMs);
    } catch (err) {
      lastErr = err;
      if (attempt < opts.retry) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function fetchOnce(url: string, timeoutMs: number): Promise<FetchResult> {
  const redirectChain: string[] = [url];
  let currentUrl = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await request(currentUrl, {
      maxRedirections: 0,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    });

    if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
      const location = res.headers.location;
      if (!location) throw new Error(`Redirect without Location header: ${currentUrl}`);
      const nextUrl = new URL(Array.isArray(location) ? location[0] : location, currentUrl).toString();
      await res.body.dump(); // drain
      redirectChain.push(nextUrl);
      currentUrl = nextUrl;
      continue;
    }

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(res.headers)) {
      if (value !== undefined) headers[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
    }
    const contentType = headers["content-type"] ?? null;
    const encoding = headers["content-encoding"] ?? null;
    const body = decompressStream(res.body as unknown as Readable, encoding);

    return { finalUrl: currentUrl, redirectChain, status: res.statusCode, contentType, headers, body };
  }

  throw new Error(`REDIRECT_LIMIT exceeded for ${url}`);
}

function decompressStream(body: Readable, encoding: string | null): Readable {
  if (encoding === "gzip") return body.pipe(zlib.createGunzip());
  if (encoding === "br") return body.pipe(zlib.createBrotliDecompress());
  if (encoding === "deflate") return body.pipe(zlib.createInflate());
  return body;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

// Thứ tự xác định charset (mục 10): Content-Type header -> <meta charset> -> UTF-8 mặc định.
// Phải xác định TRƯỚC khi decode buffer thành string để đưa vào cheerio/css-tree.
export async function readTextWithEncoding(body: Readable, contentType: string | null): Promise<string> {
  const buffer = await streamToBuffer(body);

  const headerCharset = contentType?.match(/charset=([^;]+)/i)?.[1]?.trim();
  if (headerCharset && iconv.encodingExists(headerCharset)) {
    return iconv.decode(buffer, headerCharset);
  }

  const asciiPreview = buffer.subarray(0, 2048).toString("latin1");
  const metaCharset =
    asciiPreview.match(/<meta[^>]+charset=["']?([a-zA-Z0-9_-]+)/i)?.[1] ??
    asciiPreview.match(/<meta[^>]+content=["'][^"']*charset=([a-zA-Z0-9_-]+)/i)?.[1];
  if (metaCharset && iconv.encodingExists(metaCharset)) {
    return iconv.decode(buffer, metaCharset);
  }

  return iconv.decode(buffer, "utf-8");
}
