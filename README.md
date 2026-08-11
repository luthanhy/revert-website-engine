# revert-website-engine

An open-source CLI for crawling a website, saving and organizing its assets locally, rewriting HTML/CSS URLs to local paths, and producing actionable audit reports. It is designed for internal archiving, website-structure analysis, offline preview preparation, and front-end dependency review.

> Only crawl websites that you own or are authorized to access. revert-website-engine respects `robots.txt` by default; it is not a penetration-testing tool and does not exploit vulnerabilities.

## Features

- Breadth-first crawling (BFS) with depth, page, file, and size limits to prevent runaway crawls.
- URL normalization, common tracking-parameter removal, fragment deduplication, and redirect-chain tracking.
- HTML and CSS link discovery, including images, scripts, stylesheets, fonts, media, `srcset`, `@import`, and `url(...)`.
- Streaming downloads with SHA-256 hashing and content-hash asset storage to reduce duplicates.
- HTML/CSS URL rewriting so downloaded pages and assets can reference local files.
- Playwright rendering for SPA/lazy-loaded websites, with runtime-request capture.
- Manifest generation and audits for offline readiness, crawl errors, detected technologies, minification, security headers, and frontend/backend dependencies.
- `robots.txt`, sitemap, same-origin, and cross-origin asset policies.

## Requirements

- Node.js 18 or newer
- npm
- Playwright Chromium, only when using `--render`

## Installation

```bash
git clone <repository-url>
cd revert-website-engine
npm install
npm run build
```

Run directly during development:

```bash
npm run dev -- crawl https://example.com
```

Or run the compiled CLI:

```bash
npm start -- crawl https://example.com
```

To make the CLI available from any directory in your local environment:

```bash
npm link
craw-web crawl https://example.com
```

## Quick start

```bash
# Crawl up to two levels deep and write to ./output (default)
npm run dev -- crawl https://example.com

# Use a custom output directory, deeper crawl, and a slower request rate
npm run dev -- crawl https://example.com \
  --output ./archives/example \
  --depth 3 \
  --concurrency 3 \
  --delay 500

# Crawl an SPA or a lazy-loaded website
npx playwright install chromium
npm run dev -- crawl https://example.com \
  --render \
  --scroll \
  --max-render-time 45000
```

When the crawl is complete, the CLI prints the output directory and the `Offline readiness` percentage. Serve the crawled HTML through a local HTTP server to handle paths and browser origin policies consistently.

## How it works

```text
Root URL / sitemap / internal links
             │
             ▼
 URL normalization + BFS queue + robots.txt
             │
             ▼
 Download HTML, CSS, and assets (stream + SHA-256)
             │
             ▼
 Dependency graph → local storage → HTML/CSS rewrite
             │
             ▼
 Manifest + static/offline audit + reports
```

Only same-origin HTML pages are crawled further. By default, assets hosted on CDNs or other origins may still be downloaded. Use `--same-origin-only` to restrict every resource to the root origin.

## Crawl command

```bash
craw-web crawl <url> [options]
```

| Option | Default | Description |
| --- | ---: | --- |
| `--depth <n>` | `2` | Maximum depth while following page links. |
| `--output <dir>` | `./output` | Output directory. |
| `--concurrency <n>` | `5` | Number of concurrent requests. |
| `--delay <ms>` | `200` | Delay between requests. |
| `--max-pages <n>` | `1000` | Maximum number of HTML pages. |
| `--max-files <n>` | `10000` | Maximum total number of files. |
| `--max-size <bytes>` | `1073741824` | Maximum total download size (1 GB). |
| `--max-resource-size <bytes>` | `104857600` | Maximum size of one resource (100 MB). |
| `--timeout <ms>` | `30000` | Timeout for each request. |
| `--retry <n>` | `3` | Number of retries after a request failure. |
| `--max-query-variants-per-path <n>` | `20` | Prevents excessive query-string variants per path. |
| `--strip-param <name>` | — | Removes an additional query parameter during normalization; repeatable. |
| `--ignore-robots` | `false` | Ignores `robots.txt`. Use only when authorized. |
| `--same-origin-only` | `false` | Does not download assets from other origins. |
| `--include-subdomains` | `false` | Allows following pages on same-site subdomains. |
| `--render` | `false` | Renders pages with Playwright. |
| `--scroll` | `false` | Scrolls rendered pages to activate lazy-loaded content. |
| `--scroll-delay <ms>` | `500` | Delay between scroll events. |
| `--wait-for-network-idle` | `true` | Waits for network idle in render mode. |
| `--max-render-time <ms>` | `30000` | Maximum render time per page. |
| `--max-network-requests <n>` | `500` | Maximum requests generated while rendering. |
| `--security-probe` | `false` | Enables controlled exposure detection; use only with permission. |
| `--log-level <level>` | `info` | One of `debug`, `info`, `warn`, or `error`. |
| `--log-file <file>` | — | Log destination reserved in the current configuration. |

Common tracking parameters such as `utm_*`, `fbclid`, `gclid`, and `msclkid` are removed automatically during deduplication. Other parameters are preserved because they may affect page content.

## Output structure

For `https://example.com` with `--output ./output`:

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

`manifest.json` is the most complete per-resource data source: original/final URL, MIME type, HTTP status, local path, size, SHA-256, dependencies, redirect chain, discovery source, and processing state.

## Audit reports

- `audit/summary.md`: readable summary of the detected stack, offline readiness, errors, and security findings by severity.
- `audit/offline.json`: static validation results for local dependencies and remaining external requests.
- `audit/errors.json`: categorized network, HTTP, parsing, and write errors such as `HTTP_404`, `TIMEOUT`, and `ROBOTS_BLOCKED`.
- `audit/technologies.json`: detected technologies with confidence and evidence.
- `audit/minification.json`: CSS and JavaScript minification signals.
- `audit/security.json`: passive security-header assessment; it is not a penetration-test report.
- `audit/frontend-backend.json`: static, runtime, external, and discovered API dependencies.

Offline readiness is an indicator based on the current static validation. A website that depends on APIs, authentication, JavaScript runtime behavior, or third-party services may still not function fully without a network connection.

## Current status and limitations

The current release focuses on crawling, asset organization, HTML/CSS rewriting, and static auditing. Keep the following in mind:

- JavaScript is deliberately not regex-rewritten to avoid breaking bundles, so complex SPAs may still contain runtime URLs that point externally.
- `--render` uses Playwright to capture runtime activity, but complete runtime validation is not yet wired into the CLI.
- `craw-web audit <crawl-dir>`, `validate <crawl-dir>`, and `resume <crawl-id>` are currently P1 command stubs and report that they are not implemented.
- Dependency vulnerability scanning requires a trustworthy advisory database and is not yet implemented. The current security audit is controlled passive analysis and exposure detection.

See [doc/plan.md](doc/plan.md) for the technical specification, scope boundaries, and P0/P1/P2 roadmap.

## Development

```bash
npm run typecheck
npm run build
```

Manual test fixtures are available in `test-sites/basic` and `test-sites/spa`.

## Responsible use

- Prefer a low request rate and always respect `robots.txt`.
- Do not use `--ignore-robots` or `--security-probe` on systems without clear authorization.
- Do not treat a local mirror as a complete copy of a dynamic or authenticated service.

## License

The project is currently marked as `UNLICENSED` and `private` in `package.json`. Confirm distribution and reuse rights with the owner before publishing or reusing it.
