// doc/plan.md mục 18.1 — P1: thu thập bằng chứng khớp cho từng signature.

import { Signature } from "./signatureEngine";

export interface Evidence {
  description: string;
  source: "header" | "cookie" | "meta" | "html" | "global-var";
}

export interface PageContext {
  headers: Record<string, string>;
  cookies: string[];
  html: string;
}

export function collectEvidence(signature: Signature, ctx: PageContext): Evidence[] {
  const evidence: Evidence[] = [];

  if (signature.match.headers) {
    for (const [name, pattern] of Object.entries(signature.match.headers)) {
      const value = ctx.headers[name.toLowerCase()];
      if (value && pattern.test(value)) {
        evidence.push({ description: `header ${name}: ${value}`, source: "header" });
      }
    }
  }

  if (signature.match.cookies) {
    for (const pattern of signature.match.cookies) {
      const match = ctx.cookies.find((c) => pattern.test(c));
      if (match) evidence.push({ description: `cookie ${match}`, source: "cookie" });
    }
  }

  if (signature.match.htmlPatterns) {
    for (const pattern of signature.match.htmlPatterns) {
      if (pattern.test(ctx.html)) {
        evidence.push({ description: `html pattern ${pattern}`, source: "html" });
      }
    }
  }

  return evidence;
}
