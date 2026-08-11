// doc/plan.md mục 11 (P1 — cần `playwright`, chưa cài ở bước scaffold này để tránh tải browser binary
// nặng trước khi pipeline lõi P0 ổn định — xem mục 24 roadmap "không nhảy sang Playwright trước").
//
// Khi bắt đầu P1: `npm install playwright && npx playwright install chromium`, rồi implement:
//   - network capture: fetch/XHR/WebSocket/dynamic import/Worker/SharedWorker/Service Worker
//   - điều kiện dừng: --wait-for-network-idle, --max-render-time, --max-network-requests
//   - --scroll / --scroll-delay để kích hoạt lazy-loaded asset

export interface RenderCapturedRequest {
  url: string;
  method: string;
  resourceType: string;
}

export interface RenderResult {
  html: string;
  capturedRequests: RenderCapturedRequest[];
  consoleErrors: string[];
}

export async function renderPage(
  _url: string,
  _opts: { maxRenderTimeMs: number; maxNetworkRequests: number; scroll: boolean; scrollDelayMs: number }
): Promise<RenderResult> {
  throw new Error("renderer.ts: not implemented yet (P1 — requires playwright, see comment at top of file)");
}
