#!/usr/bin/env node
// doc/plan.md mục 20 (CLI specification).

import { Command } from "commander";
import { CrawlConfig, DEFAULT_CONFIG } from "./config";
import { runCrawl } from "./orchestrator";
import { closeRenderer } from "./crawler/renderer";

const program = new Command();

program.name("craw-web").description("Website asset crawler & organizer").version("0.1.0");

program
  .command("crawl")
  .description("Crawl một website, tải asset, tổ chức local, sinh audit")
  .argument("<url>", "URL gốc cần crawl")
  .option("--depth <n>", "độ sâu tối đa", String(DEFAULT_CONFIG.depth))
  .option("--output <dir>", "thư mục output", DEFAULT_CONFIG.output)
  .option("--concurrency <n>", "số request song song", String(DEFAULT_CONFIG.concurrency))
  .option("--delay <ms>", "delay giữa các request (ms)", String(DEFAULT_CONFIG.delayMs))
  .option("--render", "bật render bằng Playwright (P1, chưa implement)", DEFAULT_CONFIG.render)
  .option("--scroll", "kích hoạt lazy-loaded asset khi render", DEFAULT_CONFIG.scroll)
  .option("--scroll-delay <ms>", "delay giữa mỗi lần scroll", String(DEFAULT_CONFIG.scrollDelayMs))
  .option("--wait-for-network-idle", "chờ network idle khi render", DEFAULT_CONFIG.waitForNetworkIdle)
  .option("--max-render-time <ms>", "giới hạn thời gian render/trang", String(DEFAULT_CONFIG.maxRenderTimeMs))
  .option("--max-network-requests <n>", "giới hạn request/trang khi render", String(DEFAULT_CONFIG.maxNetworkRequests))
  .option("--max-pages <n>", "tổng số trang HTML tối đa", String(DEFAULT_CONFIG.maxPages))
  .option(
    "--max-query-variants-per-path <n>",
    "giới hạn biến thể query/pathname (chống crawl explosion)",
    String(DEFAULT_CONFIG.maxQueryVariantsPerPath)
  )
  .option("--max-files <n>", "tổng số file tối đa", String(DEFAULT_CONFIG.maxFiles))
  .option("--max-size <bytes>", "tổng dung lượng tối đa (bytes)", String(DEFAULT_CONFIG.maxSizeBytes))
  .option(
    "--max-resource-size <bytes>",
    "dung lượng tối đa 1 file (bytes)",
    String(DEFAULT_CONFIG.maxResourceSizeBytes)
  )
  .option("--timeout <ms>", "timeout mỗi request", String(DEFAULT_CONFIG.timeoutMs))
  .option("--retry <n>", "số lần retry", String(DEFAULT_CONFIG.retry))
  .option("--ignore-robots", "bỏ qua robots.txt", DEFAULT_CONFIG.ignoreRobots)
  .option("--same-origin-only", "chỉ tải asset cùng origin", DEFAULT_CONFIG.sameOriginOnly)
  .option("--include-subdomains", "coi subdomain là same-site", DEFAULT_CONFIG.includeSubdomains)
  .option("--strip-param <name>", "loại thêm 1 query param khi normalize (lặp lại để thêm nhiều)", collectStrip, [])
  .option("--storage-state <file>", "Playwright storageState cho site cần login (P1)")
  .option("--security-probe", "bật exposure detection (P1, cần xác nhận có quyền kiểm tra site)", DEFAULT_CONFIG.securityProbe)
  .option("--log-level <level>", "debug|info|warn|error", DEFAULT_CONFIG.logLevel)
  .option("--log-file <file>", "ghi log ra file")
  .action(async (url: string, opts: Record<string, unknown>) => {
    const config: CrawlConfig = {
      url,
      depth: Number(opts.depth),
      output: String(opts.output),
      concurrency: Number(opts.concurrency),
      delayMs: Number(opts.delay),
      render: Boolean(opts.render),
      scroll: Boolean(opts.scroll),
      scrollDelayMs: Number(opts.scrollDelay),
      waitForNetworkIdle: Boolean(opts.waitForNetworkIdle),
      maxRenderTimeMs: Number(opts.maxRenderTime),
      maxNetworkRequests: Number(opts.maxNetworkRequests),
      maxPages: Number(opts.maxPages),
      maxQueryVariantsPerPath: Number(opts.maxQueryVariantsPerPath),
      maxFiles: Number(opts.maxFiles),
      maxSizeBytes: Number(opts.maxSize),
      maxResourceSizeBytes: Number(opts.maxResourceSize),
      timeoutMs: Number(opts.timeout),
      retry: Number(opts.retry),
      ignoreRobots: Boolean(opts.ignoreRobots),
      sameOriginOnly: Boolean(opts.sameOriginOnly),
      includeSubdomains: Boolean(opts.includeSubdomains),
      stripParams: opts.stripParam as string[],
      storageState: opts.storageState as string | undefined,
      securityProbe: Boolean(opts.securityProbe),
      logLevel: opts.logLevel as CrawlConfig["logLevel"],
      logFile: opts.logFile as string | undefined,
    };

    if (config.render) {
      console.log("[craw-web] --render bật: dùng Playwright, chậm hơn crawl tĩnh, cần Chromium đã cài (npx playwright install chromium).");
    }

    console.log(`[craw-web] Bắt đầu crawl ${config.url} (depth=${config.depth}, output=${config.output})`);
    const isTTY = process.stdout.isTTY;
    try {
      const summary = await runCrawl(config, (p) => {
        const line = `[craw-web] pages:${p.pages} downloaded:${p.downloaded} failed:${p.failed} blocked:${p.blocked} pending:${p.pending} | ${truncate(p.currentUrl, 70)}`;
        if (isTTY) {
          process.stdout.write(`\r${line.padEnd(140)}`);
        } else {
          console.log(line);
        }
      });
      if (isTTY) process.stdout.write("\n");
      console.log("\n[craw-web] Crawl hoàn tất:");
      console.log(JSON.stringify(summary, null, 2));
      console.log(`\nOutput: ${summary.domainRoot}`);
      console.log(`Offline readiness: ${summary.offlineReadinessPercent}%`);
      if (summary.errors > 0) {
        console.log(`Có ${summary.errors} lỗi — xem ${summary.domainRoot}/audit/errors.json`);
      }
    } catch (err) {
      console.error("[craw-web] Crawl thất bại:", err);
      process.exitCode = 1;
    } finally {
      if (config.render) await closeRenderer();
    }
  });

program
  .command("audit")
  .description("Chạy lại audit trên dữ liệu đã crawl")
  .argument("<crawl-dir>", "thư mục output đã crawl")
  .action((crawlDir: string) => {
    console.log(`[craw-web] audit ${crawlDir}: chưa implement (P1, xem doc/plan.md mục 18).`);
    process.exitCode = 1;
  });

program
  .command("validate")
  .description("Chạy offline validation (static + runtime) trên dữ liệu đã crawl")
  .argument("<crawl-dir>", "thư mục output đã crawl")
  .action((crawlDir: string) => {
    console.log(`[craw-web] validate ${crawlDir}: static validation đã có (src/offline/staticValidator.ts), ` +
      "runtime validation cần Playwright (P1, xem src/offline/runtimeValidator.ts).");
    process.exitCode = 1;
  });

program
  .command("resume")
  .description("Resume crawl bị dừng giữa chừng")
  .argument("<crawl-id>", "crawl-id cần resume")
  .action((crawlId: string) => {
    console.log(`[craw-web] resume ${crawlId}: chưa implement (P1, cần better-sqlite3, xem src/state/crawlState.ts).`);
    process.exitCode = 1;
  });

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function collectStrip(value: string, previous: string[]): string[] {
  return [...previous, value];
}

program.parseAsync(process.argv);
