// doc/plan.md mục 17 (P1 — cần `better-sqlite3`, chưa cài ở bước scaffold này).
// Khi bắt đầu P1: `npm install better-sqlite3 @types/better-sqlite3`, rồi implement:
//   - bảng resource theo crawl-id, state: queued | running | completed | failed | blocked
//   - `craw-web resume <crawl-id>`: tiếp tục queued, retry failed (còn quota), verify sha256
//     trước khi tin completed/rewritten (integrity check — xem mục 4)

import { Resource } from "../types";

export interface CrawlStateStore {
  save(resource: Resource): void;
  load(crawlId: string): Resource[];
  close(): void;
}

export function openCrawlState(_crawlId: string, _dbPath: string): CrawlStateStore {
  throw new Error("crawlState.ts: not implemented yet (P1 — requires better-sqlite3)");
}
