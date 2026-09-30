// Live MLIT Real Estate Price Index (不動産価格指数): residential by type (monthly)
// and commercial property by type (quarterly), national, seasonally adjusted,
// 2010 average = 100. Workbook links are scraped from MLIT's release page.
import * as XLSX from "xlsx";
import { getText, getBuffer, cache, absUrl, num } from "../lib/common.js";

const PAGE = "https://www.mlit.go.jp/totikensangyo/totikensangyo_tk5_000085.html";

function linkAfter(html, label) {
  const i = html.indexOf(label);
  if (i < 0) return null;
  const m = html.slice(i).match(/href="([^"]+\.xlsx)"/);
  return m ? absUrl(PAGE, m[1]) : null;
}
function rowsOf(wb, prefix) {
  const name = wb.SheetNames.find((s) => s.startsWith(prefix));
  return name ? XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }) : null;
}
// English header row → column index for each label
function colMap(rows, labels) {
  for (const r of rows.slice(0, 12)) {
    if (!r) continue;
    const found = {};
    for (const [key, lab] of Object.entries(labels)) {
      const c = r.findIndex((x) => typeof x === "string" && x.trim() === lab);
      if (c >= 0) found[key] = c;
    }
    if (Object.keys(found).length === Object.keys(labels).length) return found;
  }
  return null;
}
const iso = (d) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10);

export default async function handler(req, res) {
  const html = await getText(PAGE);
  const resUrl = linkAfter(html, "不動産価格指数（住宅）");
  const comUrl = linkAfter(html, "不動産価格指数（商業用不動産）");
  if (!resUrl || !comUrl) return res.status(502).json({ error: "workbook links not found" });
  const paused = /公表延期/.test(html);

  const [resWb, comWb] = await Promise.all([resUrl, comUrl].map(async (u) =>
    XLSX.read(await getBuffer(u), { type: "buffer", cellDates: true })));

  // Residential, monthly
  const rr = rowsOf(resWb, "全国");
  const rc = colMap(rr, {
    total: "Residential Property", land: "Residential Land", detached: "Detached House", condo: "Condominiums",
  });
  const residential = { dates: [], total: [], land: [], detached: [], condo: [] };
  for (const r of rr) {
    if (!r || !(r[0] instanceof Date)) continue;
    residential.dates.push(iso(r[0]));
    for (const k of ["total", "land", "detached", "condo"]) residential[k].push(num(r[rc[k]]));
  }

  // Commercial, quarterly (col 0 = year, col 1 = quarter)
  const cr = rowsOf(comWb, "全国");
  const labels = {
    total: "Commercial Property", retail: "Retail", office: "Office", warehouse: "Warehouse",
    factory: "Factory", apartment: "Apartment", commercial_land: "Commercial Land", industrial_land: "Industrial Land",
  };
  const cc = colMap(cr, labels);
  const commercial = { dates: [] };
  for (const k of Object.keys(labels)) commercial[k] = [];
  let year = null;
  for (const r of cr) {
    if (!r) continue;
    if (typeof r[0] === "number") year = r[0];
    const q = r[1];
    if (!year || typeof q !== "number" || q < 1 || q > 4 || num(r[cc.total]) == null) continue;
    commercial.dates.push(`${year}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`);
    for (const k of Object.keys(labels)) commercial[k].push(num(r[cc[k]]));
  }

  cache(res, 86400, 604800);
  return res.status(200).json({
    source: "MLIT Real Estate Price Index (seasonally adjusted, 2010 = 100)",
    source_url: PAGE,
    publication_paused: paused,
    residential,
    commercial,
  });
}
