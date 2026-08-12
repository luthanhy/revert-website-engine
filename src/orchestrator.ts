// Nối các module P0 thành 1 luồng crawl chạy được thật.
// Theo doc/plan.md mục 2 (pipeline). Runtime capture (Playwright, mục 11) đã nối khi config.render=true
// — riêng crawl-state/resume (SQLite, mục 17) vẫn là P1, CHƯA nối (xem crawlState.ts).

import { randomUUID, createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import PQueue from "p-queue";

import { CrawlConfig } from "./config";
import { CrawlError, DiscoveredFrom, Resource, ResourceType } from "./types";
import { isHttpUrl, normalizeUrl, stripFragment } from "./crawler/urlNormalizer";
import { isSameOrigin, isSameSite, QueryVariantGuard } from "./crawler/urlPolicy";
import { CrawlQueue } from "./crawler/queue";
import { fetchResource, readTextWithEncoding } from "./crawler/fetcher";
import { renderPage, closeRenderer } from "./crawler/renderer";
import { extractLinks, extractInlineStyleBlocks } from "./crawler/linkExtractor";
import { extractCssUrls } from "./crawler/cssExtractor";
import { fetchRobotsTxt, fetchSitemapUrls, isDisallowed } from "./crawler/robotsAndSitemap";
import { classifyException, classifyHttpStatus, makeError } from "./crawler/errorTaxonomy";
import { DependencyGraph } from "./graph/dependencyGraph";
import { mapHtmlLocalPath, mapToLocalPath, sanitizePathSegment } from "./organizer/pathMapper";
import { streamToDisk } from "./organizer/writer";
import { rewriteCss, rewriteHtml, ResolveMap } from "./organizer/rewriter";
import { runStaticValidation, computeOfflineReadiness } from "./offline/staticValidator";
import { detectMinification } from "./analyzer/minifyDetector";
import { auditPassiveSecurity, auditExposure } from "./analyzer/securityAuditor";
import { detectTechnologies } from "./analyzer/techDetector";
import { splitFrontendBackend } from "./analyzer/stackSplitter";
import { buildSummary } from "./analyzer/reportBuilder";

export interface CrawlRunSummary {
  crawlId: string;
  outputRoot: string;
  domainRoot: string;
  pagesCrawled: number;
  assetsDownloaded: number;
  errors: number;
  offlineReadinessPercent: number;
}

// doc/plan.md mục 21 (Logging & progress) — gọi mỗi khi 1 resource (trang hoặc asset) xong
// (thành công/lỗi/blocked) để CLI có thể in tiến trình, tránh trông như tool bị treo trên site lớn.
export interface ProgressSnapshot {
  pages: number;
  downloaded: number;
  failed: number;
  blocked: number;
  pending: number;
  currentUrl: string;
}

function classifyResourceType(contentType: string | null, url: string): ResourceType {
  const mime = contentType?.split(";")[0].trim().toLowerCase() ?? "";
  if (mime === "text/html") return "html";
  if (mime === "text/css") return "css";
  if (mime.includes("javascript")) return "js";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("font/") || mime.includes("font")) return "font";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime) return "other";

  const ext = path.extname(new URL(url).pathname).toLowerCase();
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".css") return "css";
  if (ext === ".js") return "js";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico"].includes(ext)) return "image";
  if ([".woff", ".woff2", ".ttf", ".otf"].includes(ext)) return "font";
  if ([".mp4", ".webm"].includes(ext)) return "video";
  if ([".mp3", ".ogg", ".wav"].includes(ext)) return "audio";
  return "other";
}

export async function runCrawl(
  config: CrawlConfig,
  onProgress?: (snapshot: ProgressSnapshot) => void
): Promise<CrawlRunSummary> {
  const crawlId = randomUUID();
  const rootUrl = normalizeUrl(config.url, { stripParams: config.stripParams });
  const domain = new URL(rootUrl).host;
  const origin = new URL(rootUrl).origin;
  const outputRoot = path.resolve(config.output);

  const graph = new DependencyGraph();
  const pageQueue = new CrawlQueue(config.depth);
  const queryGuard = new QueryVariantGuard(config.maxQueryVariantsPerPath);
  const pQueue = new PQueue({ concurrency: config.concurrency });
  const errors: CrawlError[] = [];
  const resolveByUrl = new Map<string, Resource>();
  const rawTextOf = new Map<string, string>();
  const assetSeen = new Set<string>();
  const rootHeaders = new Map<string, Record<string, string>>();

  let pageCount = 0;
  let fileCount = 0;
  let totalBytes = 0;

  function emitProgress(currentUrl: string): void {
    if (!onProgress) return;
    const all = graph.all();
    onProgress({
      pages: pageCount,
      downloaded: all.filter((r) => r.state === "downloaded" || r.state === "rewritten").length,
      failed: all.filter((r) => r.state === "failed").length,
      blocked: all.filter((r) => r.state === "blocked").length,
      pending: pQueue.size + pQueue.pending,
      currentUrl,
    });
  }

  function getOrCreateResource(url: string, discoveredFrom: DiscoveredFrom, sourceId: string | null): Resource {
    const existing = resolveByUrl.get(url);
    if (existing) return existing;
    const resource: Resource = {
      id: randomUUID(),
      url,
      finalUrl: null,
      type: "other",
      contentType: null,
      status: null,
      localPath: null,
      sha256: null,
      size: null,
      source: sourceId,
      dependencies: [],
      dependents: [],
      redirectChain: [],
      discoveredFrom,
      state: "discovered",
    };
    resolveByUrl.set(url, resource);
    graph.addNode(resource);
    return resource;
  }

  async function delay(): Promise<void> {
    if (config.delayMs > 0) await new Promise((r) => setTimeout(r, config.delayMs));
  }

  async function downloadResource(resource: Resource, useRenderer: boolean): Promise<void> {
    if (fileCount >= config.maxFiles) {
      resource.state = "blocked";
      resource.blockedReason = "MAX_FILES_EXCEEDED";
      return;
    }
    if (totalBytes >= config.maxSizeBytes) {
      resource.state = "blocked";
      resource.blockedReason = "MAX_SIZE_EXCEEDED";
      return;
    }

    resource.state = "fetching";
    await delay();

    if (useRenderer) {
      await downloadViaRenderer(resource);
      return;
    }

    let result;
    try {
      result = await fetchResource(resource.url, { timeoutMs: config.timeoutMs, retry: config.retry });
    } catch (err) {
      const type = classifyException(err);
      errors.push(makeError(resource.url, type, String(err)));
      resource.state = "failed";
      resource.errorType = type;
      return;
    }

    resource.finalUrl = result.finalUrl;
    resource.redirectChain = result.redirectChain;
    resource.status = result.status;
    resource.contentType = result.contentType;
    resource.type = classifyResourceType(result.contentType, result.finalUrl);

    const httpErrorType = classifyHttpStatus(result.status);
    if (httpErrorType) {
      result.body.on("error", () => {}); // destroy() phát 'error' bất đồng bộ, phải có listener trước khi gọi
      result.body.destroy();
      errors.push(makeError(resource.url, httpErrorType, `HTTP ${result.status}`, result.status));
      resource.state = "failed";
      resource.errorType = httpErrorType;
      return;
    }

    if (resource.url === rootUrl || resource.finalUrl === rootUrl) rootHeaders.set(resource.id, result.headers);

    fileCount++;

    if (resource.type === "html" || resource.type === "css") {
      let text: string;
      try {
        text = await readTextWithEncoding(result.body, result.contentType);
      } catch (err) {
        errors.push(makeError(resource.url, "PARSE_ERROR", String(err), result.status));
        resource.state = "failed";
        resource.errorType = "PARSE_ERROR";
        return;
      }
      const sha256 = createHash("sha256").update(text, "utf-8").digest("hex");
      resource.sha256 = sha256;
      resource.size = Buffer.byteLength(text);
      totalBytes += resource.size;
      resource.localPath =
        resource.type === "html"
          ? mapHtmlLocalPath(result.finalUrl, domain)
          : mapToLocalPath({
              domain,
              type: "css",
              contentHash: sha256,
              contentType: result.contentType,
              url: result.finalUrl,
              outputRoot,
            });
      rawTextOf.set(resource.id, text);
      resource.state = "downloaded";
    } else {
      const tempPath = path.join(outputRoot, ".tmp", randomUUID());
      let written;
      try {
        written = await streamToDisk(result.body, tempPath);
      } catch (err) {
        errors.push(makeError(resource.url, "WRITE_ERROR", String(err), result.status));
        resource.state = "failed";
        resource.errorType = "WRITE_ERROR";
        return;
      }
      if (written.size > config.maxResourceSizeBytes) {
        await fs.unlink(tempPath).catch(() => {});
        errors.push(
          makeError(resource.url, "MAX_SIZE_EXCEEDED", `Resource ${written.size} bytes vượt giới hạn`, result.status)
        );
        resource.state = "failed";
        resource.errorType = "MAX_SIZE_EXCEEDED";
        return;
      }
      resource.sha256 = written.sha256;
      resource.size = written.size;
      totalBytes += written.size;
      resource.localPath = mapToLocalPath({
        domain,
        type: resource.type,
        contentHash: written.sha256,
        contentType: result.contentType,
        url: result.finalUrl,
        outputRoot,
      });
      const finalAbs = path.join(outputRoot, resource.localPath);
      const exists = await fs
        .access(finalAbs)
        .then(() => true)
        .catch(() => false);
      if (exists) {
        await fs.unlink(tempPath).catch(() => {});
      } else {
        await fs.mkdir(path.dirname(finalAbs), { recursive: true });
        await fs.rename(tempPath, finalAbs);
      }
      resource.state = "downloaded";
    }
  }

  const RUNTIME_ASSET_TYPES = new Set(["stylesheet", "image", "script", "font", "media"]);
  const RUNTIME_BACKEND_TYPES = new Set(["xhr", "fetch", "eventsource"]);

  async function downloadViaRenderer(resource: Resource): Promise<void> {
    let render;
    try {
      render = await renderPage(resource.url, {
        maxRenderTimeMs: config.maxRenderTimeMs,
        maxNetworkRequests: config.maxNetworkRequests,
        scroll: config.scroll,
        scrollDelayMs: config.scrollDelayMs,
        waitForNetworkIdle: config.waitForNetworkIdle,
      });
    } catch (err) {
      const type = classifyException(err);
      errors.push(makeError(resource.url, type, String(err)));
      resource.state = "failed";
      resource.errorType = type;
      return;
    }

    resource.finalUrl = render.finalUrl;
    resource.redirectChain = render.redirectChain;
    resource.status = render.status;
    resource.contentType = "text/html";
    resource.type = "html";

    const httpErrorType = classifyHttpStatus(render.status);
    if (httpErrorType) {
      errors.push(makeError(resource.url, httpErrorType, `HTTP ${render.status}`, render.status));
      resource.state = "failed";
      resource.errorType = httpErrorType;
      return;
    }

    fileCount++;

    const text = render.html;
    const sha256 = createHash("sha256").update(text, "utf-8").digest("hex");
    resource.sha256 = sha256;
    resource.size = Buffer.byteLength(text);
    totalBytes += resource.size;
    resource.localPath = mapHtmlLocalPath(render.finalUrl, domain);
    rawTextOf.set(resource.id, text);
    resource.state = "downloaded";

    // Runtime network capture (mục 11/13): asset -> tải như bình thường; xhr/fetch/websocket ->
    // chỉ ghi nhận vào graph làm backend dependency, KHÔNG tải (mục 8 "API — không download").
    for (const req of render.capturedRequests) {
      if (req.resourceType === "websocket") {
        const wsResource = getOrCreateResource(req.url, "runtime", resource.id);
        graph.addDependency(resource.id, wsResource.id);
        continue;
      }
      const stripped = stripFragment(req.url);
      if (!isHttpUrl(stripped)) continue;
      const normalized = normalizeUrl(stripped, { stripParams: config.stripParams });
      if (RUNTIME_ASSET_TYPES.has(req.resourceType)) {
        enqueueAsset(normalized, "runtime", resource.id);
      } else if (RUNTIME_BACKEND_TYPES.has(req.resourceType)) {
        const apiResource = getOrCreateResource(normalized, "runtime", resource.id);
        graph.addDependency(resource.id, apiResource.id);
      }
    }
  }

  function enqueueAsset(url: string, discoveredFrom: DiscoveredFrom, sourceId: string): void {
    if (config.sameOriginOnly && !isSameOrigin(url, rootUrl)) return;
    const resource = getOrCreateResource(url, discoveredFrom, sourceId);
    graph.addDependency(sourceId, resource.id);
    if (assetSeen.has(url)) return;
    assetSeen.add(url);
    pQueue.add(() => processAsset(resource));
  }

  async function processAsset(resource: Resource): Promise<void> {
    await downloadResource(resource, false);
    emitProgress(resource.url);
    if (resource.state !== "downloaded" || resource.type !== "css") return;

    const text = rawTextOf.get(resource.id)!;
    const nested = extractCssUrls(text, resource.finalUrl!);
    for (const n of nested) {
      const stripped = stripFragment(n.url);
      if (!isHttpUrl(stripped)) continue;
      const normalized = normalizeUrl(stripped, { stripParams: config.stripParams });
      enqueueAsset(normalized, "css", resource.id);
    }
  }

  async function processPage(url: string, depth: number, discoveredFrom: DiscoveredFrom): Promise<void> {
    if (pageCount >= config.maxPages) {
      const resource = getOrCreateResource(url, discoveredFrom, null);
      resource.state = "blocked";
      resource.blockedReason = "MAX_PAGES_EXCEEDED";
      emitProgress(url);
      return;
    }

    const resource = getOrCreateResource(url, discoveredFrom, null);

    if (!config.ignoreRobots && robotsDisallow.length && isDisallowed(new URL(url).pathname, robotsDisallow)) {
      resource.state = "blocked";
      resource.blockedReason = "ROBOTS_BLOCKED";
      emitProgress(url);
      return;
    }

    await downloadResource(resource, config.render);
    emitProgress(resource.url);
    if (resource.state !== "downloaded" || resource.type !== "html") return;
    pageCount++;

    const text = rawTextOf.get(resource.id)!;
    const links = extractLinks(text, resource.finalUrl!);

    for (const link of links) {
      if (link.url.startsWith("data:")) continue;
      const stripped = stripFragment(link.url);
      if (!isHttpUrl(stripped)) continue;
      const normalized = normalizeUrl(stripped, { stripParams: config.stripParams });

      if (link.isNavigable) {
        const sameOrigin = isSameOrigin(normalized, rootUrl);
        const allowed =
          sameOrigin || (config.includeSubdomains && !config.sameOriginOnly && isSameSite(normalized, rootUrl, true));
        if (!allowed) continue;

        if (new URL(normalized).search && !queryGuard.allow(normalized)) {
          const blocked = getOrCreateResource(normalized, "html", null);
          blocked.state = "blocked";
          blocked.blockedReason = "MAX_QUERY_VARIANTS_EXCEEDED";
          continue;
        }

        if (pageQueue.push({ url: normalized, depth: depth + 1, discoveredFrom: "html" })) {
          // sẽ được xử lý ở wave tiếp theo trong vòng lặp chính bên dưới
        }
      } else if (link.tag !== "form") {
        // form[action] được extract để biết trang có gọi backend (mục 13), nhưng KHÔNG phải
        // static asset cần tải/resolve offline — tải nó sẽ luôn "lỗi" (form action thường không
        // trả nội dung cho GET) và làm sai lệch offline readiness (mục 14) một cách không công bằng.
        enqueueAsset(normalized, "html", resource.id);
      }
    }

    // <style>...</style> block (mục 9) — nhiều page-builder (LadiPage, Webflow...) đặt toàn bộ
    // background-image dưới dạng CSS rule (#ID{background-image:url(...)}) trong 1 khối <style>
    // duy nhất thay vì <img>/style="" trên từng thẻ. Base URL để resolve là URL của TRANG (không
    // phải 1 file .css riêng), vì khối này nằm ngay trong tài liệu HTML.
    for (const block of extractInlineStyleBlocks(text)) {
      for (const cssUrl of extractCssUrls(block, resource.finalUrl!)) {
        const stripped = stripFragment(cssUrl.url);
        if (!isHttpUrl(stripped)) continue;
        const normalized = normalizeUrl(stripped, { stripParams: config.stripParams });
        enqueueAsset(normalized, "html", resource.id);
      }
    }
  }

  let robotsDisallow: string[] = [];
  if (!config.ignoreRobots) {
    const robots = await fetchRobotsTxt(origin);
    robotsDisallow = robots.disallow;
    for (const sitemapUrl of robots.sitemaps) {
      const urls = await fetchSitemapUrls(sitemapUrl);
      for (const u of urls) {
        if (isSameOrigin(u, rootUrl)) {
          pageQueue.push({
            url: normalizeUrl(stripFragment(u), { stripParams: config.stripParams }),
            depth: 0,
            discoveredFrom: "sitemap",
          });
        }
      }
    }
  }

  pageQueue.push({ url: stripFragment(rootUrl), depth: 0, discoveredFrom: "html" });

  // Vòng lặp chính: xử lý từng "wave" trang theo BFS; asset được đẩy trực tiếp vào pQueue
  // dùng chung nên onIdle() chờ đúng toàn bộ cascade (trang + asset phát sinh) mỗi wave.
  while (true) {
    let item = pageQueue.next();
    while (item) {
      const { url, depth, discoveredFrom } = item;
      pQueue.add(() => processPage(url, depth, discoveredFrom));
      item = pageQueue.next();
    }
    await pQueue.onIdle();
    if (pageQueue.pending === 0) break;
  }

  // Trang HTML khác đã crawl xong -> rewrite <a href> trỏ giữa chúng với nhau (không chỉ asset),
  // để duyệt được offline giữa các trang chứ không chỉ asset trong 1 trang. KHÔNG dùng dependency
  // graph cho việc này (graph chỉ mô hình asset composition theo mục 8) — dùng map url->localPath riêng.
  const htmlPathByUrl = new Map<string, string>();
  for (const r of graph.all()) {
    if (r.type !== "html" || !r.localPath || (r.state !== "downloaded" && r.state !== "rewritten")) continue;
    htmlPathByUrl.set(r.url, r.localPath);
    if (r.finalUrl) htmlPathByUrl.set(r.finalUrl, r.localPath);
  }

  // Phase 2: rewrite HTML/CSS đã tải, dùng Dependency Graph để tính relative path đúng cho từng file.
  for (const resource of graph.all()) {
    if (resource.state !== "downloaded") continue;
    if (resource.type !== "html" && resource.type !== "css") continue;
    const text = rawTextOf.get(resource.id);
    if (text === undefined || !resource.localPath) continue;

    const resolveMap: ResolveMap = new Map();
    for (const depId of resource.dependencies) {
      const dep = graph.getNode(depId);
      if (!dep || !dep.localPath) continue;
      const relative = path.posix.relative(path.posix.dirname(resource.localPath), dep.localPath);
      resolveMap.set(dep.url, relative);
      if (dep.finalUrl && dep.finalUrl !== dep.url) resolveMap.set(dep.finalUrl, relative);
    }

    if (resource.type === "html") {
      for (const [pageUrl, pageLocalPath] of htmlPathByUrl) {
        if (pageLocalPath === resource.localPath) continue; // khỏi tự-link chính nó
        const relative = path.posix.relative(path.posix.dirname(resource.localPath), pageLocalPath);
        resolveMap.set(pageUrl, relative);
      }
    }

    const rewritten =
      resource.type === "html"
        ? rewriteHtml(text, resource.finalUrl ?? resource.url, resolveMap)
        : rewriteCss(text, resource.finalUrl ?? resource.url, resolveMap);

    const absPath = path.join(outputRoot, resource.localPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, rewritten, "utf-8");
    resource.state = "rewritten";
  }

  await fs.rm(path.join(outputRoot, ".tmp"), { recursive: true, force: true });

  // Phase 3: manifest + audit
  const domainRoot = path.join(outputRoot, sanitizePathSegment(domain));
  await fs.mkdir(path.join(domainRoot, "audit"), { recursive: true });

  const manifest = graph.all().map((r) => ({
    id: r.id,
    url: r.url,
    finalUrl: r.finalUrl,
    localPath: r.localPath,
    type: r.type,
    contentType: r.contentType,
    status: r.status,
    size: r.size,
    sha256: r.sha256,
    sourcePages: r.dependents
      .map((id) => graph.getNode(id))
      .filter((d): d is Resource => !!d && d.type === "html" && !!d.localPath)
      .map((d) => d.localPath as string),
    dependencies: r.dependencies,
    dependents: r.dependents,
    redirectChain: r.redirectChain,
    discoveredFrom: r.discoveredFrom,
    state: r.state,
    blockedReason: r.blockedReason,
    errorType: r.errorType,
  }));
  await fs.writeFile(path.join(domainRoot, "manifest.json"), JSON.stringify(manifest, null, 2));

  await fs.writeFile(
    path.join(domainRoot, "crawl.json"),
    JSON.stringify({ crawlId, rootUrl, startedAt: new Date().toISOString(), options: config }, null, 2)
  );

  const staticResult = await runStaticValidation(graph, outputRoot);
  const offlineReadinessPercent = computeOfflineReadiness(graph, staticResult);
  await fs.writeFile(
    path.join(domainRoot, "audit", "offline.json"),
    JSON.stringify({ ...staticResult, offlineReadinessPercent, note: "Runtime validation cần Playwright (P1)." }, null, 2)
  );

  await fs.writeFile(path.join(domainRoot, "audit", "errors.json"), JSON.stringify(errors, null, 2));

  const minification = [];
  for (const resource of graph.all()) {
    if (resource.state !== "rewritten" || (resource.type !== "js" && resource.type !== "css")) continue;
    if (!resource.localPath) continue;
    const content = await fs.readFile(path.join(outputRoot, resource.localPath), "utf-8").catch(() => null);
    if (content !== null) minification.push(detectMinification(resource.localPath, content));
  }
  // JS không được rewrite (mục 12) nên vẫn còn nguyên trên đĩa từ downloadResource (streamToDisk) nếu type là js
  for (const resource of graph.all()) {
    if (resource.type !== "js" || resource.state !== "downloaded" || !resource.localPath) continue;
    const content = await fs.readFile(path.join(outputRoot, resource.localPath), "utf-8").catch(() => null);
    if (content !== null) minification.push(detectMinification(resource.localPath, content));
  }
  await fs.writeFile(path.join(domainRoot, "audit", "minification.json"), JSON.stringify(minification, null, 2));

  const rootResource = resolveByUrl.get(rootUrl);
  const rootHeadersValue = rootResource ? rootHeaders.get(rootResource.id) ?? {} : {};
  const passiveFindings = auditPassiveSecurity(rootHeadersValue, new URL(rootUrl).protocol === "https:");
  const exposureFindings = config.securityProbe ? await auditExposure(origin) : null;
  await fs.writeFile(
    path.join(domainRoot, "audit", "security.json"),
    JSON.stringify(
      {
        passive: passiveFindings,
        exposure: exposureFindings ?? "skipped (--security-probe không bật)",
        dependencyVulnerability: "not implemented yet (P1, cần advisory database thật)",
      },
      null,
      2
    )
  );

  const technologies = detectTechnologies({
    headers: rootHeadersValue,
    cookies: rootHeadersValue["set-cookie"] ? [rootHeadersValue["set-cookie"]] : [],
    html: rootResource ? rawTextOf.get(rootResource.id) ?? "" : "",
  });
  await fs.writeFile(path.join(domainRoot, "audit", "technologies.json"), JSON.stringify(technologies, null, 2));

  const frontendBackend = splitFrontendBackend(graph, rootUrl);
  await fs.writeFile(
    path.join(domainRoot, "audit", "frontend-backend.json"),
    JSON.stringify(frontendBackend, null, 2)
  );

  await fs.writeFile(
    path.join(domainRoot, "audit", "network.json"),
    JSON.stringify({ note: "Cần --render (P1, xem src/crawler/renderer.ts)", requests: [] }, null, 2)
  );

  const summary = buildSummary({
    technologies,
    minification,
    securityFindings: [...passiveFindings, ...(exposureFindings ?? [])],
    frontendBackend,
    offlineReadinessPercent,
    errors,
  });
  await fs.writeFile(path.join(domainRoot, "audit", "summary.json"), JSON.stringify(summary.json, null, 2));
  await fs.writeFile(path.join(domainRoot, "audit", "summary.md"), summary.markdown);

  if (config.render) await closeRenderer(); // đóng browser để process thoát sạch, không treo

  return {
    crawlId,
    outputRoot,
    domainRoot,
    pagesCrawled: pageCount,
    assetsDownloaded: graph
      .all()
      .filter((r) => r.type !== "html" && (r.state === "downloaded" || r.state === "rewritten")).length,
    errors: errors.length,
    offlineReadinessPercent,
  };
}
