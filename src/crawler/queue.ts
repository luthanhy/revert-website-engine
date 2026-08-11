// doc/plan.md mục 2: BFS theo depth, dedupe theo URL đã chuẩn hóa.

export interface QueueItem {
  url: string;
  depth: number;
  discoveredFrom: "html" | "css" | "runtime" | "sitemap" | "robots";
}

export class CrawlQueue {
  private items: QueueItem[] = [];
  private seen = new Set<string>();

  constructor(private readonly maxDepth: number) {}

  push(item: QueueItem): boolean {
    if (item.depth > this.maxDepth) return false;
    if (this.seen.has(item.url)) return false;
    this.seen.add(item.url);
    this.items.push(item);
    return true;
  }

  hasSeen(url: string): boolean {
    return this.seen.has(url);
  }

  next(): QueueItem | undefined {
    return this.items.shift();
  }

  get pending(): number {
    return this.items.length;
  }
}
