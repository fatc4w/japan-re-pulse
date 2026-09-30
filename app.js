"use strict";
/* Japan Pulse — all figures computed in-browser from live sources.
   Charts follow the dataviz method: thin marks, hairline solid grid, one axis,
   validated categorical palette, legends + selective direct labels, table twins. */

const $ = (s) => document.querySelector(s);
const FONT = "Inter, system-ui, sans-serif";
const store = {};      // fetched series
const derived = {};    // computed datasets
let instances = [];    // live echarts instances
let staticBuilt = false;

/* ---------------- formatting helpers ---------------- */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtN = (n) => Math.round(n).toLocaleString("en-US");
const fmtPct = (v, dp = 1, sign = true) => (sign && v > 0 ? "+" : "") + v.toFixed(dp) + "%";
const fmtM = (n) => (n / 1e6).toFixed(1) + "M";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const prettyDay = (iso) => `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}, ${iso.slice(0, 4)}`;
const prettyMonth = (iso) => `${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
const qLabel = (iso) => `Q${Math.ceil(+iso.slice(5, 7) / 3)} ${iso.slice(0, 4)}`;
const msToIso = (ms) => new Date(ms).toISOString().slice(0, 10);

function isoShift(iso, { years = 0, months = 0, days = 0 } = {}) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() + years);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function idxAtOrBefore(dates, iso) {
  let i = dates.length - 1;
  while (i > 0 && dates[i] > iso) i--;
  return i;
}
const last = (a) => a[a.length - 1];
const zip = (s) => s.dates.map((d, i) => [d, s.values[i]]);
const from = (s, iso) => {
  const i = s.dates.findIndex((d) => d >= iso);
  return { dates: s.dates.slice(i), values: s.values.slice(i) };
};

/* "highest since": most recent pre-cutoff date where the series met today's level */
function lastSeenYear(s, cutoffIso) {
  const cur = last(s.values);
  for (let i = s.dates.length - 1; i >= 0; i--) {
    if (s.dates[i] < cutoffIso && s.values[i] >= cur) return s.dates[i].slice(0, 4);
  }
  return null;
}

/* ---------------- theme ---------------- */
function tok() {
  const cs = getComputedStyle(document.documentElement);
  const g = (n) => cs.getPropertyValue(n).trim();
  return {
    surface: g("--surface"), ink: g("--ink"), ink2: g("--ink2"), muted: g("--muted"),
    grid: g("--grid"), axis: g("--axis"), s1: g("--s1"), s2: g("--s2"), ctx: g("--ctx"),
    mapPos: g("--map-pos"), mapNeg: g("--map-neg"), mapMid: g("--map-mid"),
  };
}
function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem("jrp-theme"); } catch {}
  if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
  $("#themeToggle").addEventListener("click", () => {
    const sysDark = matchMedia("(prefers-color-scheme: dark)").matches;
    const cur = document.documentElement.dataset.theme || (sysDark ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("jrp-theme", next); } catch {}
    buildCharts();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!document.documentElement.dataset.theme) buildCharts();
  });
}

/* ---------------- sparklines (inline SVG, theme-reactive via CSS vars) ---------------- */
function sparkSVG(values, w = 100, h = 30) {
  if (!values || values.length < 2) return "";
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pad = 3;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((v - min) / span) * (h - 2 * pad);
    return [x, y];
  });
  const poly = pts.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return `<svg class="t-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <polyline points="${poly}" fill="none" stroke="var(--spark)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3" fill="var(--accent)" stroke="var(--surface)" stroke-width="1.5"/>
  </svg>`;
}
function twoBarSVG(v0, v1, lab0, lab1) {
  const max = Math.max(v0, v1), H = 26, W = 46;
  const h0 = Math.max(3, (v0 / max) * H), h1 = Math.max(3, (v1 / max) * H);
  return `<svg class="t-spark" width="${W}" height="${H + 12}" viewBox="0 0 ${W} ${H + 12}" aria-hidden="true">
    <rect x="4" y="${H - h0}" width="14" height="${h0}" rx="2" fill="var(--spark)"/>
    <rect x="26" y="${H - h1}" width="14" height="${h1}" rx="2" fill="var(--s1)"/>
    <text x="11" y="${H + 10}" text-anchor="middle" font-size="8" fill="var(--muted)" font-family="${FONT}">${lab0}</text>
    <text x="33" y="${H + 10}" text-anchor="middle" font-size="8" fill="var(--muted)" font-family="${FONT}">${lab1}</text>
  </svg>`;
}

/* ---------------- data loading ---------------- */
const FRED = {
  nom: ["QJPN628BIS", null],
  real: ["QJPR628BIS", null],
  nomYoy: ["QJPN368BIS", "2005-01-01"],
  jgb10: ["IRLTLT01JPM156N", null],
  policy: ["IRSTCI01JPM156N", null],
  fx: ["DEXJPUS", null],
  nikkei: ["NIKKEI225", "2024-01-01"],
  cpi: ["FPCPITOTLZGJPN", "1995-01-01"],
};
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}
async function loadAll() {
  const jobs = [];
  for (const [key, [id, start]] of Object.entries(FRED)) {
    jobs.push([key, fetchJSON(`/api/fred?id=${id}${start ? `&start=${start}` : ""}`)]);
  }
  jobs.push(["reit", fetchJSON("/api/market?symbol=1343.T")]);
  jobs.push(["tourism", fetchJSON("data/tourism.json")]);
  jobs.push(["geo", fetchJSON("data/japan.geojson")]);
  const results = await Promise.allSettled(jobs.map(([, p]) => p));
  results.forEach((r, i) => {
    const key = jobs[i][0];
    if (r.status === "fulfilled") store[key] = r.value;
    else console.warn("source failed:", key, r.reason);
  });
}

/* ---------------- derived datasets ---------------- */
function prepare() {
  const d = derived;

  if (store.fx) {
    const fx = store.fx;
    // monthly means (for quarterly USD conversion)
    const acc = {};
    fx.dates.forEach((dt, i) => { (acc[dt.slice(0, 7)] ??= []).push(fx.values[i]); });
    d.fxMonthly = Object.fromEntries(Object.entries(acc).map(([m, v]) => [m, v.reduce((a, b) => a + b) / v.length]));
    d.fxLast = last(fx.values);
    d.fxLastDate = last(fx.dates);
    const wkIdx = idxAtOrBefore(fx.dates, isoShift(d.fxLastDate, { days: -7 }));
    d.fxWk = 100 * (d.fxLast / fx.values[wkIdx] - 1);
    d.fxSeenYear = lastSeenYear(fx, isoShift(d.fxLastDate, { years: -4 }));
  }

  if (store.nom && store.fx) {
    const nom = from(store.nom, "2014-01-01");
    const rows = [];
    nom.dates.forEach((dt, i) => {
      const y = +dt.slice(0, 4), m = +dt.slice(5, 7);
      const months = [m, m + 1, m + 2].map((mm) => `${y}-${String(mm).padStart(2, "0")}`);
      const vals = months.map((mm) => d.fxMonthly[mm]).filter((v) => v != null);
      if (vals.length) rows.push([dt, nom.values[i], nom.values[i] / (vals.reduce((a, b) => a + b) / vals.length)]);
    });
    const b = rows.filter((r) => r[0].startsWith("2019"));
    const bY = b.reduce((a, r) => a + r[1], 0) / b.length;
    const bU = b.reduce((a, r) => a + r[2], 0) / b.length;
    d.usdIdx = rows.map(([dt, y, u]) => [dt, 100 * (y / bY), 100 * (u / bU)]);
    d.yenGain = last(d.usdIdx)[1] - 100;
    d.usdGain = last(d.usdIdx)[2] - 100;
  }

  if (store.nom) {
    const nom = store.nom;
    d.nomLast = last(nom.values);
    d.nomLastDate = last(nom.dates);
    d.peakVal = Math.max(...nom.values);
    d.peakDate = nom.dates[nom.values.indexOf(d.peakVal)];
    d.belowPeak = 100 * (d.nomLast / d.peakVal - 1);
    d.nomSinceYear = lastSeenYear(nom, "2015-01-01");
  }
  if (store.real) d.realSinceYear = lastSeenYear(store.real, "2015-01-01");
  if (store.nomYoy) { d.yoy = last(store.nomYoy.values); d.yoyDate = last(store.nomYoy.dates); }

  if (store.jgb10) {
    const s = store.jgb10;
    d.jgbLast = last(s.values);
    d.jgbLastDate = last(s.dates);
    d.jgbYrAgo = s.values[idxAtOrBefore(s.dates, isoShift(d.jgbLastDate, { years: -1 }))];
    d.jgbSinceYear = lastSeenYear(s, "2020-01-01");
  }
  if (store.policy) {
    const s = store.policy;
    d.polLast = last(s.values);
    d.polYrAgo = s.values[idxAtOrBefore(s.dates, isoShift(last(s.dates), { years: -1 }))];
  }
  if (store.cpi) {
    let streak = 0;
    for (let i = store.cpi.values.length - 1; i >= 0 && store.cpi.values[i] >= 2; i--) streak++;
    d.cpiStreak = streak;
    d.cpiLast = last(store.cpi.values);
  }

  if (store.reit) {
    const r = store.reit;
    d.reitLast = last(r.values);
    d.reitLastDate = last(r.dates);
    const wk = r.values[idxAtOrBefore(r.dates, isoShift(d.reitLastDate, { days: -7 }))];
    d.reitWk = 100 * (d.reitLast / wk - 1);
    const hi = store.reit.meta?.high52 ?? Math.max(...r.values.slice(-250));
    d.reitOffHigh = 100 * (d.reitLast / hi - 1);
    const t0 = idxAtOrBefore(r.dates, isoShift(d.reitLastDate, { years: -1 }));
    d.reitReb = r.dates.slice(t0).map((dt, i) => [dt, 100 * (r.values[t0 + i] / r.values[t0])]);
    d.reitYr = last(d.reitReb)[1] - 100;
  }
  if (store.nikkei && d.reitReb) {
    const n = store.nikkei;
    const t0 = idxAtOrBefore(n.dates, d.reitReb[0][0]);
    d.nikReb = n.dates.slice(t0).map((dt, i) => [dt, 100 * (n.values[t0 + i] / n.values[t0])]);
    d.nikYr = last(d.nikReb)[1] - 100;
  }

  if (store.tourism) {
    const t = store.tourism;
    d.prefs = t.prefectures;
    d.screened = t.prefectures.filter((p) => p.screened).sort((a, b) => a.rank - b.rank);
    d.totNow = t.totals.foreign_nights_latest;
    d.totGrowth = 100 * (t.totals.foreign_nights_latest / t.totals.foreign_nights_base - 1);
    d.maxNights = Math.max(...t.prefectures.map((p) => p.nights_latest || 0));
    d.biggest = t.prefectures.find((p) => p.nights_latest === d.maxNights);
    const metro = new Set(t.meta.metro_excluded);
    const eligible = t.prefectures.filter((p) => p.growth_pct != null && p.nights_latest >= 500000 && !metro.has(p.name));
    d.risers = [...eligible].sort((a, b) => b.growth_pct - a.growth_pct).slice(0, 3);
    d.gMin = Math.min(...t.prefectures.map((p) => p.growth_pct ?? 0));
    d.gMax = Math.max(...t.prefectures.map((p) => p.growth_pct ?? 0));
    d.latestYear = t.meta.latest_year;
    d.baseYear = t.meta.base_year;
  }
}

/* ---------------- hero, tiles, signals, subs ---------------- */
function renderHero() {
  const el = $("#heroFig");
  if (derived.yoy == null || !store.nom) { el.innerHTML = `<div class="chart-error" style="height:150px">Property price feed unavailable — reload to retry.</div>`; return; }
  const sparkVals = from(store.nom, "2013-01-01").values;
  el.innerHTML = `
    <p class="kicker"><span class="dot"></span>The headline number</p>
    <div class="hero-num">${esc(fmtPct(derived.yoy, 1)).replace("%", "")}<span class="hero-unit">%</span></div>
    <p class="hero-lab">Residential property prices, year on year · ${esc(qLabel(derived.yoyDate))}</p>
    ${sparkSVG(sparkVals, 240, 46)}
    <p class="hero-src">Nominal national index (2010 = 100), BIS via FRED — sparkline since 2013</p>`;
}

function renderTiles() {
  const tiles = [];
  const dv = derived;
  if (store.jgb10) {
    const diff = dv.jgbLast - dv.jgbYrAgo;
    tiles.push({
      label: "10-year JGB yield",
      value: `${dv.jgbLast.toFixed(2)}<small>%</small>`,
      spark: sparkSVG(store.jgb10.values.slice(-36)),
      delta: `<span>${diff >= 0 ? "▲" : "▼"} ${Math.abs(diff).toFixed(2)}pp in a year</span>`,
    });
  }
  if (store.policy) {
    const diff = dv.polLast - dv.polYrAgo;
    tiles.push({
      label: "BOJ overnight rate",
      value: `${dv.polLast.toFixed(2)}<small>%</small>`,
      spark: sparkSVG(store.policy.values.slice(-36)),
      delta: `<span>${diff >= 0 ? "▲" : "▼"} ${Math.abs(diff).toFixed(2)}pp in a year</span>`,
    });
  }
  if (store.fx) {
    tiles.push({
      label: "Yen per dollar",
      value: `¥${dv.fxLast.toFixed(1)}`,
      spark: sparkSVG(store.fx.values.slice(-60)),
      delta: `<span>${dv.fxWk >= 0 ? "▲" : "▼"} ${Math.abs(dv.fxWk).toFixed(1)}% w/w</span><span class="chip">weaker = cheaper in $</span>`,
    });
  }
  if (store.reit) {
    const cls = dv.reitWk >= 0 ? "up" : "down";
    tiles.push({
      label: "Tokyo listed REITs (1343 ETF)",
      value: `¥${fmtN(dv.reitLast)}`,
      spark: sparkSVG(store.reit.values.slice(-120)),
      delta: `<span class="${cls}">${dv.reitWk >= 0 ? "▲" : "▼"} ${Math.abs(dv.reitWk).toFixed(1)}% w/w</span><span class="chip">${fmtPct(dv.reitOffHigh, 0)} vs 52-wk high</span>`,
    });
  }
  if (store.tourism) {
    tiles.push({
      label: `Foreign guest nights · ${dv.latestYear}`,
      value: `${fmtM(dv.totNow)}`,
      spark: twoBarSVG(store.tourism.totals.foreign_nights_base, dv.totNow, "'19", "'25"),
      delta: `<span class="up">▲ ${fmtPct(dv.totGrowth, 1, false)} vs ${dv.baseYear}</span>`,
    });
  }
  $("#kpis").innerHTML = tiles.map((t) => `
    <div class="card tile">
      <p class="t-label">${t.label}</p>
      <div class="t-row"><span class="t-value">${t.value}</span>${t.spark || ""}</div>
      <p class="t-delta">${t.delta}</p>
    </div>`).join("");
}

function renderSignals() {
  const dv = derived, out = [];
  if (dv.yoy != null && dv.reitOffHigh != null) {
    out.push(`Physical prices are <b>${fmtPct(dv.yoy)}</b> year on year while listed REITs sit <b>${fmtPct(dv.reitOffHigh, 0)}</b> from their 52-week high. One of these markets is wrong about rates.`);
  }
  if (dv.fxLast != null && dv.fxSeenYear) {
    out.push(`The yen trades at <b>¥${dv.fxLast.toFixed(0)}/$</b> — levels last seen in <b>${dv.fxSeenYear}</b>. For dollar-based buyers, that is a structural discount on every asset in this report.`);
  }
  if (dv.risers?.length) {
    const r = dv.risers[0];
    out.push(`<b>${esc(r.name)}</b> hosts <b>${fmtPct(r.growth_pct, 0)}</b> more foreign nights than in 2019 — the fastest riser isn't Tokyo, it's regional Japan.`);
  }
  $("#signalRow").innerHTML = out.map((html, i) => `
    <div class="signal"><p class="s-kick">Signal 0${i + 1}</p><p>${html}</p></div>`).join("");
}

function renderSubs() {
  const dv = derived;
  if (dv.jgbLast != null) {
    $("#macroSub").innerHTML =
      `The 10-year JGB yields <b>${dv.jgbLast.toFixed(2)}%</b> — the most since <b>${esc(dv.jgbSinceYear ?? "the early 1990s")}</b> — and the overnight rate is at <b>${dv.polLast?.toFixed(2) ?? "—"}%</b>, territory unseen since the 1990s.` +
      (dv.cpiStreak ? ` Inflation has now held above the BOJ's 2% target for <b>${dv.cpiStreak} straight years</b>.` : "");
  }
  if (dv.nomLast != null) {
    $("#pricesSub").innerHTML =
      `The nominal index is the highest since <b>${esc(dv.nomSinceYear ?? "the mid-1990s")}</b> — still <b>${Math.abs(dv.belowPeak).toFixed(0)}%</b> below the ${dv.peakDate.slice(0, 4)} bubble peak. Adjusted for inflation, prices are back to <b>${esc(dv.realSinceYear ?? "—")}</b> levels.`;
  }
  if (dv.usdIdx) {
    $("#yenSub").innerHTML =
      `Since 2019 the same national housing index is <b>${fmtPct(dv.yenGain, 0)} in yen</b> — and <b>${fmtPct(dv.usdGain, 0)} in dollars</b>. The yen, not the asset, has done the discounting.`;
  }
  if (dv.prefs) {
    const [r1, r2, r3] = dv.risers;
    $("#inboundSub").innerHTML =
      `<b>${fmtM(dv.totNow)}</b> foreign guest nights in ${dv.latestYear}, <b>${fmtPct(dv.totGrowth, 0)}</b> vs 2019. ${esc(dv.biggest.name)} still hosts the most (<b>${fmtM(dv.maxNights)}</b>), but the growth is regional: ` +
      dv.risers.map((r) => `<b>${esc(r.name)} ${fmtPct(r.growth_pct, 0)}</b>`).join(", ") + `.`;
  }
  if (dv.reitYr != null && dv.nikYr != null) {
    $("#marketsSub").innerHTML =
      `Over the past year Tokyo-listed REITs returned <b>${fmtPct(dv.reitYr, 1)}</b> in price terms while the Nikkei did <b>${fmtPct(dv.nikYr, 1)}</b>. The REIT ETF closed at <b>¥${fmtN(dv.reitLast)}</b>, ${fmtPct(dv.reitOffHigh, 0)} below its 52-week high.`;
  }
  $("#stamp").textContent = "Updated " + new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/* ---------------- echarts shared pieces ---------------- */
function ttFormatter(t, valueFmt, titleFmt) {
  return (params) => {
    const arr = Array.isArray(params) ? params : [params];
    const first = arr[0];
    const raw = first.axisValue ?? (Array.isArray(first.value) ? first.value[0] : first.value);
    const title = titleFmt ? titleFmt(typeof raw === "number" ? msToIso(raw) : raw) : "";
    const rows = arr.map((p) => {
      const v = Array.isArray(p.value) ? p.value[1] : p.value;
      if (v == null || !p.seriesName || p.seriesName.startsWith("\0")) return "";
      return `<div class="tt-row"><span class="tt-key" style="background:${p.color}"></span><b>${valueFmt(v)}</b><span class="tt-name">${esc(p.seriesName)}</span></div>`;
    }).join("");
    return `<div class="tt-title">${esc(title)}</div>${rows}`;
  };
}
function baseTooltip(t, valueFmt, titleFmt) {
  return {
    trigger: "axis",
    axisPointer: { type: "line", lineStyle: { color: t.axis, width: 1, type: "solid" } },
    backgroundColor: t.surface, borderColor: t.grid, borderWidth: 1,
    padding: [9, 13], textStyle: { color: t.ink, fontFamily: FONT, fontSize: 12 },
    extraCssText: "box-shadow:0 6px 20px rgba(0,0,0,.13);border-radius:10px;",
    formatter: ttFormatter(t, valueFmt, titleFmt),
  };
}
function xTime(t) {
  return {
    type: "time",
    axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 11, fontFamily: FONT, hideOverlap: true },
    splitLine: { show: false },
  };
}
function yVal(t, fmt) {
  return {
    type: "value", scale: true,
    axisLabel: { color: t.muted, fontSize: 11, fontFamily: FONT, formatter: fmt },
    splitLine: { lineStyle: { color: t.grid, width: 1 } },
    axisLine: { show: false }, axisTick: { show: false },
  };
}
function line(t, name, data, color, endText, extra = {}) {
  return {
    name, type: "line", data,
    showSymbol: false, symbol: "circle", symbolSize: 8,
    itemStyle: { color, borderColor: t.surface, borderWidth: 2 },
    lineStyle: { color, width: 2 },
    emphasis: { focus: "none" },
    endLabel: endText ? {
      show: true, formatter: () => endText, color: t.ink2,
      fontSize: 11, fontFamily: FONT, distance: 8,
    } : undefined,
    ...extra,
  };
}
function legend(t, extra = {}) {
  return { top: 0, right: 0, textStyle: { color: t.ink2, fontSize: 12, fontFamily: FONT }, itemGap: 18, ...extra };
}
function failCard(id, msg) {
  const el = $("#" + id);
  if (el) el.innerHTML = `<div class="chart-error">${esc(msg)}</div>`;
}

/* ---------------- chart factories ---------------- */
const CHARTS = [];

CHARTS.push({
  el: "chartRates",
  ready: () => store.jgb10 && store.policy,
  fail: "Rates feed unavailable — reload to retry.",
  option(t) {
    const jgb = from(store.jgb10, "1990-01-01");
    const pol = from(store.policy, "1990-01-01");
    return {
      grid: { left: 10, right: 110, top: 34, bottom: 10, containLabel: true },
      legend: legend(t),
      tooltip: baseTooltip(t, (v) => v.toFixed(2) + "%", prettyMonth),
      xAxis: xTime(t),
      yAxis: yVal(t, (v) => v + "%"),
      series: [
        line(t, "10-year JGB", zip(jgb), t.s1, `10-yr ${derived.jgbLast.toFixed(1)}%`),
        {
          ...line(t, "Overnight call rate", zip(pol), t.s2, `O/N ${derived.polLast.toFixed(1)}%`),
          markArea: {
            silent: true,
            itemStyle: { color: t.ink, opacity: 0.045 },
            label: { color: t.muted, fontSize: 11, fontFamily: FONT },
            data: [[{ name: "Negative-rate era", xAxis: "2016-02-01" }, { xAxis: "2024-03-01" }]],
          },
        },
      ],
    };
  },
});

CHARTS.push({
  el: "chartPrices",
  ready: () => store.nom && store.real,
  fail: "Property price feed unavailable — reload to retry.",
  option(t) {
    const nom = from(store.nom, "1985-01-01");
    const real = from(store.real, "1985-01-01");
    const d = derived;
    return {
      grid: { left: 10, right: 110, top: 34, bottom: 10, containLabel: true },
      legend: legend(t, { data: ["Nominal", "Inflation-adjusted"] }),
      tooltip: baseTooltip(t, (v) => v.toFixed(1), qLabel),
      xAxis: xTime(t),
      yAxis: yVal(t, (v) => v),
      series: [
        line(t, "Nominal", zip(nom), t.s1, `Nominal ${d.nomLast.toFixed(0)}`),
        line(t, "Inflation-adjusted", zip(real), t.s2, `Real ${last(store.real.values).toFixed(0)}`),
        { // single reference point at the bubble peak
          name: "\0peak", type: "scatter", data: [[d.peakDate, d.peakVal]],
          symbolSize: 9, itemStyle: { color: t.muted, borderColor: t.surface, borderWidth: 2 },
          label: {
            show: true, position: "top", color: t.muted, fontSize: 11, fontFamily: FONT,
            formatter: `${d.peakDate.slice(0, 4)} bubble peak · ${d.peakVal.toFixed(0)}`,
          },
          tooltip: { show: false }, silent: true,
        },
      ],
    };
  },
});

CHARTS.push({
  el: "chartYen",
  ready: () => derived.usdIdx,
  fail: "FX feed unavailable — reload to retry.",
  option(t) {
    const d = derived;
    return {
      grid: { left: 10, right: 96, top: 34, bottom: 10, containLabel: true },
      legend: legend(t),
      tooltip: baseTooltip(t, (v) => v.toFixed(1), qLabel),
      xAxis: xTime(t),
      yAxis: yVal(t, (v) => v),
      series: [
        {
          ...line(t, "Priced in yen", d.usdIdx.map((r) => [r[0], r[1]]), t.s1, `¥ ${fmtPct(d.yenGain, 0)}`),
          markLine: {
            silent: true, symbol: "none",
            lineStyle: { color: t.axis, width: 1 },
            label: { formatter: "2019 avg = 100", position: "insideEndTop", color: t.muted, fontSize: 10.5, fontFamily: FONT },
            data: [{ yAxis: 100 }],
          },
        },
        line(t, "Priced in dollars", d.usdIdx.map((r) => [r[0], r[2]]), t.s2, `$ ${fmtPct(d.usdGain, 0)}`),
      ],
    };
  },
});

/* diverging color for the map: gray at 0, blue arm up, red arm down (per-arm normalized) */
function hexToRgb(h) { return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); }
function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return "#" + A.map((x, i) => Math.round(x + (B[i] - x) * t).toString(16).padStart(2, "0")).join("");
}
CHARTS.push({
  el: "chartMap",
  ready: () => store.geo && derived.prefs,
  fail: "Map data unavailable — reload to retry.",
  pre() {
    if (!CHARTS.mapRegistered) { echarts.registerMap("japan", store.geo); CHARTS.mapRegistered = true; }
    const d = derived, t = tok();
    $("#mapLegend").innerHTML =
      `<span>${fmtPct(d.gMin, 0)}</span>` +
      `<div class="bar" style="background:linear-gradient(90deg, var(--map-neg), var(--map-mid) 50%, var(--map-pos))"></div>` +
      `<span>${fmtPct(d.gMax, 0)}</span><span style="margin-left:8px">foreign guest nights, ${d.latestYear} vs ${d.baseYear} (0 = fully recovered)</span>`;
  },
  option(t) {
    const d = derived;
    const byName = Object.fromEntries(d.prefs.map((p) => [p.name, p]));
    const data = d.prefs.filter((p) => p.growth_pct != null).map((p) => {
      const v = p.growth_pct;
      const tt = v >= 0 ? Math.pow(v / d.gMax, 0.65) : Math.pow(v / d.gMin, 0.65);
      return {
        name: p.name, value: v,
        itemStyle: { areaColor: mixHex(t.mapMid, v >= 0 ? t.mapPos : t.mapNeg, tt) },
      };
    });
    return {
      tooltip: {
        trigger: "item",
        backgroundColor: t.surface, borderColor: t.grid, borderWidth: 1,
        padding: [9, 13], textStyle: { color: t.ink, fontFamily: FONT, fontSize: 12 },
        extraCssText: "box-shadow:0 6px 20px rgba(0,0,0,.13);border-radius:10px;",
        formatter: (p) => {
          const pref = byName[p.name];
          if (!pref) return esc(p.name);
          return `<div class="tt-title">${esc(pref.name)} 〈${esc(pref.name_ja)}〉</div>` +
            `<div class="tt-row"><b>${fmtM(pref.nights_latest)}</b><span class="tt-name">foreign nights, ${derived.latestYear}</span></div>` +
            `<div class="tt-row"><b>${fmtPct(pref.growth_pct, 0)}</b><span class="tt-name">vs ${derived.baseYear}</span></div>` +
            (pref.rank ? `<div class="tt-row"><b>#${pref.rank}</b><span class="tt-name">resort screen rank of ${derived.screened.length}</span></div>` : "");
        },
      },
      series: [{
        type: "map", map: "japan", roam: false,
        layoutCenter: ["50%", "51%"], layoutSize: "96%",
        label: { show: false },
        itemStyle: { borderColor: t.surface, borderWidth: 0.7, areaColor: t.grid },
        emphasis: { label: { show: false }, itemStyle: { borderColor: t.ink, borderWidth: 1.1 } },
        select: { disabled: true },
        data,
      }],
    };
  },
});

CHARTS.push({
  el: "chartBubble",
  ready: () => derived.prefs,
  fail: "Tourism data unavailable — reload to retry.",
  option(t) {
    const d = derived;
    const pts = d.prefs.filter((p) => p.growth_pct != null && p.long_haul_share != null);
    const labeled = new Set([
      ...d.screened.slice(0, 3).map((p) => p.name),
      "Hokkaido", "Nagano", d.biggest.name, d.risers[0]?.name,
    ]);
    const mk = (p) => ({
      value: [p.growth_pct, p.long_haul_share, p.nights_latest, p.name],
      label: labeled.has(p.name) ? {
        show: true, position: "right", distance: 4, formatter: p.name,
        color: t.ink2, fontSize: 11, fontFamily: FONT,
      } : undefined,
    });
    const size = (v) => 9 + 45 * Math.sqrt(v[2] / d.maxNights);
    const tip = {
      trigger: "item",
      backgroundColor: t.surface, borderColor: t.grid, borderWidth: 1,
      padding: [9, 13], textStyle: { color: t.ink, fontFamily: FONT, fontSize: 12 },
      extraCssText: "box-shadow:0 6px 20px rgba(0,0,0,.13);border-radius:10px;",
      formatter: (p) => {
        const pref = d.prefs.find((x) => x.name === p.value[3]);
        return `<div class="tt-title">${esc(pref.name)} · ${esc(pref.region)}</div>` +
          `<div class="tt-row"><b>${fmtPct(pref.growth_pct, 0)}</b><span class="tt-name">nights vs ${d.baseYear}</span></div>` +
          `<div class="tt-row"><b>${pref.long_haul_share?.toFixed(0)}%</b><span class="tt-name">long-haul share</span></div>` +
          `<div class="tt-row"><b>${fmtM(pref.nights_latest)}</b><span class="tt-name">foreign nights, ${d.latestYear}</span></div>` +
          (pref.ski_occupancy != null ? `<div class="tt-row"><b>${pref.ski_occupancy.toFixed(0)}%</b><span class="tt-name">Dec–Mar resort occupancy</span></div>` : "");
      },
    };
    return {
      grid: { left: 10, right: 30, top: 30, bottom: 42, containLabel: true },
      legend: legend(t),
      tooltip: tip,
      xAxis: {
        ...xTime(t), type: "value",
        name: `Growth in foreign nights vs ${d.baseYear}`,
        nameLocation: "middle", nameGap: 30,
        nameTextStyle: { color: t.muted, fontSize: 11, fontFamily: FONT },
        axisLabel: { color: t.muted, fontSize: 11, fontFamily: FONT, formatter: (v) => v + "%" },
        splitLine: { lineStyle: { color: t.grid, width: 1 } },
      },
      yAxis: {
        ...yVal(t, (v) => v + "%"),
        name: "Long-haul guest share",
        nameTextStyle: { color: t.muted, fontSize: 11, fontFamily: FONT, align: "left" },
      },
      series: [
        {
          name: "Metro or sub-scale", type: "scatter",
          data: pts.filter((p) => !p.screened).map(mk), symbolSize: size,
          itemStyle: { color: t.ctx, opacity: 0.55, borderColor: t.surface, borderWidth: 1.5 },
          labelLayout: { hideOverlap: true },
          emphasis: { focus: "none", itemStyle: { opacity: 0.85 } },
          markLine: {
            silent: true, symbol: "none",
            lineStyle: { color: t.axis, width: 1 },
            label: { show: false },
            data: [{ xAxis: 0 }],
          },
        },
        {
          name: "Passes the resort screen", type: "scatter",
          data: pts.filter((p) => p.screened).map(mk), symbolSize: size,
          itemStyle: { color: t.s1, opacity: 0.9, borderColor: t.surface, borderWidth: 1.5 },
          labelLayout: { hideOverlap: true },
          emphasis: { focus: "none" },
        },
      ],
    };
  },
});

CHARTS.push({
  el: "chartMarket",
  ready: () => derived.reitReb && derived.nikReb,
  fail: "Market feed unavailable — reload to retry.",
  option(t) {
    const d = derived;
    return {
      grid: { left: 10, right: 104, top: 34, bottom: 10, containLabel: true },
      legend: legend(t),
      tooltip: baseTooltip(t, (v) => v.toFixed(1), prettyDay),
      xAxis: xTime(t),
      yAxis: yVal(t, (v) => v),
      series: [
        {
          ...line(t, "TSE REIT index ETF", d.reitReb, t.s1, `REIT ${fmtPct(d.reitYr, 0)}`),
          markLine: {
            silent: true, symbol: "none",
            lineStyle: { color: t.axis, width: 1 },
            label: { formatter: "1 yr ago = 100", position: "insideEndTop", color: t.muted, fontSize: 10.5, fontFamily: FONT },
            data: [{ yAxis: 100 }],
          },
        },
        line(t, "Nikkei 225 (context)", d.nikReb, t.ctx, `Nikkei ${fmtPct(d.nikYr, 0)}`),
      ],
    };
  },
});

function buildCharts() {
  instances.forEach((c) => c.dispose());
  instances = [];
  const t = tok();
  for (const def of CHARTS) {
    const el = $("#" + def.el);
    if (!el) continue;
    if (!def.ready()) { failCard(def.el, def.fail); continue; }
    el.innerHTML = "";
    if (def.pre) def.pre();
    const c = echarts.init(el, null, { renderer: "canvas" });
    c.setOption(def.option(t));
    instances.push(c);
  }
}
window.addEventListener("resize", () => instances.forEach((c) => c.resize()));

/* ---------------- tables & rank UI ---------------- */
function buildTable(rows, headers, numericFmt) {
  const th = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const body = rows.map((r) => "<tr>" + r.map((c, i) => {
    if (i === 0) return `<td>${esc(c)}</td>`;
    if (c == null) return "<td>–</td>";
    if (typeof c === "object") return `<td class="${c.cls || ""}">${esc(c.text)}</td>`;
    return `<td>${esc(c)}</td>`;
  }).join("") + "</tr>").join("");
  return `<div class="table-scroll"><table class="dv"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}
function fillDetails(id, html) {
  const el = $("#" + id);
  if (el) el.insertAdjacentHTML("beforeend", html);
}
function buildStatic() {
  if (staticBuilt) return;
  staticBuilt = true;
  const d = derived;

  if (store.jgb10 && store.policy) {
    const pol = new Map(store.policy.dates.map((dt, i) => [dt, store.policy.values[i]]));
    const rows = from(store.jgb10, "1990-01-01").dates.map((dt, i, arr) => {
      const v = from(store.jgb10, "1990-01-01").values[i];
      return [prettyMonth(dt), v.toFixed(2), pol.has(dt) ? pol.get(dt).toFixed(2) : null];
    });
    fillDetails("tableRates", buildTable(rows.reverse(), ["Month", "10-yr JGB %", "Overnight %"]));
  }
  if (store.nom && store.real) {
    const real = new Map(store.real.dates.map((dt, i) => [dt, store.real.values[i]]));
    const rows = from(store.nom, "1985-01-01").dates.map((dt, i) => {
      const v = from(store.nom, "1985-01-01").values[i];
      return [qLabel(dt), v.toFixed(1), real.has(dt) ? real.get(dt).toFixed(1) : null];
    });
    fillDetails("tablePrices", buildTable(rows.reverse(), ["Quarter", "Nominal (2010=100)", "Real (2010=100)"]));
  }
  if (d.usdIdx) {
    const rows = d.usdIdx.map((r) => [qLabel(r[0]), r[1].toFixed(1), r[2].toFixed(1)]);
    fillDetails("tableYen", buildTable(rows.reverse(), ["Quarter", "In yen (2019=100)", "In dollars (2019=100)"]));
  }
  if (store.reit && store.nikkei) {
    const nik = new Map(store.nikkei.dates.map((dt, i) => [dt, store.nikkei.values[i]]));
    const rows = d.reitReb.map(([dt]) => {
      const i = store.reit.dates.indexOf(dt);
      return [prettyDay(dt), "¥" + fmtN(store.reit.values[i]), nik.has(dt) ? fmtN(nik.get(dt)) : null];
    });
    fillDetails("tableMarket", buildTable(rows.reverse(), ["Date", "REIT ETF close", "Nikkei 225"]));
  }

  if (d.screened) {
    // top-3 cards
    $("#rankCards").innerHTML = d.screened.slice(0, 3).map((p) => `
      <div class="card rank-card">
        <div class="rc-top"><span class="rc-rank">No.${p.rank}</span><span class="rc-name">${esc(p.name)}</span><span class="rc-jp">${esc(p.name_ja)}</span></div>
        <div class="rc-stats">
          <div class="rc-stat"><span>Foreign nights vs 2019</span><b>${fmtPct(p.growth_pct, 0)}</b></div>
          <div class="rc-stat"><span>Long-haul guest share</span><b>${p.long_haul_share?.toFixed(0)}%</b></div>
          <div class="rc-stat"><span>Dec–Mar resort occupancy</span><b>${p.ski_occupancy?.toFixed(0)}%</b></div>
          <div class="rc-stat"><span>Foreign nights, ${d.latestYear}</span><b>${fmtM(p.nights_latest)}</b></div>
        </div>
      </div>`).join("");

    // full ranking table
    const rows = d.screened.map((p) => [
      `${p.rank} · ${p.name}`,
      p.region,
      fmtN(p.nights_latest),
      { text: fmtPct(p.growth_pct, 1), cls: p.growth_pct >= 0 ? "pos" : "neg" },
      p.long_haul_share?.toFixed(1) + "%",
      p.ski_occupancy?.toFixed(1) + "%",
      (p.score >= 0 ? "+" : "") + p.score.toFixed(2),
    ]);
    $("#rankTable").outerHTML = buildTable(rows,
      ["Prefecture", "Region", `Foreign nights '${String(d.latestYear).slice(2)}`, "vs 2019", "Long-haul", "Ski-season occ.", "Score"]);
  }
}

/* ---------------- boot ---------------- */
(async function main() {
  initTheme();
  $("#stamp").textContent = "fetching live data…";
  await loadAll();
  prepare();
  try { renderHero(); } catch (e) { console.error(e); }
  try { renderTiles(); } catch (e) { console.error(e); }
  try { renderSignals(); } catch (e) { console.error(e); }
  try { renderSubs(); } catch (e) { console.error(e); }
  try { buildStatic(); } catch (e) { console.error(e); }
  try { buildCharts(); } catch (e) { console.error(e); }
})();
