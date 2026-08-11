# Craw_Web

CLI mã nguồn mở để thu thập một website, lưu và tổ chức tài nguyên về máy, thay URL HTML/CSS sang đường dẫn local, rồi tạo báo cáo audit có thể hành động. Công cụ hướng đến các nhu cầu như lưu trữ nội bộ, phân tích cấu trúc website, chuẩn bị bản xem offline và rà soát phụ thuộc front-end.

> Chỉ crawl các website mà bạn sở hữu hoặc đã được cấp quyền. Craw_Web tôn trọng `robots.txt` theo mặc định, không phải công cụ penetration testing và không thực hiện khai thác lỗ hổng.

## Tính năng

- Crawl theo chiều rộng (BFS), giới hạn độ sâu, số trang, số file và dung lượng để tránh crawl vô hạn.
- Tự chuẩn hóa URL, loại bỏ tracking parameter phổ biến, bỏ fragment khi dedupe và lưu redirect chain.
- Phát hiện link trong HTML/CSS, bao gồm ảnh, script, stylesheet, font, media, `srcset`, `@import` và `url(...)`.
- Tải tài nguyên theo luồng (streaming), tạo SHA-256 và lưu asset theo content hash để giảm trùng lặp.
- Rewrite URL trong HTML/CSS để các trang và asset đã tải có thể tham chiếu cục bộ.
- Hỗ trợ render bằng Playwright cho website SPA/lazy-load và ghi nhận request runtime.
- Sinh manifest cùng audit về offline readiness, lỗi crawl, công nghệ nhận diện, minification, security header và phụ thuộc frontend/backend.
- Hỗ trợ robots.txt, sitemap và policy same-origin/cross-origin cho asset.

## Yêu cầu

- Node.js 18 trở lên
- npm
- Chromium của Playwright, chỉ cần khi dùng `--render`

## Cài đặt

```bash
git clone <repository-url>
cd craw-web
npm install
npm run build
```

Chạy trực tiếp trong lúc phát triển:

```bash
npm run dev -- crawl https://example.com
```

Hoặc sau khi build:

```bash
npm start -- crawl https://example.com
```

Có thể cài CLI vào môi trường hiện tại bằng `npm link`, sau đó dùng lệnh `craw-web` ở bất kỳ thư mục nào.

```bash
npm link
craw-web crawl https://example.com
```

## Bắt đầu nhanh

```bash
# Crawl tối đa 2 cấp, lưu vào ./output (mặc định)
npm run dev -- crawl https://example.com

# Lưu vào thư mục riêng, nới độ sâu và giảm tốc độ request
npm run dev -- crawl https://example.com \
  --output ./archives/example \
  --depth 3 \
  --concurrency 3 \
  --delay 500

# Crawl SPA hoặc trang lazy-load
npx playwright install chromium
npm run dev -- crawl https://example.com \
  --render \
  --scroll \
  --max-render-time 45000
```

Khi hoàn tất, CLI in thư mục kết quả và tỷ lệ `Offline readiness`. Mở file HTML đã crawl từ thư mục output qua một HTTP server local để trình duyệt xử lý đường dẫn và chính sách origin nhất quán.

## Cách hoạt động

```text
URL gốc / sitemap / liên kết nội bộ
             │
             ▼
     Chuẩn hóa + queue BFS + robots.txt
             │
             ▼
  Tải HTML, CSS và asset (stream + SHA-256)
             │
             ▼
 Dependency graph → lưu local → rewrite HTML/CSS
             │
             ▼
 Manifest + offline/static audit + báo cáo
```

HTML chỉ được crawl tiếp trong cùng origin. Asset từ CDN/cross-origin vẫn được phép tải theo mặc định; thêm `--same-origin-only` nếu muốn giới hạn toàn bộ tài nguyên vào origin gốc.

## Lệnh crawl

```bash
craw-web crawl <url> [options]
```

| Tuỳ chọn | Mặc định | Mô tả |
| --- | ---: | --- |
| `--depth <n>` | `2` | Độ sâu tối đa khi theo liên kết trang. |
| `--output <dir>` | `./output` | Thư mục lưu kết quả. |
| `--concurrency <n>` | `5` | Số request thực hiện song song. |
| `--delay <ms>` | `200` | Khoảng nghỉ giữa các request. |
| `--max-pages <n>` | `1000` | Số trang HTML tối đa. |
| `--max-files <n>` | `10000` | Tổng số file tối đa. |
| `--max-size <bytes>` | `1073741824` | Tổng dung lượng tối đa (1 GB). |
| `--max-resource-size <bytes>` | `104857600` | Dung lượng tối đa một tài nguyên (100 MB). |
| `--timeout <ms>` | `30000` | Timeout cho mỗi request. |
| `--retry <n>` | `3` | Số lần thử lại khi request lỗi. |
| `--max-query-variants-per-path <n>` | `20` | Chặn bùng nổ URL có query khác nhau. |
| `--strip-param <name>` | — | Bỏ thêm query parameter khi chuẩn hóa; có thể lặp lại cờ này. |
| `--ignore-robots` | `false` | Bỏ qua `robots.txt`. Chỉ dùng khi bạn có quyền. |
| `--same-origin-only` | `false` | Không tải asset từ origin khác. |
| `--include-subdomains` | `false` | Cho phép theo trang ở subdomain cùng site. |
| `--render` | `false` | Render trang bằng Playwright. |
| `--scroll` | `false` | Cuộn khi render để kích hoạt lazy-load. |
| `--scroll-delay <ms>` | `500` | Thời gian nghỉ giữa các lần cuộn. |
| `--wait-for-network-idle` | `true` | Chờ mạng ổn định trong chế độ render. |
| `--max-render-time <ms>` | `30000` | Giới hạn thời gian render mỗi trang. |
| `--max-network-requests <n>` | `500` | Giới hạn request phát sinh khi render. |
| `--security-probe` | `false` | Bật phát hiện exposure thụ động; chỉ dùng khi được phép kiểm tra. |
| `--log-level <level>` | `info` | `debug`, `info`, `warn` hoặc `error`. |
| `--log-file <file>` | — | Đích ghi log (đã dành sẵn trong cấu hình). |

Các parameter tracking phổ biến như `utm_*`, `fbclid`, `gclid`, `msclkid` được loại tự động khi dedupe. Những parameter khác được giữ nguyên vì có thể ảnh hưởng nội dung trang.

## Cấu trúc output

Ví dụ với URL `https://example.com` và `--output ./output`:

```text
output/
├── example.com/
│   ├── index.html
│   ├── about/index.html
│   ├── assets/
│   │   ├── css/
│   │   ├── js/
│   │   ├── images/
│   │   └── fonts/
│   ├── manifest.json
│   ├── crawl.json
│   └── audit/
│       ├── summary.md
│       ├── summary.json
│       ├── offline.json
│       ├── errors.json
│       ├── technologies.json
│       ├── minification.json
│       ├── security.json
│       ├── frontend-backend.json
│       └── network.json
```

`manifest.json` là nguồn dữ liệu đầy đủ nhất cho mỗi resource: URL gốc/final URL, MIME type, HTTP status, local path, kích thước, SHA-256, dependency, redirect chain, nguồn phát hiện và trạng thái xử lý.

## Đọc báo cáo audit

- `audit/summary.md`: bản tóm tắt dễ đọc về stack, offline readiness, lỗi và security finding theo mức độ.
- `audit/offline.json`: kết quả kiểm tra tĩnh các phụ thuộc local và request ngoài còn sót.
- `audit/errors.json`: lỗi mạng/HTTP/parse/write đã phân loại, ví dụ `HTTP_404`, `TIMEOUT`, `ROBOTS_BLOCKED`.
- `audit/technologies.json`: công nghệ được nhận diện kèm confidence và evidence.
- `audit/minification.json`: tín hiệu minify của CSS/JavaScript.
- `audit/security.json`: đánh giá security header thụ động; không phải báo cáo pentest.
- `audit/frontend-backend.json`: phân tách dependency tĩnh, runtime, external và API endpoint đã phát hiện.

Tỷ lệ offline readiness là chỉ số tham khảo từ kiểm tra tĩnh hiện tại. Một website phụ thuộc API, authentication, JavaScript runtime hoặc dịch vụ bên thứ ba vẫn có thể không hoạt động hoàn toàn khi ngắt mạng.

## Trạng thái hiện tại và giới hạn

Phiên bản hiện tại tập trung vào pipeline crawl, tổ chức asset, rewrite HTML/CSS và static audit. Những điểm cần lưu ý:

- JavaScript không bị rewrite bằng regex để tránh làm hỏng bundle; vì vậy SPA phức tạp có thể còn URL runtime trỏ ra ngoài.
- `--render` dùng Playwright để capture runtime, nhưng validation runtime đầy đủ vẫn chưa được nối vào lệnh CLI.
- Các lệnh `craw-web audit <crawl-dir>`, `validate <crawl-dir>` và `resume <crawl-id>` hiện là khung P1 và sẽ báo chưa triển khai.
- Quét lỗ hổng dependency cần advisory database đáng tin cậy và chưa được triển khai; security audit hiện là passive analysis/exposure detection có kiểm soát.

Xem [doc/plan.md](doc/plan.md) để biết đặc tả kỹ thuật, các ranh giới scope và roadmap P0/P1/P2.

## Phát triển

```bash
npm run typecheck
npm run build
```

Các website fixture phục vụ kiểm thử thủ công nằm trong `test-sites/basic` và `test-sites/spa`.

## Sử dụng có trách nhiệm

- Ưu tiên rate limit thấp và luôn tôn trọng `robots.txt`.
- Không bật `--ignore-robots` hay `--security-probe` trên hệ thống khi chưa có quyền rõ ràng.
- Không coi bản mirror là bản sao hoàn chỉnh của dịch vụ động hoặc có đăng nhập.

## License

Dự án hiện được đặt là `UNLICENSED` và `private` trong `package.json`. Hãy xác nhận quyền sử dụng/phân phối với chủ sở hữu trước khi công khai hoặc tái sử dụng.
