// Entry point cho bản .exe double-click (đóng gói bằng @yao-pkg/pkg — xem package.json "pkg" field
// và script "build:exe"). Chỉ hỏi 2 thứ: URL và thư mục output, còn lại dùng default hợp lý.
//
// QUAN TRỌNG: dòng set PLAYWRIGHT_BROWSERS_PATH bên dưới PHẢI chạy trước khi bất kỳ module nào
// require("playwright") — vì vậy "./orchestrator" (require gián tiếp "playwright" qua
// crawler/renderer.ts) được require() ĐỘNG bên trong main(), KHÔNG dùng `import` ở đầu file (mọi
// `import` bị TypeScript hoist lên đầu file khi biên dịch sang CommonJS, chạy trước mọi statement
// khác kể cả khi đặt sau trong source — dùng require() động là cách duy nhất đảm bảo thứ tự đúng).
if ((process as unknown as { pkg?: unknown }).pkg) {
  // Chạy dưới dạng exe đã đóng gói: browser Chromium cho Windows được đặt sẵn trong thư mục
  // "browsers" nằm CẠNH file exe (xem scripts/download-windows-chromium.ts) — không dùng cache
  // mặc định của Playwright (~/.cache/ms-playwright) vì máy người dùng cuối chưa từng cài gì.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("node:path");
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(path.dirname(process.execPath), "browsers");
}

import * as readline from "node:readline/promises";
import type { CrawlConfig } from "./config";
import type { ProgressSnapshot, CrawlRunSummary } from "./orchestrator";

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function promptInputs(rl: readline.Interface): Promise<{ url: string; output: string }> {
  console.log("=== Craw_Web — Website Asset Crawler ===");
  console.log("Công cụ crawl website, tải asset (HTML/CSS/JS/ảnh/font/video) về máy, tổ chức lại");
  console.log("để mở xem offline được, kèm audit tech-stack/bảo mật cơ bản.\n");

  let url = "";
  while (!isValidHttpUrl(url)) {
    url = (await rl.question("1) Nhập URL trang web cần crawl (vd: https://example.com): ")).trim();
    if (!isValidHttpUrl(url)) console.log("   URL không hợp lệ — phải bắt đầu bằng http:// hoặc https://\n");
  }

  const outputAnswer = (
    await rl.question('2) Thư mục lưu kết quả (Enter để dùng ".\\output" cạnh file này): ')
  ).trim();
  const output = outputAnswer || "./output";

  return { url, output };
}

async function main(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const { url, output } = await promptInputs(rl);
  rl.close();

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DEFAULT_CONFIG } = require("./config") as typeof import("./config");
  const config: CrawlConfig = {
    ...DEFAULT_CONFIG,
    url,
    output,
    render: true, // exe đóng gói sẵn Chromium — bật mặc định để crawl được cả site SPA/Next.js
    waitForNetworkIdle: true,
  };

  console.log(`\nBắt đầu crawl: ${url}`);
  console.log(`Lưu vào: ${output}\n`);

  const isTTY = process.stdout.isTTY;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { runCrawl } = require("./orchestrator") as typeof import("./orchestrator");

    const summary: CrawlRunSummary = await runCrawl(config, (p: ProgressSnapshot) => {
      const line = `pages:${p.pages} downloaded:${p.downloaded} failed:${p.failed} blocked:${p.blocked} pending:${p.pending} | ${truncate(p.currentUrl, 60)}`;
      if (isTTY) process.stdout.write(`\r${line.padEnd(130)}`);
      else console.log(line);
    });
    if (isTTY) process.stdout.write("\n");

    console.log("\n=== Hoàn tất ===");
    console.log(`Trang crawl được: ${summary.pagesCrawled}`);
    console.log(`Asset tải được: ${summary.assetsDownloaded}`);
    console.log(`Offline readiness: ${summary.offlineReadinessPercent}%`);
    if (summary.errors > 0) console.log(`Lỗi: ${summary.errors} — xem ${summary.domainRoot}\\audit\\errors.json`);
    console.log(`\nKết quả: ${summary.domainRoot}`);
    console.log(`Mở file: ${summary.domainRoot}\\html\\index.html`);
  } catch (err) {
    console.error("\nCrawl thất bại:", err instanceof Error ? err.message : err);
  } finally {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { closeRenderer } = require("./crawler/renderer") as typeof import("./crawler/renderer");
      await closeRenderer();
    } catch {
      // renderer chưa từng được dùng (crawl fail sớm trước khi render) -> không có gì để đóng
    }
  }

  const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl2.question("\nNhấn Enter để thoát...");
  rl2.close();
}

main().catch((err) => {
  console.error("Lỗi không mong muốn:", err);
  process.exitCode = 1;
});
