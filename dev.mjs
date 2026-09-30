// Local dev server mirroring Vercel: static files from the project root plus
// every /api/*.js function with an Express-ish (status/json/query) shim.
// Not deployed (see .vercelignore). Run: node dev.mjs
import http from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const handlers = {};
for (const f of await readdir(join(root, "api"))) {
  if (f.endsWith(".js")) {
    handlers[`/api/${f.slice(0, -3)}`] = (await import(pathToFileURL(join(root, "api", f)))).default;
  }
}
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".geojson": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const fn = handlers[url.pathname];
    if (fn) {
      req.query = Object.fromEntries(url.searchParams);
      res.status = (c) => ((res.statusCode = c), res);
      res.json = (o) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(o));
        return res;
      };
      const t0 = Date.now();
      try {
        await fn(req, res);
      } catch (e) {
        console.error(url.pathname, e);
        if (!res.writableEnded) res.status(500).json({ error: String(e) });
      }
      console.log(`${url.pathname} ${res.statusCode} ${Date.now() - t0}ms`);
      return;
    }
    let p = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    p = normalize(p).replace(/^(\.\.[/\\])+/, "");
    try {
      const data = await readFile(join(root, p));
      res.setHeader("Content-Type", MIME[extname(p)] || "application/octet-stream");
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end("not found");
    }
  })
  .listen(3000, () => console.log("dev server on http://localhost:3000"));
