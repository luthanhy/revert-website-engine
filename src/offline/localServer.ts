// doc/plan.md mục 14: local HTTP server tạm để serve crawl output — KHÔNG dùng file:// cho runtime validation.

import * as http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import * as path from "node:path";
import mime from "mime-types";

export interface LocalServerHandle {
  url: string;
  close: () => Promise<void>;
}

export async function startLocalServer(rootDirIn: string, port = 0): Promise<LocalServerHandle> {
  const rootDir = path.resolve(rootDirIn);
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
      let filePath = path.resolve(path.join(rootDir, urlPath));
      if (filePath !== rootDir && !filePath.startsWith(rootDir + path.sep)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      let stats = await stat(filePath).catch(() => null);
      if (stats?.isDirectory()) {
        filePath = path.join(filePath, "index.html");
        stats = await stat(filePath).catch(() => null);
      }
      if (!stats) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": mime.lookup(filePath) || "application/octet-stream" });
      createReadStream(filePath).pipe(res);
    } catch (err) {
      res.writeHead(500);
      res.end(String(err));
    }
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;

  return {
    url: `http://127.0.0.1:${boundPort}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
