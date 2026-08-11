// doc/plan.md mục 10: stream xuống đĩa, hash song song, không buffer cả file vào memory.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface WriteResult {
  sha256: string;
  size: number;
}

export async function streamToDisk(body: Readable, absolutePath: string): Promise<WriteResult> {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const hash = createHash("sha256");
  let size = 0;

  body.on("data", (chunk: Buffer) => {
    hash.update(chunk);
    size += chunk.length;
  });

  await pipeline(body, createWriteStream(absolutePath));

  return { sha256: hash.digest("hex"), size };
}
