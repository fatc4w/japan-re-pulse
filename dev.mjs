// Local dev server mirroring Vercel: static files from the project root plus
// the /api functions with an Express-ish (status/json/query) shim.
// Not deployed (see .vercelignore). Run: node dev.mjs
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import fred from "./api/fred.js";
import market from "./api/market.js";

const root = dirname(fileURLToPath(import.meta.url));
const handlers = { "/api/fred": fred, "/api/market": market };
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
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
      try {
        await fn(req, res);
      } catch (e) {
        console.error(e);
        if (!res.writableEnded) res.status(500).json({ error: String(e) });
      }
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
