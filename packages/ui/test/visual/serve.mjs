// Serves the static Storybook build (storybook-static/) for the visual suite: `node test/visual/serve.mjs <port>`.
// Dependency-free, bound to 127.0.0.1, GET and HEAD only, and it never serves a file outside storybook-static (path
// traversal is rejected). Playwright starts and stops it (playwright.visual.config.ts, webServer).
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../storybook-static/", import.meta.url));
const HOST = "127.0.0.1";
const port = Number.parseInt(process.argv[2] ?? "", 10);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error("usage: node test/visual/serve.mjs <port 1024-65535>");
  process.exit(2);
}

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

/** The file a URL path maps to inside ROOT, or null when it would escape ROOT or can't be decoded. */
function resolveInRoot(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(new URL(urlPath, "http://localhost").pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const file = path.resolve(ROOT, `.${decoded.endsWith("/") ? `${decoded}index.html` : decoded}`);
  return file.startsWith(ROOT) ? file : null;
}

const server = createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { allow: "GET, HEAD" }).end();
    return;
  }
  const file = resolveInRoot(request.url ?? "/");
  if (file === null) {
    response.writeHead(400).end();
    return;
  }
  stat(file).then(
    (stats) => {
      if (!stats.isFile()) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "content-type": CONTENT_TYPES.get(path.extname(file)) ?? "application/octet-stream",
        "content-length": stats.size,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      if (request.method === "HEAD") response.end();
      else createReadStream(file).pipe(response);
    },
    () => {
      response.writeHead(404).end();
    },
  );
});

server.listen(port, HOST, () => {
  console.log(`Serving ${ROOT} at http://${HOST}:${String(port)}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
