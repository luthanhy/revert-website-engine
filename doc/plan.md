# Craw_Web — Technical Specification v1.0

> Thay thế plan v0.2 trước đó. Không loại bỏ requirement cũ — chỉ làm rõ, bổ sung, và sửa 1 mâu thuẫn (mục 0.4).

## 0. Audit plan v0.2 (trước khi viết spec này)

**Đã có, giữ nguyên:** URL normalization (tracking vs functional param), redirect chain trong manifest, Dependency Graph là core, manifest schema cơ bản, error taxonomy, tech detection có confidence/evidence, security audit chia passive/exposure/vulnerability, CLI khung, output structure, test site list, roadmap 3 tầng P0/P1/P2.

**Thiếu, bổ sung trong spec này:**
- Offline validation trong v0.2 chỉ là **static scan lại HTML/CSS** — chưa chạy thật bằng local server + Playwright để bắt JS runtime error, request còn treo ra ngoài. → mục 14.
- Resource lifecycle / state machine chưa định nghĩa. → mục 4.
- Định nghĩa `origin` và same-origin/cross-origin boundary chưa formal. → mục 7.
- Crawl explosion guard (max query variant/pathname) chưa có. → mục 6.
- Fragment URL handling (`/page#a` vs `/page#b`) chưa nói. → mục 5.
- Inline resource (`<style>`, `<script>` inline, `style="background:url()"`, inline SVG) chưa liệt kê. → mục 9.
- WebSocket/Worker/SharedWorker/Service Worker/Import Map/WASM trong runtime capture & offline validator chưa đầy đủ. → mục 11, 14.
- JS rewrite policy (KHÔNG regex rewrite bừa) chưa được nói rõ trong v0.2. → mục 12.
- MIME detection priority + streaming download (tránh load cả file vào memory) chưa có. → mục 10.
- Manifest thiếu field `discoveredFrom` và `id`. → mục 15.
- Crawl state chưa liệt kê rõ các trạng thái (`queued/running/completed/failed/blocked`). → mục 17.
- robots.txt/sitemap discovery chưa có (chỉ mới nói tôn trọng robots.txt). → mục 6.
- Logging/progress output chưa có. → mục 21.

**Mâu thuẫn cần sửa:**
- v0.2 mục `summary.md` ghi "điểm bảo mật ước tính" (một con số) — mâu thuẫn với nguyên tắc "không tạo security score khi chưa có methodology rõ ràng". → Sửa: dùng thang `CRITICAL/HIGH/MEDIUM/LOW/INFO` theo số lượng finding mỗi mức, không dùng điểm số tổng hợp giả chính xác (mục 18.3).

**Rủi ro giữ lại để theo dõi (không chặn code, nhưng phải biết):** JS rewrite cho SPA phức tạp có thể không bao giờ hoàn hảo 100%; offline runtime validation bằng Playwright làm tăng đáng kể thời gian chạy mỗi crawl.

---

## 1. Mục tiêu & nguyên tắc scope

Xây dựng CLI `craw-web <url>` để crawl, tổ chức asset local, làm cho site chạy được offline, validate thật sự khả năng offline, và sinh audit report (tech stack, frontend/backend, minification, passive security, runtime/API dependency).

**Ranh giới scope (không tự ý mở rộng):**
- Không phải penetration testing tool, không phải vulnerability scanner đầy đủ, không phải website-mirroring platform hoàn chỉnh.
- Security = passive analysis + exposure detection (chỉ khi `--security-probe`) + dependency vulnerability **chỉ khi có advisory database thật** đối chiếu được. Không exploit, không intrusive testing.
- "Offline hoạt động" ≠ "rewrite URL thành công". Phải validate thật.

---

## 2. Kiến trúc tổng quan

```
src/
  cli.ts
  crawler/
    fetcher.ts               # HTTP fetch, retry, timeout, redirect chain, streaming download
    renderer.ts                # Playwright: network capture (fetch/XHR/WS/Worker), scroll, giới hạn thời gian/request
    linkExtractor.ts           # HTML tag coverage đầy đủ + inline resource
    cssExtractor.ts            # url()/@import/@font-face, resolve theo vị trí file CSS
    urlNormalizer.ts           # chuẩn hóa URL, tracking/functional param, fragment
    urlPolicy.ts                # same-origin/cross-origin, explosion guard
    queue.ts                    # BFS theo depth, dedupe
    errorTaxonomy.ts             # phân loại lỗi
    robotsAndSitemap.ts           # robots.txt + sitemap discovery
  graph/
    dependencyGraph.ts            # Resource Dependency Graph (node/edge, xem mục 8)
  organizer/
    pathMapper.ts                  # URL -> local path, content-hash based
    rewriter.ts                     # rewrite HTML/CSS an toàn (KHÔNG rewrite JS bừa, xem mục 12)
    writer.ts                        # ghi file streaming xuống đĩa
  offline/
    localServer.ts                    # local HTTP server tạm để serve crawl output
    staticValidator.ts                 # kiểm tra static: missing asset, broken link, external request còn sót
    runtimeValidator.ts                # load bằng Playwright qua localServer, bắt console/JS error, failed request
  state/
    crawlState.ts                       # SQLite: trạng thái từng URL, hỗ trợ resume
  analyzer/
    techDetector.ts / signatureEngine.ts / evidenceCollector.ts / confidenceScorer.ts
    minifyDetector.ts
    securityAuditor.ts
    stackSplitter.ts                     # static/runtime/external/backend dependency classification
    reportBuilder.ts
  types.ts
  config.ts
doc/
  plan.md
```

---

## 3. Data model — Resource entity

Đơn vị trung tâm xuyên suốt hệ thống (Dependency Graph, manifest, offline validation đều dùng chung entity này):

```ts
interface Resource {
  id: string;                  // uuid hoặc hash ổn định
  url: string;                  // URL gốc phát hiện được
  finalUrl: string;              // sau redirect
  type: "html" | "css" | "js" | "image" | "font" | "video" | "audio" | "other";
  contentType: string;
  status: number | null;         // null nếu chưa fetch / lỗi trước khi có response
  localPath: string | null;
  sha256: string | null;
  source: string;                 // resource nào tham chiếu tới (vd HTML page phát hiện ra CSS này)
  dependencies: string[];          // id của resource mà nó phụ thuộc (CSS -> font)
  dependents: string[];            // id của resource phụ thuộc vào nó (ngược lại dependencies)
  discoveredFrom: "html" | "css" | "runtime" | "sitemap" | "robots";
  state: ResourceState;             // xem mục 4
}
```

## 4. Resource lifecycle (state machine)

```
discovered → queued → fetching → (downloaded | failed | blocked)
downloaded → rewritten → validated
```

- `blocked`: bị chặn bởi robots.txt hoặc vượt crawl boundary (mục 6) — không phải lỗi, là quyết định policy, ghi rõ lý do.
- `failed`: gán `errorTaxonomy` type tương ứng (mục 16).
- `validated`: chỉ áp dụng cho HTML page sau bước offline validation (mục 14) — asset thường dừng ở `rewritten`.

Trạng thái này được lưu trong `crawl-state.db` (mục 17) để hỗ trợ resume — resume nghĩa là tiếp tục các resource đang ở `queued`/`discovered`, retry `failed` (nếu còn quota retry), bỏ qua `downloaded`/`rewritten`/`validated`.

**Integrity check khi resume**: nếu process crash giữa lúc đang ghi file (`fetching`/`downloaded` dở dang), file trên đĩa có thể rỗng hoặc thiếu, còn `crawl-state.db` vẫn ghi state cũ. Trước khi coi một resource ở state `downloaded`/`rewritten` là "đã xong" khi resume, **phải verify**: file tồn tại trên đĩa **và** `sha256` thực tế của file khớp với `sha256` đã lưu trong manifest. Nếu không khớp/không tồn tại → reset về `queued` và tải lại, không tin tưởng state cũ một cách mù quáng.

---

## 5. URL Policy

- **Normalization**: lowercase host, loại bỏ default port (`:80`/`:443`), giữ nguyên path case, decode-encode nhất quán.
- **Tracking vs functional query param**: danh sách tracking mặc định (`utm_*`, `fbclid`, `gclid`, `msclkid`...) bị loại khi normalize để dedupe; mọi param khác coi là functional và giữ nguyên (không đoán thêm — nếu user biết param nào là tracking riêng của site, cấu hình qua `--strip-param`).
- **Fragment**: `/page#a`, `/page#b`, `/page` → cùng một resource để **crawl** (fetch 1 lần), nhưng khi **rewrite** link trong HTML, giữ nguyên fragment gốc trỏ tới local path tương ứng (`page.html#a`).
- **`<base href>`**: phải đọc trước khi resolve bất kỳ URL tương đối nào khác trong trang.
- **Redirect**: lưu full chain `url → ... → finalUrl`; dedupe theo `finalUrl` (không tải lại nếu `finalUrl` đã có), nhưng vẫn ghi `url` gốc vào `sourcePages`/`dependents` liên quan.
- **HTTP↔HTTPS, www/non-www**: coi là URL khác nhau ở tầng fetch (không tự gộp), nhưng nếu sau khi fetch phát hiện redirect giữa 2 dạng này, dedupe theo `finalUrl` như trên xử lý tự nhiên trường hợp này.

## 6. Crawl boundary / chống crawl explosion

```
--depth N                       độ sâu tối đa từ URL gốc
--max-pages N                   tổng số trang HTML tối đa
--max-query-variants-per-path N  giới hạn số biến thể query string khác nhau/pathname (chặn /search?q=a,aa,aaa,... vô hạn)
--max-files N
--max-size 1GB                  tổng dung lượng
--max-resource-size 100MB       giới hạn 1 file đơn lẻ
--max-render-time 30s
--max-network-requests N
```

Khi vượt giới hạn: resource chuyển state `blocked` (không phải `failed`), lý do ghi cụ thể (`MAX_QUERY_VARIANTS_EXCEEDED`, `MAX_PAGES_EXCEEDED`...) để phân biệt với lỗi mạng thật.

**robots.txt / sitemap**: mặc định tôn trọng robots.txt (`--ignore-robots` để bỏ qua). Trước khi crawl, đọc `robots.txt` của origin gốc; nếu có dòng `Sitemap: <url>`, tải sitemap đó (và sitemap index nếu là index lồng nhau) làm **seed phụ** — đưa toàn bộ URL trong sitemap vào queue ngay từ đầu, song song với việc crawl theo link nội bộ (`<a href>`). Đây là cách duy nhất bắt được các trang không có internal link nào trỏ tới (orphan page). URL từ sitemap **không được miễn trừ** khỏi `--depth`/`--max-pages`/mọi giới hạn khác ở mục này — chỉ là thêm điểm khởi đầu, không phải bỏ qua boundary.

## 7. Same-origin / cross-origin policy

`origin = scheme + host + port`.

- **HTML crawl** (theo link `<a>` để crawl tiếp): mặc định **same-origin only**.
- **Asset download** (ảnh, CSS, JS, font từ CDN...): mặc định **cross-origin allowed** — tải về nhưng không crawl tiếp HTML nào nằm trên origin đó.
- Cờ mở rộng: `--same-origin-only` (tắt cả cross-origin asset), `--same-site` (cho phép subdomain cùng site), `--include-subdomains`.

---

## 8. Resource Dependency Graph

Node = `Resource` (mục 3). Cạnh = quan hệ phụ thuộc, ví dụ:

```
index.html
 ├── app.css
 │    ├── font.woff2
 │    ├── bg.webp
 │    └── theme.css (@import)
 ├── app.js
 │    ├── chunk.js (dynamic import)
 │    ├── worker.js
 │    └── API (runtime, không download — chỉ ghi nhận)
 └── image.webp
```

Graph phục vụ: dedupe, rewrite (biết resource nào cần sửa link tới resource nào), offline validation (duyệt graph để tìm asset thiếu), resume (biết resource nào đã downloaded thuộc page nào), report (`assets.json`/`pages.json`).

---

## 9. HTML / CSS / Inline resource extraction

**HTML tag coverage:**
```
a, img (src/srcset), picture/source, script[src], link[href]
(css/favicon/preload/modulepreload/prefetch/manifest),
video, audio, track, iframe, object, embed,
form[action], input[type=image], video[poster],
meta[property=og:image], base[href]
```

**Inline resource — không được bỏ sót:**
```
<style>...</style>                inline CSS block trong HTML, parse như file CSS riêng
<script>...</script>               inline JS: không rewrite, chỉ scan tìm URL literal để ghi Dependency Graph (mục 12)
style="background:url(...)"         inline style attribute
inline SVG                           <svg> trực tiếp trong HTML, kể cả <use href>
```

**Bỏ qua protocol không phải `http`/`https` khi extract link để crawl/tải:**
```
mailto:, tel:, javascript:, data:
```
Riêng `data:` URI: **giữ nguyên trong HTML/CSS, không tải, không rewrite** — nó đã tự chứa nội dung, không phải resource bên ngoài.

**CSS extraction**: `url(...)`, `@import` (kể cả nested @import), `@font-face`. URL tương đối phải resolve **theo vị trí file CSS**, không theo vị trí HTML gọi nó:

```
/page/index.html
/assets/css/app.css
/assets/fonts/a.woff2
→ url("../fonts/a.woff2") trong app.css resolve thành /assets/fonts/a.woff2 (đúng)
  KHÔNG resolve theo /page/ (sai)
```

---

## 10. MIME / Content-Type / Encoding / Streaming

Thứ tự ưu tiên xác định resource type: **1) `Content-Type` header → 2) URL extension → 3) content sniffing/magic bytes → 4) `unknown`**.

Hỗ trợ giải nén response theo `Content-Encoding` (`gzip`, `br`, `deflate`) và đọc đúng `charset` khi parse HTML/CSS (không mặc định UTF-8 cứng).

Download phải **stream xuống đĩa**, hash song song trong lúc stream (`HTTP stream → hash → disk`), không buffer toàn bộ file vào memory — bắt buộc với file video/font lớn.

**Xác định extension khi lưu file theo content-hash**: nhiều asset không có extension trong URL (`/img?id=5`) hoặc extension sai lệch so với nội dung thật. Quy tắc: extension của file lưu trên đĩa lấy từ **`Content-Type` header** (map qua bảng MIME→extension chuẩn, vd `image/webp`→`.webp`), **không lấy trực tiếp từ URL**. URL extension chỉ dùng làm gợi ý phụ khi `Content-Type` thiếu/không xác định (`application/octet-stream`).

**Encoding trước khi parse**: phải xác định charset **trước khi decode buffer thành string** để đưa vào cheerio/css-tree — nếu decode sai (vd trang dùng `Shift_JIS`/`GBK` nhưng ép UTF-8) parser sẽ ra kết quả sai mà không báo lỗi rõ ràng. Thứ tự xác định charset: **1) `Content-Type` header (`charset=...`) → 2) `<meta charset>` / `<meta http-equiv="Content-Type">` trong HTML (đọc phần đầu buffer dạng byte trước khi decode toàn bộ) → 3) mặc định UTF-8**. Dùng thư viện detect/convert (`iconv-lite`) để decode đúng trước khi đưa vào parser.

---

## 11. Runtime (SPA) behavior & capture — `--render`

Dùng Playwright. Bắt buộc capture:
```
fetch, XHR, WebSocket, dynamic import(), Worker, SharedWorker, Service Worker
```

Điều kiện dừng (bắt buộc có giới hạn cứng, tránh SPA tạo request vô hạn):
```
--wait-for-network-idle
--max-render-time 30s
--max-network-requests N
--scroll                  kích hoạt lazy-load (data-src, IntersectionObserver)
--scroll-delay 500
```

Mọi request runtime bắt được được ghi vào Dependency Graph với `discoveredFrom: "runtime"`, và phân loại theo mục 13 (static/runtime/external/backend) — không tự động download mọi thứ bắt được (ví dụ request tới API trả JSON động thì ghi nhận, không cần "download" như asset tĩnh).

---

## 12. JavaScript rewrite policy

**MVP: không rewrite nội dung JS bằng regex tùy tiện.** Lý do: rewrite sai một JS có thể phá vỡ toàn bộ site, và không có cách nào regex đảm bảo đúng 100% với code đã minify/obfuscate.

MVP chỉ làm:
```
detect URL/dependency trong JS (string literal, import(), fetch(), new URL()...)
  ↓ ghi vào Dependency Graph (không rewrite)
  ↓ download resource nếu match được (best-effort, không bắt buộc)
  ↓ report runtime dependency trong frontend-backend.json
```

**P1**: có thể bổ sung AST-based rewrite (dùng `acorn`/`babel` parse thật, không regex) **chỉ cho các pattern an toàn, nhận diện chắc chắn**: `import()`, `new URL(...)`, `fetch(...)`, `Worker(...)`, `new XMLHttpRequest().open(...)`. Bất kỳ pattern nào không chắc chắn → bỏ qua, không rewrite, chỉ report.

---

## 13. Backend/API dependency classification

Không được kết luận "Offline: PASS" nếu trang còn gọi `fetch("/api/user")` — đó là **backend dependency**, không thể chạy offline dù rewrite hoàn hảo.

`frontend-backend.json` phải phân biệt rõ 4 loại:
```
Static dependency     — asset đã tải về, rewrite thành công, chạy offline được
Runtime dependency     — phát sinh lúc chạy JS nhưng vẫn resolve được thành local asset
External dependency     — vẫn trỏ ra ngoài có chủ đích (vd CDN font, analytics) — không coi là lỗi nhưng phải liệt kê
Backend dependency       — gọi API cần server thật (REST/GraphQL/WebSocket) — không thể offline
```

Ví dụ output:
```
API:
  GET /api/products
  POST /api/login
  GraphQL: /graphql
  WebSocket: wss://example.com/ws
```

**Không lưu credential/token/Authorization header trong bất kỳ report nào.**

---

## 14. Offline validation — Static + Runtime

**Không coi rewrite URL thành công = offline hoạt động thành công.** Phải chạy thật:

```
crawl output
    ↓
Static Validation (staticValidator.ts) — quét file, không cần server
    ↓
temporary localhost server (localServer.ts) serve thư mục output
    ↓
Playwright load từng trang qua localhost (runtimeValidator.ts)
    ↓
capture: network request, console error, JS error, failed request,
         external request còn sót, CSP/SRI/Worker/Service Worker/
         Import Map/WASM (các cơ chế có thể khiến trang "trông như rewrite
         xong" nhưng vẫn không chạy offline được)
```

**Không dùng `file://` để validate runtime** — nhiều behavior trình duyệt (fetch relative path, module script, Service Worker) không hoạt động đúng qua `file://`, phải qua HTTP thật (dù là localhost).

Report phân biệt rõ:
```
Static Offline Validation    — missing local asset, broken local link
Runtime Offline Validation    — JS error, failed request khi thực sự load trang
Backend/API Dependency         — liệt kê từ mục 13
External Dependency             — liệt kê từ mục 13
```

Ví dụ output (`audit/offline.json` + phần trong `summary.md`):
```
Offline Readiness
-----------------
Static assets:          PASS
Broken local links:     0
Missing assets:         2
External requests:      3
Runtime JS errors:      1
Backend dependencies:   4

Overall: 82%   (công thức cụ thể, xem bên dưới —
                 KHÔNG phải điểm bảo mật hay điểm "chất lượng" chủ quan, xem mục 18.3)
```

**Công thức "Offline Readiness %"** (phải cố định, để `test-sites/` có expected number chính xác, không phải số ước lượng):

```
Offline Readiness % = (số resource ở state "rewritten"/"downloaded" mà offline validator
                        xác nhận resolve OK) / (tổng số resource CÓ localPath cố tình được tải,
                        tức state != "discovered")
```

- **Mẫu số loại backend/API dependency** (resource cố tình chưa từng tải — API call, WebSocket phát hiện lúc `--render`, luôn dừng ở state `"discovered"`, không có `localPath`). Dùng `state === "discovered"` làm điều kiện loại, **không dùng** `discoveredFrom === "runtime"` — vì asset tĩnh (ảnh/CSS/JS) được **phát hiện qua Playwright** (vd lazy-load, chunk JS inject sau khi hydrate) vẫn tải/rewrite bình thường và **nên được tính** vào offline readiness; chỉ resource thật sự chưa từng tải (backend call) mới bị loại. Tính vào backend call sẽ khiến % luôn thấp giả tạo với mọi SPA dù rewrite hoàn hảo.
- Runtime dependency được báo cáo **riêng** như số liệu tuyệt đối (`Backend dependencies: 4`, `Runtime JS errors: 1`) bên cạnh %, không gộp vào công thức.
- Một resource tính là "resolve OK" khi: file tồn tại trên đĩa, `sha256` khớp manifest (xem integrity check mục 4), và không xuất hiện trong danh sách `missingAssets`/`externalRequests` khi runtime-validate.

---

## 15. Manifest schema

```json
{
  "id": "res_9f1c...",
  "url": "https://example.com/app.js",
  "finalUrl": "https://cdn.example.com/app.js",
  "localPath": "assets/js/app-a82f92.js",
  "type": "javascript",
  "contentType": "application/javascript",
  "status": 200,
  "size": 183921,
  "sha256": "...",
  "sourcePages": ["html/index.html"],
  "dependencies": ["res_b1e4..."],
  "dependents": ["res_00a1..."],
  "redirectChain": ["https://example.com/app.js", "https://cdn.example.com/app.js"],
  "discoveredFrom": "html",
  "state": "rewritten"
}
```

**Không bao giờ chứa**: cookie, password, access token, Authorization header — kể cả khi crawl bằng `--storage-state`.

**Cross-platform path constraints (`pathMapper.ts`)**: vì `localPath` dùng content-hash + có thể lồng theo domain/asset-type, cần đảm bảo path hợp lệ trên Windows khi tool chạy cross-platform:
- Tổng độ dài path tuyệt đối (`output/<domain>/assets/...`) phải kiểm tra dưới giới hạn ~260 ký tự của Windows (trừ khi bật long path support) — nếu vượt, rút gọn bằng cách chỉ dùng content-hash làm tên file (bỏ phần tên gốc dài) thay vì giữ nguyên tên URL.
- Loại bỏ/encode các ký tự cấm trên Windows trong mọi phần path sinh ra từ domain/URL: `: * ? " < > |` (và ký tự điều khiển) — content-hash filename tự nhiên đã an toàn vì chỉ gồm hex, nhưng tên thư mục theo domain (vd domain có port `example.com:8080`) phải encode dấu `:`.
- `pathMapper.ts` phải có test riêng cho domain có port, path có ký tự Unicode, và path dài để đảm bảo portable.

---

## 16. Error model

```
DNS_ERROR, TLS_ERROR, TIMEOUT, HTTP_403, HTTP_404, HTTP_429, HTTP_5XX,
REDIRECT_LIMIT, ROBOTS_BLOCKED, MAX_SIZE_EXCEEDED, MAX_QUERY_VARIANTS_EXCEEDED,
PARSE_ERROR, WRITE_ERROR, INVALID_CONTENT
```

Mỗi record: `url`, `type`, `status`, `message`, `retryCount`, `timestamp` → `audit/errors.json`. Trạng thái `blocked` (mục 6) ghi riêng, không lẫn vào lỗi mạng thật.

---

## 17. Crawl state & resume

SQLite (`crawl-state.db`), 1 bảng resource theo `crawl-id`, cột `state` nhận giá trị: `queued | running | completed | failed | blocked` (khớp state machine mục 4, "running/completed" tương ứng fetching/downloaded ở tầng resource, nhưng ở tầng crawl-job tổng thể dùng 4 trạng thái này để CLI report tiến trình).

```bash
craw-web resume <crawl-id>
```
Resume: tiếp tục `queued`, retry `failed` còn quota, bỏ qua `completed`.

---

## 18. Audit schema

Thư mục `audit/` sinh sau mỗi crawl:

### 18.1 `technologies.json`
Mỗi kết quả: `name`, `category` (language/framework/CMS/library/server), `confidence` (0–100), `evidence` (mảng bằng chứng cụ thể). **Nếu evidence không đủ → `"Unknown"`, không cố đoán.** Kiến trúc: `signatureEngine` (tập signature) + `evidenceCollector` + `confidenceScorer`.

### 18.2 `minification.json`
```json
{ "file": "app.js", "minified": true, "confidence": 0.97, "sourceMap": true,
  "avgLineLength": 812, "whitespaceRatio": 0.02, "commentRatio": 0.0 }
```

### 18.3 `security.json`
3 tầng, chỉ passive/consented — **không dùng điểm số tổng hợp giả chính xác** (sửa mâu thuẫn mục 0). Mỗi finding gắn severity `CRITICAL | HIGH | MEDIUM | LOW | INFO`:
- **Passive**: HTTPS/TLS, HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, cookie Secure/HttpOnly/SameSite.
- **Exposure detection** (chỉ khi `--security-probe`): `.env`, `.git`, backup file, source map lộ, debug endpoint, directory listing, config file.
- **Dependency vulnerability**: chỉ gắn cờ khi đối chiếu được advisory database thật — không suy đoán CVE từ tên/version.

### 18.4 `frontend-backend.json`
Theo mục 13: frontend framework/SPA hay SSR/static, static/runtime/external/backend dependency, danh sách API endpoint.

### 18.5 `offline.json`
Theo mục 14: static + runtime offline validation result.

### 18.6 `assets.json` / `pages.json` / `network.json`
Dữ liệu chi tiết từ Dependency Graph + network capture — phục vụ debug và web UI (P2).

### 18.7 `errors.json`
Theo mục 16.

### 18.8 `summary.json` + `summary.md`
Tổng hợp: stack tổng quan, offline readiness % (số đo được, mục 14), số finding theo từng severity (không phải điểm số đơn), cảnh báo quan trọng nhất.

---

## 19. Security scope (nhắc lại rõ ràng)

Passive security analysis + exposure detection (khi `--security-probe`) + dependency vulnerability (chỉ khi có advisory thật). **Không exploit, không intrusive testing, không tự nhận là pentest tool.**

---

## 20. CLI specification

```bash
craw-web crawl <url> \
  --depth 2 \
  --output ./output \
  --concurrency 5 \
  --delay 200 \
  --render \
  --scroll \
  --scroll-delay 500 \
  --wait-for-network-idle \
  --max-render-time 30s \
  --max-network-requests 500 \
  --max-pages 1000 \
  --max-query-variants-per-path 20 \
  --max-files 10000 \
  --max-size 1GB \
  --max-resource-size 100MB \
  --timeout 30s \
  --retry 3 \
  --ignore-robots \
  --same-origin-only \
  --include-subdomains \
  --strip-param <name> \
  --storage-state auth.json \
  --security-probe \
  --log-level info \
  --log-file crawl.log

craw-web audit <crawl-dir>
craw-web validate <crawl-dir>     # chạy lại offline validation (static + runtime)
craw-web resume <crawl-id>
```

## 21. Logging & progress

```
--log-level debug|info|warn|error
--log-file crawl.log
```
Progress hiển thị realtime khi crawl:
```
Pages: 1,284   Assets: 8,492   Downloaded: 8,201   Failed: 291   Queue: 183   Speed: 12 req/s
```

## 22. Output structure

```
output/
└── example.com/
    ├── html/
    ├── assets/{css,js,images,fonts,videos}/
    ├── manifest.json
    ├── crawl.json                 # crawl-id, thời gian, options dùng
    └── audit/
        ├── summary.json
        ├── summary.md
        ├── technologies.json
        ├── security.json
        ├── frontend-backend.json
        ├── offline.json
        ├── assets.json
        ├── pages.json
        ├── network.json
        ├── minification.json
        └── errors.json
```

## 23. Test strategy

```
test-sites/
├── basic/              # Pages=5, CSS=3, JS=8, Images=12, Missing=0, Broken=0
├── css-nested/          # @import lồng nhau, url() resolve theo vị trí CSS
├── spa/                 # --render, network capture, API classification
├── lazy-loading/         # data-src, --scroll
├── redirects/            # redirect chain, dedupe theo finalUrl
├── srcset/                # nhiều ảnh/1 attribute
├── iframe/
├── service-worker/        # offline validation phải flag runtime dependency + CSP/SRI
├── authentication/         # --storage-state, không lưu credential vào report
├── broken-assets/           # 404, error taxonomy
└── large-site/               # resume + crawl state + crawl explosion guard
```

Bắt buộc có test end-to-end:
```
crawl → rewrite → local HTTP server → Playwright → offline validation (static + runtime)
```

## 24. Roadmap

### P0 — MVP (pipeline lõi phải đáng tin cậy trước khi làm gì khác)
```
URL normalization → crawl → extract (HTML/CSS/inline) → dedupe (URL + content hash)
→ download (streaming) → Dependency Graph → rewrite (HTML/CSS only, không rewrite JS)
→ manifest → offline static validation → offline runtime validation (local server + Playwright)
```
Bao gồm: crawl boundary/explosion guard, error taxonomy, same-origin/cross-origin policy, fragment handling.

### P1 — Production
```
[ĐÃ XONG] --render qua Playwright: network capture (fetch/XHR/websocket), phân loại
          asset (tải) vs backend dependency (chỉ ghi nhận), --scroll cho lazy-load,
          giới hạn --max-render-time/--max-network-requests. Xem crawler/renderer.ts.
          Worker/SharedWorker/Service Worker: chưa capture riêng (chỉ websocket/xhr/fetch).

SQLite resume · authentication/session
Service Worker/PWA detection (audit riêng, khác network capture ở trên) · technology evidence/confidence
security audit đầy đủ (3 tầng) · minification confidence
AST-based JS rewrite cho pattern an toàn · test suite đầy đủ
```

### P2 — Sau này
```
Web UI · HTML report / interactive asset browser
Vulnerability database integration đầy đủ · Plugin system
```

---

## 25. Đánh giá cuối — trước khi bắt đầu implement

**1) Đã đủ để code ngay:**
URL normalization/policy, fetcher + redirect chain, HTML/CSS extractor (coverage đầy đủ theo mục 9), Dependency Graph model, path mapper theo content hash, rewriter cho HTML/CSS, manifest schema, error taxonomy, crawl boundary/explosion guard, CLI flags cho crawl cơ bản.

**2) Còn cần quyết định trước khi code phần liên quan (không chặn P0 bắt đầu, nhưng chặn đúng module đó):**
- Local HTTP server dùng framework nào cho `localServer.ts` (Node `http` thuần hay Express nhẹ) — không ảnh hưởng thiết kế, chỉ là lựa chọn implementation.
- Danh sách tracking-param mặc định cụ thể (`utm_*`, `fbclid`, `gclid`...) — cần chốt list đầy đủ trước khi code `urlNormalizer.ts`.
- Advisory database nào dùng cho dependency vulnerability ở P1 (chưa cần quyết định ngay vì đây là P1, không chặn P0).
- Ngưỡng cụ thể cho `minified: true/false` confidence (bao nhiêu % thì coi là minified) — cần chốt trước khi code `minifyDetector.ts` (P1).

**3) Assumption đang dùng (nếu sai cần sửa spec):**
- Giả định target là crawl **website public**, không cần auth cho MVP (auth đẩy sang P1).
- Giả định người dùng chạy tool trên site họ **có quyền crawl** (tôn trọng robots.txt mặc định, security-probe cần bật tường minh).
- Giả định Node.js + Playwright chạy được trong môi trường triển khai (đủ tài nguyên cho browser headless).
- Giả định output chạy trên máy có Node để serve `localServer.ts` khi cần validate/mở lại — không phải "double click mở file" thuần túy (vì đã bỏ `file://`).

**4) Rủi ro còn tồn tại (đã biết, chấp nhận, theo dõi):**
- JS rewrite không bao giờ hoàn hảo 100% với site SPA phức tạp/obfuscated — offline readiness % có thể không bao giờ đạt 100% với site như vậy, đây là giới hạn kỹ thuật thật, không phải bug.
- Offline runtime validation (Playwright) làm tăng đáng kể thời gian mỗi lần crawl — cần cân nhắc chạy validation async/optional (`craw-web validate` tách riêng) thay vì luôn chạy trong `crawl`.
- Crawl explosion guard dựa trên heuristic (max variant/pathname) có thể vẫn bỏ sót site có pattern URL bất thường — cần theo dõi thực tế khi test trên site lớn.
- Tech detection dựa trên signature tĩnh sẽ luôn có site không nhận diện được (trả `Unknown`) — chấp nhận được, đúng nguyên tắc không đoán bừa.

**5) Checklist trước khi implementation:**
```
[ ] Chốt danh sách tracking-param mặc định
[ ] Chốt cấu trúc project (package.json, tsconfig, eslint) theo module tree mục 2
[ ] Dựng test-sites/basic/ trước tiên (test case đơn giản nhất) để có baseline
[ ] Implement theo đúng thứ tự P0 trong mục 24 — không nhảy sang Playwright/audit trước
[ ] Xác nhận môi trường có thể chạy Playwright headless (browser binary cài được)
[ ] Xác nhận phạm vi pháp lý: chỉ crawl site được phép (ToS, robots.txt, hoặc site của chính người dùng)
```
