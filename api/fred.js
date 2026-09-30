// Proxy for FRED's keyless CSV endpoint (fredgraph.csv), because FRED sends no
// CORS headers. Allowlisted series only — this is not an open proxy.
const ALLOWED = new Set([
  "QJPN628BIS",      // Residential property prices, Japan (nominal index, 2010=100, BIS)
  "QJPR628BIS",      // Real residential property prices, Japan (BIS)
  "QJPN368BIS",      // Residential property prices, Japan, YoY % (BIS)
  "IRLTLT01JPM156N", // 10-year JGB yield, monthly (OECD)
  "IRSTCI01JPM156N", // Overnight call rate, monthly (OECD)
  "DEXJPUS",         // Yen per USD, daily (Fed H.10)
  "NIKKEI225",       // Nikkei 225, daily
  "FPCPITOTLZGJPN",  // CPI inflation, annual % (World Bank)
]);

export default async function handler(req, res) {
  const id = String(req.query.id || "");
  const start = String(req.query.start || "");
  if (!ALLOWED.has(id)) {
    return res.status(400).json({ error: "unknown series" });
  }
  const upstream = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`;
  const r = await fetch(upstream, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) return res.status(502).json({ error: `upstream ${r.status}` });
  const text = await r.text();

  const dates = [];
  const values = [];
  for (const line of text.split("\n").slice(1)) {
    const [d, v] = line.trim().split(",");
    if (!d || v === "." || v === "" || v === undefined) continue;
    if (start && d < start) continue;
    const n = parseFloat(v);
    if (!Number.isFinite(n)) continue;
    dates.push(d);
    values.push(n);
  }
  if (!dates.length) return res.status(502).json({ error: "empty series" });

  res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
  return res.status(200).json({ id, dates, values });
}
