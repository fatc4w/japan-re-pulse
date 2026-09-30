# Japan Pulse — Real Estate Weekly

A live dashboard on Japanese real estate: rates, prices, Tokyo offices, inbound
demand and J-REITs. Static frontend (ECharts) plus Vercel serverless functions
that fetch and parse public Japanese and global sources on request, cached at the edge.

## Live sources (`/api`)
| Function | Source | What it returns | Cache |
|---|---|---|---|
| `fred` | FRED (BIS, OECD, Fed H.10, Nikkei) | property price indices, 10Y JGB, call rate, ¥/$, Nikkei | 6h |
| `mlit` | MLIT Real Estate Price Index (Excel, scraped from the release page) | residential by type (monthly), commercial by type (quarterly) | 24h |
| `miki` | Miki Shoji office market pages (HTML) | vacancy & rent, 7 cities + 5 central Tokyo wards, 13 months | 12h |
| `jnto` | JNTO visitor arrivals workbook (Excel) | monthly arrivals, YTD by source market | 12h |
| `jta` | Japan Tourism Agency monthly hotel statistics (Excel) | foreign guest nights & room occupancy by prefecture, latest month | 12h |
| `jreit` | Yahoo Finance (TSE) | 19 J-REITs: price, 1y return, yield, trading value | 1h |
| `market` | Yahoo Finance (TSE) | TSE REIT Index ETF (1343) daily | 30m |

## Baked data (`data/`, refreshed by `scripts/build_data.py`)
- `tourism.json` — JTA annual confirmed 2025 vs 2019 by prefecture + monthly baselines for the live comparison
- `miki_tokyo_history.json` — Tokyo office vacancy & rent since 1991 (December pages)
- `japan.geojson` — prefecture outlines (MLIT via dataofjapan/land), simplified

Re-run once a year when JTA publishes the next annual workbook (update the URLs in the script):
```
python3 scripts/build_data.py
```

## Develop
```
npm install
node dev.mjs        # http://localhost:3000 — mirrors Vercel (static + /api)
```

## Deploy
```
npx vercel --prod
```
