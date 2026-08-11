// doc/plan.md mục 18.2: minification.json — avgLineLength, whitespaceRatio, commentRatio, sourceMap, confidence.
// Pure function, không cần dependency ngoài -> implement luôn (khác các analyzer/* còn lại đang là P1 stub).

export interface MinificationResult {
  file: string;
  minified: boolean;
  confidence: number; // 0..1
  sourceMap: boolean;
  avgLineLength: number;
  whitespaceRatio: number;
  commentRatio: number;
}

const MINIFIED_AVG_LINE_LENGTH_THRESHOLD = 200;
const MINIFIED_WHITESPACE_RATIO_THRESHOLD = 0.05;

export function detectMinification(file: string, content: string): MinificationResult {
  const lines = content.split("\n").filter((l) => l.length > 0);
  const avgLineLength = lines.length ? content.length / lines.length : content.length;

  const whitespaceCount = (content.match(/\s/g) ?? []).length;
  const whitespaceRatio = content.length ? whitespaceCount / content.length : 0;

  const commentMatches = content.match(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g) ?? [];
  const commentChars = commentMatches.reduce((sum, c) => sum + c.length, 0);
  const commentRatio = content.length ? commentChars / content.length : 0;

  const sourceMap = /\/[/*]#\s*sourceMappingURL=/.test(content);

  let confidence = 0;
  if (avgLineLength > MINIFIED_AVG_LINE_LENGTH_THRESHOLD) confidence += 0.5;
  if (whitespaceRatio < MINIFIED_WHITESPACE_RATIO_THRESHOLD) confidence += 0.4;
  if (commentRatio < 0.01) confidence += 0.1;
  confidence = Math.min(1, confidence);

  return {
    file,
    minified: confidence >= 0.6,
    confidence: Math.round(confidence * 100) / 100,
    sourceMap,
    avgLineLength: Math.round(avgLineLength),
    whitespaceRatio: Math.round(whitespaceRatio * 100) / 100,
    commentRatio: Math.round(commentRatio * 100) / 100,
  };
}
