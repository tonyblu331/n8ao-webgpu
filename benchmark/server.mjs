import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { existsSync } from "node:fs";

const PORT = process.env.PORT || 8765;
const ROOT = process.cwd();

const mimeTypes = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".ts": "application/javascript",
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".css": "text/css",
};

const server = createServer(async (req, res) => {
  let url = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (url === "/") url = "/benchmark/benchmark.html";

  const filePath = join(ROOT, url);

  // Security: prevent directory traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end(`Not found: ${url}`);
    return;
  }

  try {
    const data = await readFile(filePath);
    const ext = extname(filePath);
    const contentType = mimeTypes[ext] || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    });
    res.end(data);
  } catch (err) {
    res.writeHead(500);
    res.end(String(err));
  }
});

server.listen(PORT, () => {
  console.log(`Benchmark server running at http://localhost:${PORT}`);
});

// Keep alive until explicitly killed
process.on("SIGINT", () => {
  server.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
