// doc/plan.md mục 9: url()/@import/@font-face — resolve theo vị trí file CSS, không theo HTML gọi nó.

import * as csstree from "css-tree";
import { resolveUrl } from "./urlNormalizer";

export interface ExtractedCssUrl {
  url: string;
  kind: "url" | "import";
}

export function extractCssUrls(css: string, cssFileUrl: string): ExtractedCssUrl[] {
  const results: ExtractedCssUrl[] = [];
  let ast: csstree.CssNode;
  try {
    ast = csstree.parse(css, { positions: false });
  } catch {
    return results;
  }

  csstree.walk(ast, (node) => {
    if (node.type === "Url") {
      const raw = node.value;
      if (raw.startsWith("data:")) return;
      const resolved = resolveUrl(raw, cssFileUrl);
      if (resolved) results.push({ url: resolved, kind: "url" });
    } else if (node.type === "Atrule" && node.name === "import") {
      const preludeStr = node.prelude ? csstree.generate(node.prelude) : "";
      const match = preludeStr.match(/url\((['"]?)([^'")]+)\1\)|^\s*(['"])([^'"]+)\3/);
      const raw = match?.[2] ?? match?.[4];
      if (raw && !raw.startsWith("data:")) {
        const resolved = resolveUrl(raw, cssFileUrl);
        if (resolved) results.push({ url: resolved, kind: "import" });
      }
    }
  });

  return results;
}
