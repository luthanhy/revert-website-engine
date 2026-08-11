// doc/plan.md mục 14 (P1 — cần `playwright`, xem ghi chú trong crawler/renderer.ts).
// Load trang qua localServer.ts (KHÔNG dùng file://), bắt console error, JS error, failed request,
// external request còn sót, CSP/SRI/Worker/Service Worker/Import Map/WASM.

export interface RuntimeValidationResult {
  jsErrors: string[];
  failedRequests: string[];
  externalRequests: string[];
  runtimeDependenciesDetected: string[]; // Service Worker, WebSocket, Worker, Import Map, WASM...
}

export async function runRuntimeValidation(
  _localServerUrl: string,
  _pagePaths: string[]
): Promise<RuntimeValidationResult> {
  throw new Error(
    "runtimeValidator.ts: not implemented yet (P1 — requires playwright, see crawler/renderer.ts)"
  );
}
