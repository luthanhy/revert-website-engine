// doc/plan.md mục 11: render bằng Playwright cho SPA/JS-heavy — network capture, scroll, giới hạn cứng
// thời gian/số request để tránh SPA tạo request vô hạn khiến crawler không biết khi nào kết thúc.

import { chromium, Browser, Request as PwRequest, Response as PwResponse } from "playwright";

export interface RenderCapturedRequest {
  url: string;
  method: string;
  resourceType: string; // document, stylesheet, image, script, font, media, xhr, fetch, websocket, other...
}

export interface RenderResult {
  html: string;
  finalUrl: string;
  status: number;
  redirectChain: string[];
  capturedRequests: RenderCapturedRequest[];
  consoleErrors: string[];
}

export interface RenderOptions {
  maxRenderTimeMs: number;
  maxNetworkRequests: number;
  scroll: boolean;
  scrollDelayMs: number;
  waitForNetworkIdle: boolean;
}

// 1 browser dùng chung cho cả crawl (nhiều page/context riêng biệt per renderPage call) — tránh
// chi phí khởi động browser mới cho từng trang. Phải gọi closeRenderer() khi crawl xong.
let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true, args: ["--no-sandbox"] });
  }
  return browserPromise;
}

export async function closeRenderer(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise;
  browserPromise = null;
  await browser.close();
}

function buildRedirectChain(response: PwResponse): string[] {
  const chain: string[] = [];
  let req: PwRequest | null = response.request();
  while (req) {
    chain.unshift(req.url());
    req = req.redirectedFrom();
  }
  return chain;
}

const MAX_SCROLL_STEPS = 10;

export async function renderPage(url: string, opts: RenderOptions): Promise<RenderResult> {
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  const capturedRequests: RenderCapturedRequest[] = [];
  const consoleErrors: string[] = [];
  let requestCount = 0;

  page.on("request", (req) => {
    if (req.resourceType() === "document") return; // navigation chính, xử lý riêng qua response
    if (requestCount >= opts.maxNetworkRequests) return;
    requestCount++;
    capturedRequests.push({ url: req.url(), method: req.method(), resourceType: req.resourceType() });
  });

  page.on("websocket", (ws) => {
    if (requestCount >= opts.maxNetworkRequests) return;
    requestCount++;
    capturedRequests.push({ url: ws.url(), method: "WS", resourceType: "websocket" });
  });

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  let response: PwResponse | null = null;
  try {
    response = await page.goto(url, {
      waitUntil: opts.waitForNetworkIdle ? "networkidle" : "load",
      timeout: opts.maxRenderTimeMs,
    });
  } catch {
    // Timeout khi chờ networkidle (SPA polling/websocket không bao giờ "idle" thật) hoặc load lỗi —
    // vẫn tiếp tục lấy HTML hiện có trong DOM thay vì fail cả trang.
  }

  if (opts.scroll) {
    for (let i = 0; i < MAX_SCROLL_STEPS; i++) {
      const before = await page.evaluate(() => document.body.scrollHeight).catch(() => 0);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForTimeout(opts.scrollDelayMs);
      const after = await page.evaluate(() => document.body.scrollHeight).catch(() => 0);
      if (after === before) break;
    }
  }

  const html = await page.content();
  const finalUrl = page.url();
  const status = response?.status() ?? 200;
  const redirectChain = response ? buildRedirectChain(response) : [url, finalUrl];

  await page.close();
  await context.close();

  return { html, finalUrl, status, redirectChain, capturedRequests, consoleErrors };
}
