// Proxy for Yahoo Finance's chart endpoint (no CORS upstream). Allowlisted
// symbols only. Used for the J-REIT ETF that FRED doesn't carry.
const ALLOWED = new Set([
  "1343.T", // NEXT FUNDS TSE REIT Index ETF — proxy for the Tokyo listed-REIT market
]);

export default async function handler(req, res) {
  const symbol = String(req.query.symbol || "");
  if (!ALLOWED.has(symbol)) {
    return res.status(400).json({ error: "unknown symbol" });
  }
  const upstream =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=2y&interval=1d&events=history`;
  const r = await fetch(upstream, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) return res.status(502).json({ error: `upstream ${r.status}` });
  const body = await r.json();

  const result = body?.chart?.result?.[0];
  const stamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const meta = result?.meta || {};

  const dates = [];
  const values = [];
  for (let i = 0; i < stamps.length; i++) {
    const c = closes[i];
    if (c == null || !Number.isFinite(c)) continue;
    // JST calendar date for the session
    const d = new Date((stamps[i] + 9 * 3600) * 1000).toISOString().slice(0, 10);
    dates.push(d);
    values.push(Math.round(c * 100) / 100);
  }
  if (!dates.length) return res.status(502).json({ error: "empty series" });

  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=21600");
  return res.status(200).json({
    symbol,
    dates,
    values,
    meta: {
      price: meta.regularMarketPrice ?? values[values.length - 1],
      high52: meta.fiftyTwoWeekHigh ?? null,
      low52: meta.fiftyTwoWeekLow ?? null,
      currency: meta.currency ?? "JPY",
    },
  });
}
