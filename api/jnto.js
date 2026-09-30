// Live visitor arrivals from JNTO (Japan National Tourism Organization): finds the
// latest "arrivals by nationality / month" workbook on the statistics page and
// returns monthly totals plus a year-to-date comparison by source market.
import * as XLSX from "xlsx";
import { getText, getBuffer, cache, links, absUrl, num } from "../lib/common.js";

const PAGE = "https://www.jnto.go.jp/statistics/data/visitors-statistics/";
const MARKETS = {
  韓国: "South Korea", 中国: "China", 台湾: "Taiwan", 香港: "Hong Kong", 米国: "United States",
  タイ: "Thailand", 豪州: "Australia", フィリピン: "Philippines", シンガポール: "Singapore",
  ベトナム: "Vietnam", マレーシア: "Malaysia", インドネシア: "Indonesia", 英国: "United Kingdom",
  カナダ: "Canada", フランス: "France", ドイツ: "Germany", インド: "India", イタリア: "Italy",
  スペイン: "Spain", メキシコ: "Mexico",
};

function parseYear(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const h = rows.findIndex((r) => r && r.some((c) => c === "1月"));
  if (h < 0) return null;
  const cols = [];
  for (let m = 1; m <= 12; m++) cols.push(rows[h].indexOf(`${m}月`));
  const out = {};
  for (const r of rows.slice(h + 1)) {
    if (!r) continue;
    const label = String(r[0] ?? r[1] ?? "").replace(/[\s　]/g, "");
    if (!label) continue;
    out[label] = cols.map((c) => (c >= 0 ? num(r[c]) : null));
  }
  return out;
}

export default async function handler(req, res) {
  const html = await getText(PAGE);
  const xl = links(html, "xlsx");
  const pick = xl.find((l) => /訪日外客数/.test(l.text) && /国籍/.test(l.text)) ?? xl[0];
  if (!pick) return res.status(502).json({ error: "workbook link not found" });
  const url = absUrl(PAGE, pick.href);
  const wb = XLSX.read(await getBuffer(url), { type: "buffer" });

  const years = wb.SheetNames.filter((s) => /^\d{4}$/.test(s)).map(Number).sort((a, b) => b - a);
  const cur = years[0], prev = cur - 1;
  const data = {};
  for (const y of [cur, prev, 2019]) if (wb.Sheets[String(y)]) data[y] = parseYear(wb.Sheets[String(y)]);

  const totalCur = data[cur]["総数"];
  let lastMonth = 0;
  totalCur.forEach((v, i) => { if (v != null) lastMonth = i + 1; });
  const ytd = (arr) => (arr ? arr.slice(0, lastMonth).reduce((a, v) => a + (v ?? 0), 0) : null);

  const markets = Object.entries(MARKETS)
    .map(([jp, en]) => {
      const c = data[cur][jp], p = data[prev]?.[jp], b = data[2019]?.[jp];
      const ytdCur = ytd(c), ytdPrev = ytd(p);
      return {
        market: en,
        ytd: ytdCur,
        ytd_prev: ytdPrev,
        ytd_2019: ytd(b),
        yoy_pct: ytdPrev ? 100 * (ytdCur / ytdPrev - 1) : null,
      };
    })
    .filter((m) => m.ytd);

  cache(res, 43200, 604800);
  return res.status(200).json({
    source: "Japan National Tourism Organization (JNTO), visitor arrivals",
    source_url: url,
    year: cur,
    last_month: lastMonth,
    totals: { [cur]: totalCur, [prev]: data[prev]?.["総数"] ?? null, 2019: data[2019]?.["総数"] ?? null },
    markets,
  });
}
