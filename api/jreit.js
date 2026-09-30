// Live J-REIT snapshot from Yahoo Finance: price, 1-year price return,
// annualised distribution yield (latest payout × payouts per year) and average
// daily traded value for a basket of large Tokyo-listed REITs across sectors.
import { getJSON, cache, mapLimit } from "../lib/common.js";

const REITS = [
  ["8951.T", "Nippon Building Fund", "Office"],
  ["8952.T", "Japan Real Estate", "Office"],
  ["8976.T", "Daiwa Office", "Office"],
  ["3283.T", "Nippon Prologis", "Logistics"],
  ["3281.T", "GLP J-REIT", "Logistics"],
  ["8967.T", "Japan Logistics Fund", "Logistics"],
  ["3466.T", "LaSalle Logiport", "Logistics"],
  ["3269.T", "Advance Residence", "Residential"],
  ["8986.T", "Daiwa Securities Living", "Residential"],
  ["3282.T", "Comforia Residential", "Residential"],
  ["8985.T", "Japan Hotel REIT", "Hotel"],
  ["8963.T", "Invincible", "Hotel"],
  ["3463.T", "Ichigo Hotel", "Hotel"],
  ["3292.T", "AEON REIT", "Retail"],
  ["8964.T", "Mitsui Fudosan Retail", "Retail"],
  ["8953.T", "Japan Metropolitan Fund", "Diversified"],
  ["3462.T", "Nomura RE Master Fund", "Diversified"],
  ["8960.T", "United Urban", "Diversified"],
  ["8984.T", "Daiwa House REIT", "Diversified"],
];

async function one([symbol, name, sector]) {
  const d = await getJSON(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d&events=div`
  );
  const r = d?.chart?.result?.[0];
  const ts = r.timestamp;
  const q = r.indicators.quote[0];
  const price = r.meta.regularMarketPrice;
  const lastTs = ts[ts.length - 1];

  // close ~1 year ago
  let i0 = ts.findIndex((t) => t >= lastTs - 365 * 86400);
  while (i0 < ts.length && q.close[i0] == null) i0++;
  const ret1y = 100 * (price / q.close[i0] - 1);

  // annualised distribution
  const divs = Object.values(r.events?.dividends || {}).sort((a, b) => a.date - b.date);
  let yieldPct = null;
  if (divs.length) {
    const last = divs[divs.length - 1];
    const gapMonths = divs.length > 1 ? (last.date - divs[divs.length - 2].date) / (30.4 * 86400) : 6;
    const perYear = gapMonths > 9 ? 1 : 2;
    yieldPct = (100 * last.amount * perYear) / price;
  }

  // average daily traded value, last ~60 sessions (¥)
  let s = 0, n = 0;
  for (let i = ts.length - 1; i >= 0 && n < 60; i--) {
    if (q.close[i] != null && q.volume[i] != null) { s += q.close[i] * q.volume[i]; n++; }
  }
  return { symbol, name, sector, price, ret1y, yield: yieldPct, adv: n ? s / n : null };
}

export default async function handler(req, res) {
  const results = await mapLimit(REITS, 5, one);
  const reits = results.filter((r) => r.status === "fulfilled").map((r) => r.value).filter((r) => r.yield != null);
  if (!reits.length) return res.status(502).json({ error: "no data" });
  cache(res, 3600, 21600);
  return res.status(200).json({ source: "Yahoo Finance (Tokyo Stock Exchange)", reits });
}
