// doc/plan.md mục 18.1 — P1: tập signature (header/cookie/meta/global var/pattern) kiểu Wappalyzer.
// Cần curate bộ signature.json thực tế trước khi implement — chưa làm ở bước scaffold này.

export type TechCategory = "language" | "framework" | "cms" | "library" | "server";

export interface Signature {
  name: string;
  category: TechCategory;
  match: {
    headers?: Record<string, RegExp>;
    cookies?: RegExp[];
    metaGenerator?: RegExp;
    htmlPatterns?: RegExp[];
    globalVars?: string[];
  };
}

export const SIGNATURES: Signature[] = [
  // TODO(P1): nạp bộ signature thật, ví dụ:
  // { name: "Next.js", category: "framework", match: { htmlPatterns: [/__NEXT_DATA__/, /\/_next\/static\//] } }
];
