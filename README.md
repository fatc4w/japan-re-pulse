# Japan Pulse — Real Estate Weekly

A live, data-driven dashboard on Japanese real estate: rates, prices, the yen,
inbound demand, and the listed market. Static frontend (ECharts) + two Vercel
serverless functions that proxy keyless public data sources with caching.

## Data sources
- **BIS residential property price indices** (nominal & real) via FRED (`QJPN628BIS`, `QJPR628BIS`, `QJPN368BIS`)
- **10-year JGB yield & overnight call rate** (OECD) via FRED
- **¥/$ (Fed H.10)** and **Nikkei 225** via FRED
- **NEXT FUNDS TSE REIT Index ETF (1343.T)** via Yahoo Finance
- **Japan Tourism Agency** Overnight Travel Statistics Survey (宿泊旅行統計調査) — baked to `data/tourism.json` by `scripts/build_data.py`
- Prefecture outlines: MLIT National Land Numerical Information via dataofjapan/land

## Develop
```
node dev.mjs        # http://localhost:3000 — mirrors Vercel (static + /api)
```

## Refresh the annual tourism data
```
python3 scripts/build_data.py
```
(update the workbook URLs in the script when JTA publishes a new year)

## Deploy
```
npx vercel --prod
```
