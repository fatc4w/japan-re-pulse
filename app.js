"use strict";
/* Japan Pulse — every figure computed in the browser from live sources.
   Charts: thin marks, solid hairline grid, one y-axis, validated palette
   (indigo / vermillion / bamboo), legends + selective direct labels, table view per chart. */

const $ = (s, r = document) => r.querySelector(s);
const FONT = "Inter, system-ui, sans-serif";
const S = {}; // raw sources
const D = {}; // derived
const charts = {}; // key → echarts instance

/* ---------------- helpers ---------------- */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtN = (n) => Math.round(n).toLocaleString("en-US");
const sgn = (v) => (v > 0 ? "+" : v < 0 ? "−" : "");
const fmtPct = (v, dp = 1) => `${sgn(v)}${Math.abs(v).toFixed(dp)}%`;
const fmtPP = (v, dp = 2) => `${sgn(v)}${Math.abs(v).toFixed(dp)}pp`;
const fmtM = (n, dp = 1) => (n / 1e6).toFixed(dp) + "M";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const prettyDay = (iso) => `${+iso.slice(8, 10)} ${MON[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
const prettyMonth = (iso) => `${MON[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
const qLabel = (iso) => `Q${Math.ceil(+iso.slice(5, 7) / 3)} ${iso.slice(0, 4)}`;
const msToIso = (ms) => new Date(ms).toISOString().slice(0, 10);
const last = (a) => a[a.length - 1];
const zip = (s) => s.dates.map((d, i) => [d, s.values[i]]);
const from = (s, iso) => {
  const i = Math.max(0, s.dates.findIndex((d) => d >= iso));
  return { dates: s.dates.slice(i), values: s.values.slice(i) };
};
function isoShift(iso, { years = 0, months = 0, days = 0 } = {}) {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
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
/* most recent year before `cutoff` where the series was at least (or at most) today's level */
function sinceYear(dates, values, cutoff, dir = "high") {
  const cur = last(values);
  for (let i = dates.length - 1; i >= 0; i--) {
    if (dates[i] >= cutoff) continue;
    if (dir === "high" ? values[i] >= cur : values[i] <= cur) return dates[i].slice(0, 4);
  }
  return null;
}
function hexToRgb(h) { return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); }
function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return "#" + A.map((x, i) => Math.round(x + (B[i] - x) * Math.min(1, Math.max(0, t))).toString(16).padStart(2, "0")).join("");
}

/* ---------------- tokens ---------------- */
const T = (() => {
  const cs = getComputedStyle(document.documentElement);
  const g = (n) => cs.getPropertyValue(n).trim();
  return {
    surface: g("--surface"), page: g("--page"), ink: g("--ink"), ink2: g("--ink2"), muted: g("--muted"),
    grid: g("--grid"), axis: g("--axis"), ctx: g("--ctx"),
    ai: g("--ai"), aiDeep: g("--ai-deep"), aiSoft: g("--ai-soft"),
    shu: g("--shu"), shuDeep: g("--shu-deep"), shuSoft: g("--shu-soft"),
    take: g("--take"), takeDeep: g("--take-deep"), takeSoft: g("--take-soft"),
    kin: g("--kin"), sakuraSoft: g("--sakura-soft"),
  };
})();
const MID = "#f3ece1"; // neutral midpoint for diverging fills

/* ---------------- data ---------------- */
const FRED = {
  nom: ["QJPN628BIS", "1970-01-01"],
  real: ["QJPR628BIS", "1970-01-01"],
  jgb10: ["IRLTLT01JPM156N", null],
  policy: ["IRSTCI01JPM156N", null],
  fx: ["DEXJPUS", null],
  nikkei: ["NIKKEI225", "2024-06-01"],
};
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}
async function loadAll() {
  const jobs = Object.entries(FRED).map(([k, [id, start]]) => [k, `/api/fred?id=${id}${start ? `&start=${start}` : ""}`]);
  jobs.push(
    ["reit", "/api/market?symbol=1343.T"],
    ["mlit", "/api/mlit"], ["miki", "/api/miki"], ["jnto", "/api/jnto"], ["jta", "/api/jta"], ["jreit", "/api/jreit"],
    ["tourism", "data/tourism.json"], ["geo", "data/japan.geojson"], ["mikiHist", "data/miki_tokyo_history.json"],
  );
  const res = await Promise.allSettled(jobs.map(([, u]) => fetchJSON(u)));
  res.forEach((r, i) => {
    if (r.status === "fulfilled") S[jobs[i][0]] = r.value;
    else console.warn("source failed:", jobs[i][0], r.reason);
  });
}

function prepare() {
  if (S.jgb10) {
    const s = S.jgb10;
    D.jgbLast = last(s.values);
    D.jgbYr = s.values[idxAtOrBefore(s.dates, isoShift(last(s.dates), { years: -1 }))];
    D.jgbSince = sinceYear(s.dates, s.values, "2020-01-01");
  }
  if (S.policy) {
    const s = S.policy;
    D.polLast = last(s.values);
    D.polYr = s.values[idxAtOrBefore(s.dates, isoShift(last(s.dates), { years: -1 }))];
    D.polSince = sinceYear(s.dates, s.values, "2020-01-01");
  }
  if (S.fx) {
    const s = S.fx;
    D.fxLast = last(s.values);
    D.fxWk = 100 * (D.fxLast / s.values[idxAtOrBefore(s.dates, isoShift(last(s.dates), { days: -7 }))] - 1);
    D.fxSince = sinceYear(s.dates, s.values, isoShift(last(s.dates), { years: -3 }));
    const acc = {};
    s.dates.forEach((d, i) => (acc[d.slice(0, 7)] ??= []).push(s.values[i]));
    D.fxMonthly = Object.fromEntries(Object.entries(acc).map(([m, v]) => [m, v.reduce((a, b) => a + b) / v.length]));
  }
  if (S.nom && S.fx) {
    const nom = from(S.nom, "2014-01-01"), rows = [];
    nom.dates.forEach((dt, i) => {
      const y = +dt.slice(0, 4), m = +dt.slice(5, 7);
      const fx = [m, m + 1, m + 2].map((mm) => D.fxMonthly[`${y}-${String(mm).padStart(2, "0")}`]).filter(Boolean);
      if (fx.length) rows.push([dt, nom.values[i], nom.values[i] / (fx.reduce((a, b) => a + b) / fx.length)]);
    });
    const b = rows.filter((r) => r[0].startsWith("2019"));
    const bY = b.reduce((a, r) => a + r[1], 0) / b.length, bU = b.reduce((a, r) => a + r[2], 0) / b.length;
    D.usdIdx = rows.map(([dt, y, u]) => [dt, (100 * y) / bY, (100 * u) / bU]);
  }
  if (S.nom) {
    D.peakVal = Math.max(...S.nom.values);
    D.peakDate = S.nom.dates[S.nom.values.indexOf(D.peakVal)];
  }
  if (S.mlit) {
    const r = S.mlit.residential;
    D.condoLast = last(r.condo);
    D.condoYoy = 100 * (D.condoLast / r.condo[r.condo.length - 13] - 1);
    D.condoRecord = D.condoLast >= Math.max(...r.condo);
    D.mlitAsOf = last(r.dates);
  }
  if (S.miki) {
    const tk = S.miki.cities.find((c) => c.city === "Tokyo");
    D.tokyo = tk;
    D.vacLast = last(tk.vacancy); D.vacYr = tk.vacancy[0];
    D.rentLast = last(tk.rent); D.rentYoy = 100 * (D.rentLast / tk.rent[0] - 1);
    // merged monthly history for "since" badges
    const map = new Map();
    if (S.mikiHist) S.mikiHist.months.forEach((m, i) => map.set(m, [S.mikiHist.vacancy[i], S.mikiHist.rent[i]]));
    tk.months.forEach((m, i) => map.set(m, [tk.vacancy[i], tk.rent[i]]));
    const months = [...map.keys()].sort();
    D.tokyoHist = { months, vacancy: months.map((m) => map.get(m)[0]), rent: months.map((m) => map.get(m)[1]) };
    const cut = tk.months[0];
    D.vacSince = sinceYear(months, D.tokyoHist.vacancy, cut, "low");
    D.rentSince = sinceYear(months, D.tokyoHist.rent, cut, "high");
  }
  if (S.jnto) {
    const j = S.jnto, y = j.year, m = j.last_month;
    D.visLast = j.totals[y][m - 1];
    D.visYoy = 100 * (D.visLast / j.totals[y - 1][m - 1] - 1);
    D.visMonth = MON[m - 1];
    const cn = j.markets.find((x) => x.market === "China");
    D.chinaYoy = cn?.yoy_pct;
  }
  if (S.reit) {
    const r = S.reit;
    D.reitLast = last(r.values);
    D.reitWk = 100 * (D.reitLast / r.values[idxAtOrBefore(r.dates, isoShift(last(r.dates), { days: -7 }))] - 1);
    D.reitOffHigh = 100 * (D.reitLast / (r.meta?.high52 ?? Math.max(...r.values.slice(-250))) - 1);
    const t0 = idxAtOrBefore(r.dates, isoShift(last(r.dates), { years: -1 }));
    D.reitReb = r.dates.slice(t0).map((d, i) => [d, (100 * r.values[t0 + i]) / r.values[t0]]);
    if (S.nikkei) {
      const n = S.nikkei, n0 = idxAtOrBefore(n.dates, D.reitReb[0][0]);
      D.nikReb = n.dates.slice(n0).map((d, i) => [d, (100 * n.values[n0 + i]) / n.values[n0]]);
    }
  }
  if (S.tourism) {
    const t = S.tourism;
    D.prefs = t.prefectures;
    D.byName = Object.fromEntries(t.prefectures.map((p) => [p.name, p]));
    D.screened = t.prefectures.filter((p) => p.screened).sort((a, b) => a.rank - b.rank);
    D.maxNights = Math.max(...t.prefectures.map((p) => p.nights_latest || 0));
    D.ty = t.meta.latest_year; D.by = t.meta.base_year;
    // live month vs same month of the baked year (only when the live release is the following year)
    if (S.jta && S.jta.year === t.meta.latest_year + 1) {
      const m = S.jta.month;
      D.jtaLabel = `${MON[m - 1]} ${S.jta.year}`;
      for (const p of t.prefectures) {
        const live = S.jta.prefectures[p.name];
        const base = p.monthly_nights_latest?.[m - 1];
        p.live_yoy = live && base ? 100 * (live.foreign_nights / base - 1) : null;
        p.live_occ = live?.occupancy ?? null;
        p.live_nights = live?.foreign_nights ?? null;
      }
    }
  }
}

/* ---------------- tiles ---------------- */
function spark(values, color, w = 96, h = 32) {
  if (!values || values.length < 2) return "";
  const v = values.filter((x) => x != null);
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1, pad = 3;
  const pts = v.map((y, i) => [pad + (i / (v.length - 1)) * (w - 2 * pad), h - pad - ((y - min) / span) * (h - 2 * pad)]);
  const [lx, ly] = last(pts);
  const poly = pts.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" ");
  return `<svg class="t-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <polygon points="${pad},${h} ${poly} ${lx.toFixed(1)},${h}" fill="${color}" opacity="0.10"/>
    <polyline points="${poly}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3.2" fill="${color}" stroke="${T.surface}" stroke-width="1.5"/></svg>`;
}
function renderTiles() {
  const tiles = [];
  const dcls = (v, goodUp) => (goodUp == null ? "" : (v > 0) === goodUp ? "up" : "down");
  if (S.jgb10) tiles.push({ c: T.ai, label: "10-year JGB yield", value: `${D.jgbLast.toFixed(2)}<small>%</small>`,
    delta: [`${fmtPP(D.jgbLast - D.jgbYr)} y/y`, ""], badge: D.jgbSince ? `Highest since ${D.jgbSince}` : "Record high",
    spark: S.jgb10.values.slice(-48) });
  if (S.policy) tiles.push({ c: T.shu, label: "Overnight call rate", value: `${D.polLast.toFixed(2)}<small>%</small>`,
    delta: [`${fmtPP(D.polLast - D.polYr)} y/y`, ""], badge: D.polSince ? `Highest since ${D.polSince}` : null,
    spark: S.policy.values.slice(-48) });
  if (S.fx) tiles.push({ c: T.kin, label: "Yen per dollar", value: `¥${D.fxLast.toFixed(1)}`,
    delta: [`${fmtPct(D.fxWk)} w/w`, ""], badge: D.fxSince ? `Weakest since ${D.fxSince}` : null,
    spark: S.fx.values.slice(-130) });
  if (D.tokyo) tiles.push({ c: T.take, label: "Tokyo office vacancy", value: `${D.vacLast.toFixed(2)}<small>%</small>`,
    delta: [`${fmtPP(D.vacLast - D.vacYr)} y/y`, dcls(D.vacLast - D.vacYr, false)], badge: D.vacSince ? `Lowest since ${D.vacSince}` : "Record low",
    spark: D.tokyo.vacancy });
  if (D.tokyo) tiles.push({ c: T.ai, label: "Tokyo office rent", value: `¥${fmtN(D.rentLast)}<small>/tsubo</small>`,
    delta: [`${fmtPct(D.rentYoy)} y/y`, dcls(D.rentYoy, true)], badge: D.rentSince ? `Highest since ${D.rentSince}` : "Record high",
    spark: D.tokyo.rent });
  if (S.mlit) tiles.push({ c: T.shu, label: "Condo price index", value: `${D.condoLast.toFixed(0)}<small> 2010=100</small>`,
    delta: [`${fmtPct(D.condoYoy)} y/y`, dcls(D.condoYoy, true)], badge: D.condoRecord ? "Record high" : null,
    spark: S.mlit.residential.condo.slice(-60) });
  if (S.jnto) {
    const j = S.jnto;
    const series = [...j.totals[j.year - 1], ...j.totals[j.year].slice(0, j.last_month)];
    tiles.push({ c: T.take, label: `Visitor arrivals · ${D.visMonth}`, value: `${fmtM(D.visLast, 2)}`,
      delta: [`${fmtPct(D.visYoy)} y/y`, dcls(D.visYoy, true)], badge: D.chinaYoy != null ? `China ${fmtPct(D.chinaYoy, 0)} YTD` : null,
      spark: series });
  }
  if (S.reit) tiles.push({ c: T.kin, label: "J-REIT index ETF", value: `¥${fmtN(D.reitLast)}`,
    delta: [`${fmtPct(D.reitWk)} w/w`, dcls(D.reitWk, true)], badge: `${fmtPct(D.reitOffHigh, 0)} vs 52w high`,
    spark: S.reit.values.slice(-130) });

  $("#kpis").innerHTML = tiles.map((t) => `
    <div class="tile" style="--c:${t.c}">
      <p class="t-label">${esc(t.label)}</p>
      <div class="t-row"><span class="t-value">${t.value}</span>${spark(t.spark, t.c)}</div>
      <div class="t-foot"><span class="delta ${t.delta[1]}">${esc(t.delta[0])}</span>${t.badge ? `<span class="badge">${esc(t.badge)}</span>` : ""}</div>
    </div>`).join("");
}

/* ---------------- echarts building blocks ---------------- */
const TIP = {
  backgroundColor: "#fffdf9", borderColor: "#ece4d6", borderWidth: 1, padding: [9, 13],
  textStyle: { color: "#1f1b16", fontFamily: FONT, fontSize: 12 },
  extraCssText: "box-shadow:0 8px 24px rgba(60,40,10,.14);border-radius:12px;",
};
const key = (color, w = 12, h = 3) => `<span class="tt-key" style="background:${color};width:${w}px;height:${h}px"></span>`;
const row = (color, val, name) => `<div class="tt-row">${color ? key(color) : ""}<b>${val}</b><span class="tt-name">${esc(name)}</span></div>`;
function axisTip(valueFmt, titleFmt) {
  return {
    ...TIP, trigger: "axis",
    axisPointer: { type: "line", lineStyle: { color: T.axis, width: 1, type: "solid" } },
    formatter: (ps) => {
      const arr = Array.isArray(ps) ? ps : [ps];
      const raw = arr[0].axisValue;
      const title = titleFmt(typeof raw === "number" ? msToIso(raw) : raw);
      return `<div class="tt-title">${esc(title)}</div>` + arr
        .filter((p) => p.seriesName && !p.seriesName.startsWith("_"))
        .map((p) => {
          const v = Array.isArray(p.value) ? p.value[1] : p.value;
          return v == null ? "" : row(p.color, valueFmt(v), p.seriesName);
        }).join("");
    },
  };
}
const axisLabel = (fmt) => ({ color: T.muted, fontSize: 11, fontFamily: FONT, formatter: fmt, hideOverlap: true });
const xTime = () => ({ type: "time", axisLine: { lineStyle: { color: T.axis } }, axisTick: { show: false }, axisLabel: axisLabel(), splitLine: { show: false } });
const yVal = (fmt, extra = {}) => ({
  type: "value", scale: true, axisLabel: axisLabel(fmt),
  splitLine: { lineStyle: { color: T.grid } }, axisLine: { show: false }, axisTick: { show: false }, ...extra,
});
const legend = (extra = {}) => ({ top: 0, left: 0, icon: "roundRect", itemWidth: 14, itemHeight: 4, textStyle: { color: T.ink2, fontSize: 12, fontFamily: FONT }, itemGap: 16, ...extra });
function line(name, data, color, end, extra = {}) {
  return {
    name, type: "line", data, showSymbol: false, symbol: "circle", symbolSize: 8,
    itemStyle: { color, borderColor: T.surface, borderWidth: 2 },
    lineStyle: { color, width: 2, cap: "round", join: "round" },
    emphasis: { focus: "none" },
    endLabel: end ? { show: true, formatter: () => end, color: T.ink2, fontSize: 11, fontWeight: 600, fontFamily: FONT, distance: 8 } : undefined,
    ...extra,
  };
}
const hline = (y, label) => ({
  silent: true, symbol: "none", lineStyle: { color: T.axis, width: 1, type: "solid" },
  label: { formatter: label, position: "insideEndTop", color: T.muted, fontSize: 10.5, fontFamily: FONT },
  data: [{ yAxis: y }],
});
const grid = (r = 70, extra = {}) => ({ left: 4, right: r, top: 34, bottom: 4, containLabel: true, ...extra });

/* ---------------- chart registry ---------------- */
const CHARTS = {
  rates: {
    title: "Policy rate & 10-year JGB",
    ready: () => S.jgb10 && S.policy,
    chip: () => [`10Y ${D.jgbLast.toFixed(2)}%`, ""],
    foot: () => `OECD via FRED · monthly to ${prettyMonth(last(S.jgb10.dates))}`,
    option: () => ({
      grid: grid(64), legend: legend(), tooltip: axisTip((v) => v.toFixed(2) + "%", prettyMonth),
      xAxis: xTime(), yAxis: yVal((v) => v + "%"),
      series: [
        line("10-year JGB", zip(from(S.jgb10, "1990-01-01")), T.ai, `${D.jgbLast.toFixed(1)}%`),
        line("Overnight call rate", zip(from(S.policy, "1990-01-01")), T.shu, `${D.polLast.toFixed(1)}%`, {
          markArea: {
            silent: true, itemStyle: { color: T.shuSoft, opacity: 0.55 },
            label: { color: T.shuDeep, fontSize: 10.5, fontFamily: FONT, position: "insideTop" },
            data: [[{ name: "Negative rates", xAxis: "2016-02-01" }, { xAxis: "2024-03-01" }]],
          },
        }),
      ],
    }),
    table: () => {
      const pol = new Map(S.policy.dates.map((d, i) => [d, S.policy.values[i]]));
      return [["Month", "10Y JGB %", "Overnight %"], from(S.jgb10, "1990-01-01").dates.map((d, i, a) =>
        [prettyMonth(d), from(S.jgb10, "1990-01-01").values[i].toFixed(2), pol.get(d)?.toFixed(2) ?? "–"]).reverse()];
    },
  },

  yen: {
    title: "Japan's home-price index in yen vs dollars",
    ready: () => D.usdIdx,
    chip: () => [`$ ${fmtPct(last(D.usdIdx)[2] - 100, 0)} since 2019`, "shu"],
    foot: () => `BIS residential index via FRED, converted at Fed ¥/$ · 2019 = 100 · to ${qLabel(last(D.usdIdx)[0])}`,
    option: () => ({
      grid: grid(64), legend: legend(), tooltip: axisTip((v) => v.toFixed(1), qLabel),
      xAxis: xTime(), yAxis: yVal((v) => v),
      series: [
        { ...line("In yen", D.usdIdx.map((r) => [r[0], r[1]]), T.ai, `¥ ${fmtPct(last(D.usdIdx)[1] - 100, 0)}`), markLine: hline(100, "2019 = 100") },
        line("In dollars", D.usdIdx.map((r) => [r[0], r[2]]), T.shu, `$ ${fmtPct(last(D.usdIdx)[2] - 100, 0)}`),
      ],
    }),
    table: () => [["Quarter", "In yen", "In dollars"], D.usdIdx.map((r) => [qLabel(r[0]), r[1].toFixed(1), r[2].toFixed(1)]).reverse()],
  },

  residential: {
    title: "Home prices by type",
    ready: () => S.mlit,
    chip: () => [`Condos ${D.condoLast.toFixed(0)}`, "shu"],
    foot: () => `MLIT Real Estate Price Index · 2010 = 100 · to ${prettyMonth(D.mlitAsOf)}${S.mlit.publication_paused ? " · MLIT has paused newer releases" : ""}`,
    option: () => {
      const r = S.mlit.residential, z = (k) => r.dates.map((d, i) => [d, r[k][i]]);
      return {
        grid: grid(84), legend: legend(), tooltip: axisTip((v) => v.toFixed(1), prettyMonth),
        xAxis: xTime(), yAxis: yVal((v) => v),
        series: [
          { ...line("Condominiums", z("condo"), T.ai, `Condos ${last(r.condo).toFixed(0)}`), markLine: hline(100, "2010 = 100") },
          line("Detached houses", z("detached"), T.shu),
          line("Residential land", z("land"), T.take),
        ],
      };
    },
    table: () => {
      const r = S.mlit.residential;
      return [["Month", "Condos", "Detached", "Land"], r.dates.map((d, i) => [prettyMonth(d), r.condo[i]?.toFixed(1), r.detached[i]?.toFixed(1), r.land[i]?.toFixed(1)]).reverse()];
    },
  },

  commercial: {
    title: "Commercial property prices vs 2010",
    ready: () => S.mlit,
    chip: () => [qLabel(last(S.mlit.commercial.dates)), ""],
    foot: () => "MLIT Real Estate Price Index, commercial · national, seasonally adjusted · bar = % above 2010 average",
    rows: () => {
      const c = S.mlit.commercial, n = c.dates.length;
      const types = [["apartment", "Apartments"], ["office", "Offices"], ["retail", "Retail"], ["warehouse", "Warehouses"],
        ["factory", "Factories"], ["industrial_land", "Industrial land"], ["commercial_land", "Commercial land"]];
      return types.map(([k, name]) => ({ name, idx: c[k][n - 1], yoy: 100 * (c[k][n - 1] / c[k][n - 5] - 1) }))
        .sort((a, b) => a.idx - b.idx);
    },
    option() {
      const rows = this.rows();
      return {
        grid: { left: 4, right: 56, top: 8, bottom: 4, containLabel: true },
        tooltip: { ...TIP, trigger: "item", formatter: (p) => { const r = rows[p.dataIndex];
          return `<div class="tt-title">${esc(r.name)}</div>${row(null, r.idx.toFixed(1), "index, 2010 = 100")}${row(null, fmtPct(r.yoy), "vs a year earlier")}`; } },
        xAxis: { type: "value", axisLabel: axisLabel((v) => `+${v}%`), splitLine: { lineStyle: { color: T.grid } } },
        yAxis: { type: "category", data: rows.map((r) => r.name), axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { color: T.ink2, fontSize: 12, fontFamily: FONT } },
        series: [{
          type: "bar", data: rows.map((r) => ({ value: r.idx - 100, itemStyle: { color: r.idx >= 100 ? T.ai : T.shu } })),
          barMaxWidth: 18, itemStyle: { borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: "right", color: T.ink2, fontSize: 11.5, fontWeight: 600, fontFamily: FONT, formatter: (p) => fmtPct(p.value, 0) },
        }],
      };
    },
    table() { return [["Type", "Index", "vs 2010", "y/y"], [...this.rows()].reverse().map((r) => [r.name, r.idx.toFixed(1), fmtPct(r.idx - 100, 0), fmtPct(r.yoy)])]; },
  },

  longrun: {
    title: "Home prices since 1970, nominal vs inflation-adjusted",
    ready: () => S.nom && S.real,
    chip: () => [`${fmtPct(100 * (last(S.nom.values) / D.peakVal - 1), 0)} vs ${D.peakDate.slice(0, 4)} peak`, "kin"],
    foot: () => `BIS residential property prices via FRED · 2010 = 100 · to ${qLabel(last(S.nom.dates))}`,
    option: () => ({
      grid: grid(84), legend: legend({ data: ["Nominal", "Inflation-adjusted"] }), tooltip: axisTip((v) => v.toFixed(1), qLabel),
      xAxis: xTime(), yAxis: yVal((v) => v),
      series: [
        line("Nominal", zip(S.nom), T.ai, `Nominal ${last(S.nom.values).toFixed(0)}`),
        line("Inflation-adjusted", zip(S.real), T.shu, `Real ${last(S.real.values).toFixed(0)}`),
        { name: "_peak", type: "scatter", data: [[D.peakDate, D.peakVal]], symbolSize: 10, silent: true,
          itemStyle: { color: T.kin, borderColor: T.surface, borderWidth: 2 },
          label: { show: true, position: "top", distance: 8, color: T.ink2, fontSize: 11, fontWeight: 600, fontFamily: FONT, formatter: `${D.peakDate.slice(0, 4)} bubble peak` } },
      ],
    }),
    table: () => {
      const real = new Map(S.real.dates.map((d, i) => [d, S.real.values[i]]));
      return [["Quarter", "Nominal", "Real"], S.nom.dates.map((d, i) => [qLabel(d), S.nom.values[i].toFixed(1), real.get(d)?.toFixed(1) ?? "–"]).reverse()];
    },
  },

  rentclock: {
    title: "Tokyo office rent clock",
    ready: () => D.tokyoHist && S.mikiHist,
    chip: () => [`${D.vacLast.toFixed(2)}% · ¥${fmtN(D.rentLast)}`, "take"],
    foot: () => `Miki Shoji · 5 central wards · December each year since 1996, plus ${prettyMonth(last(D.tokyo.months) + "-01")} · rent in ¥ per tsubo per month`,
    points() {
      const h = D.tokyoHist, pts = [];
      h.months.forEach((m, i) => { if (m.endsWith("-12") && m >= "1996") pts.push({ m, v: h.vacancy[i], r: h.rent[i] }); });
      const lm = last(D.tokyo.months);
      if (lm > last(pts).m) pts.push({ m: lm, v: D.vacLast, r: D.rentLast, now: true });
      return pts;
    },
    option() {
      const pts = this.points();
      const LAB = new Set(["1996", "2000", "2003", "2007", "2011", "2015", "2019", "2022"]);
      const split = pts.findIndex((p) => p.m.startsWith("2019"));
      const item = (p) => ({
        value: [p.v, p.r / 1000, p.m],
        symbolSize: p.now ? 14 : 6,
        itemStyle: p.now ? { color: T.shu, borderColor: T.surface, borderWidth: 3 } : undefined,
        label: p.now
          ? { show: true, formatter: "Now", position: "right", color: T.shuDeep, fontWeight: 700, fontSize: 12, fontFamily: FONT }
          : LAB.has(p.m.slice(0, 4)) ? { show: true, formatter: p.m.slice(0, 4), position: "right", color: T.muted, fontSize: 10.5, fontFamily: FONT } : undefined,
      });
      const base = { type: "line", symbol: "circle", showSymbol: true, lineStyle: { width: 2 }, emphasis: { focus: "none" } };
      return {
        grid: { left: 4, right: 24, top: 34, bottom: 26, containLabel: true },
        legend: legend({ left: "auto", right: 0 }),
        tooltip: { ...TIP, trigger: "item", formatter: (p) => `<div class="tt-title">${esc(prettyMonth(p.value[2] + "-01"))}</div>` +
          row(null, p.value[0].toFixed(2) + "%", "vacancy") + row(null, "¥" + fmtN(p.value[1] * 1000), "rent per tsubo") },
        xAxis: { type: "value", name: "Vacancy", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: T.muted, fontSize: 11, fontFamily: FONT },
          axisLabel: axisLabel((v) => v + "%"), splitLine: { lineStyle: { color: T.grid } }, axisLine: { lineStyle: { color: T.axis } }, axisTick: { show: false } },
        yAxis: yVal((v) => `¥${v}k`, { name: "Rent", nameTextStyle: { color: T.muted, fontSize: 11, fontFamily: FONT, align: "left" } }),
        series: [
          { ...base, name: "1996–2019", data: pts.slice(0, split + 1).map(item), itemStyle: { color: T.ai }, lineStyle: { color: T.ai, width: 1.6, opacity: 0.55 } },
          { ...base, name: "2019–now", data: pts.slice(split).map(item), itemStyle: { color: T.shu }, lineStyle: { color: T.shu, width: 2.2 } },
        ],
      };
    },
    table() { return [["Month", "Vacancy %", "Rent ¥/tsubo"], [...this.points()].reverse().map((p) => [prettyMonth(p.m + "-01"), p.v.toFixed(2), fmtN(p.r)])]; },
  },

  cities: {
    title: "Office markets by city",
    ready: () => S.miki,
    chip: () => [prettyMonth(S.miki.as_of + "-01"), ""],
    foot: () => "Miki Shoji · main business districts · bubble size = average rent",
    rows: () => S.miki.cities.map((c) => ({ city: c.city, vac: last(c.vacancy), rent: last(c.rent), yoy: 100 * (last(c.rent) / c.rent[0] - 1), vac0: c.vacancy[0] })),
    option() {
      const rows = this.rows(), maxR = Math.max(...rows.map((r) => r.rent));
      const pos = rows.map(() => "right");
      rows.forEach((a, i) => rows.forEach((b, j) => {
        if (j <= i || Math.abs(a.vac - b.vac) > 0.4 || Math.abs(a.yoy - b.yoy) > 1.2) return;
        [pos[i], pos[j]] = a.vac <= b.vac ? ["left", "right"] : ["right", "left"];
      }));
      return {
        grid: { left: 4, right: 30, top: 34, bottom: 26, containLabel: true },
        tooltip: { ...TIP, trigger: "item", formatter: (p) => { const r = rows[p.dataIndex];
          return `<div class="tt-title">${esc(r.city)}</div>${row(null, r.vac.toFixed(2) + "%", `vacancy (${fmtPP(r.vac - r.vac0)} y/y)`)}${row(null, "¥" + fmtN(r.rent), "rent per tsubo")}${row(null, fmtPct(r.yoy), "rent y/y")}`; } },
        xAxis: { type: "value", name: "Vacancy", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: T.muted, fontSize: 11, fontFamily: FONT },
          min: 0, max: (e) => Math.ceil(e.max + 0.8), axisLabel: axisLabel((v) => v + "%"), splitLine: { lineStyle: { color: T.grid } }, axisLine: { lineStyle: { color: T.axis } }, axisTick: { show: false } },
        yAxis: yVal((v) => `+${v}%`, { name: "Rent growth, 1 year", min: 0, max: (e) => Math.ceil(e.max + 2), nameTextStyle: { color: T.muted, fontSize: 11, fontFamily: FONT, align: "left" } }),
        series: [{
          type: "scatter",
          data: rows.map((r, i) => ({
            value: [r.vac, r.yoy],
            symbolSize: 10 + 40 * Math.sqrt(r.rent / maxR),
            itemStyle: { color: r.city === "Tokyo" ? T.shu : T.ai, opacity: 0.85, borderColor: T.surface, borderWidth: 2 },
            label: { show: true, formatter: r.city, position: pos[i], distance: 6, color: T.ink, fontSize: 12, fontWeight: 600, fontFamily: FONT },
          })),
          emphasis: { focus: "none", scale: 1.08 },
        }],
      };
    },
    table() { return [["City", "Vacancy %", "Rent ¥/tsubo", "Rent y/y"], this.rows().map((r) => [r.city, r.vac.toFixed(2), fmtN(r.rent), fmtPct(r.yoy)])]; },
  },

  wards: {
    title: "Tokyo's central wards: vacancy a year ago → now",
    ready: () => S.miki?.tokyo_wards?.length,
    chip: () => { const w = S.miki.tokyo_wards; const tight = w.reduce((a, b) => (last(a.vacancy) < last(b.vacancy) ? a : b)); return [`Tightest: ${tight.ward} ${last(tight.vacancy).toFixed(2)}%`, "take"]; },
    foot: () => "Miki Shoji · Chiyoda, Chuo, Minato, Shinjuku, Shibuya",
    option() {
      const w = [...S.miki.tokyo_wards].sort((a, b) => last(b.vacancy) - last(a.vacancy));
      return {
        grid: { left: 4, right: 30, top: 26, bottom: 4, containLabel: true },
        legend: legend({ data: ["A year ago", "Now"] }),
        tooltip: { ...TIP, trigger: "item", formatter: (p) => { const x = w[p.data.i];
          return `<div class="tt-title">${esc(x.ward)}</div>${row(T.ctx, x.vacancy[0].toFixed(2) + "%", "vacancy a year ago")}${row(T.ai, last(x.vacancy).toFixed(2) + "%", "vacancy now")}${row(null, "¥" + fmtN(last(x.rent)), `rent (${fmtPct(100 * (last(x.rent) / x.rent[0] - 1))} y/y)`)}`; } },
        xAxis: { type: "value", min: 0, axisLabel: axisLabel((v) => v + "%"), splitLine: { lineStyle: { color: T.grid } } },
        yAxis: { type: "category", data: w.map((x) => x.ward), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: T.ink2, fontSize: 12, fontFamily: FONT } },
        series: [
          { type: "custom", silent: true, z: 1, encode: { x: [0, 1], y: 2 }, data: w.map((x, i) => [x.vacancy[0], last(x.vacancy), i]),
            renderItem: (params, api) => { const a = api.coord([api.value(0), api.value(2)]), b = api.coord([api.value(1), api.value(2)]);
              return { type: "line", shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, style: { stroke: T.axis, lineWidth: 4, lineCap: "round" } }; } },
          { name: "A year ago", type: "scatter", z: 2, symbolSize: 11, itemStyle: { color: T.ctx, borderColor: T.surface, borderWidth: 2 },
            data: w.map((x, i) => ({ value: [x.vacancy[0], i], i })) },
          { name: "Now", type: "scatter", z: 3, symbolSize: 14, itemStyle: { color: T.ai, borderColor: T.surface, borderWidth: 2 },
            data: w.map((x, i) => ({ value: [last(x.vacancy), i], i, label: { show: true, position: "left", distance: 8, formatter: last(x.vacancy).toFixed(2) + "%", color: T.ink, fontWeight: 600, fontSize: 11.5, fontFamily: FONT } })) },
        ],
      };
    },
    table: () => [["Ward", "Vacancy a year ago %", "Vacancy now %", "Rent ¥/tsubo"], S.miki.tokyo_wards.map((x) => [x.ward, x.vacancy[0].toFixed(2), last(x.vacancy).toFixed(2), fmtN(last(x.rent))])],
  },

  screen: {
    title: "Resort-hotel destination screen",
    ready: () => D.prefs,
    chip: () => [`#1 ${D.screened[0].name}`, "shu"],
    foot: () => `JTA ${D.ty} vs ${D.by} · bubble size = foreign guest nights · blue = regional, 0.5M+ foreign nights · top-right = growth + long-haul guests`,
    option() {
      const pts = D.prefs.filter((p) => p.growth_pct != null && p.long_haul_share != null);
      const lh = pts.map((p) => p.long_haul_share).sort((a, b) => a - b), med = lh[Math.floor(lh.length / 2)];
      const xMax = Math.ceil((Math.max(...pts.map((p) => p.growth_pct)) + 15) / 30) * 30;
      const yMax = Math.ceil((Math.max(...lh) + 4) / 10) * 10;
      const labeled = new Set([...D.screened.slice(0, 5).map((p) => p.name), "Tokyo", "Osaka", "Hokkaido", "Kyoto"]);
      const mk = (p) => ({
        value: [p.growth_pct, p.long_haul_share, p.nights_latest, p.name],
        label: labeled.has(p.name) ? { show: true, position: "right", distance: 4, formatter: p.name, color: T.ink2, fontSize: 11, fontWeight: 600, fontFamily: FONT } : undefined,
      });
      const size = (v) => 8 + 46 * Math.sqrt(v[2] / D.maxNights);
      return {
        grid: { left: 4, right: 24, top: 30, bottom: 28, containLabel: true },
        legend: legend({ data: ["Passes the screen", "Metro or small"], icon: "circle", itemWidth: 10, itemHeight: 10, left: "auto", right: 0 }),
        tooltip: { ...TIP, trigger: "item", formatter: (p) => mapTip(p.value?.[3]) },
        xAxis: { type: "value", min: -40, max: xMax, name: `Foreign nights vs ${D.by}`, nameLocation: "middle", nameGap: 26,
          nameTextStyle: { color: T.muted, fontSize: 11, fontFamily: FONT }, axisLabel: axisLabel((v) => `${v > 0 ? "+" : ""}${v}%`),
          splitLine: { lineStyle: { color: T.grid } }, axisLine: { show: false }, axisTick: { show: false } },
        yAxis: yVal((v) => v + "%", { min: 0, max: yMax, scale: false, name: "Long-haul guest share", nameTextStyle: { color: T.muted, fontSize: 11, fontFamily: FONT, align: "left" } }),
        series: [
          { name: "Metro or small", type: "scatter", data: pts.filter((p) => !p.screened).map(mk), symbolSize: size,
            itemStyle: { color: T.ctx, opacity: 0.6, borderColor: T.surface, borderWidth: 1.5 }, labelLayout: { hideOverlap: true }, emphasis: { focus: "none" },
            markArea: { silent: true, itemStyle: { color: T.sakuraSoft, opacity: 0.9 },
              label: { color: "#b24a66", fontSize: 11, fontWeight: 700, fontFamily: FONT, position: "insideTopRight" },
              data: [[{ name: "Sweet spot", xAxis: 0, yAxis: med }, { xAxis: xMax, yAxis: yMax }]] },
            markLine: { silent: true, symbol: "none", lineStyle: { color: T.axis, width: 1, type: "solid" }, label: { show: false }, data: [{ xAxis: 0 }] } },
          { name: "Passes the screen", type: "scatter", data: pts.filter((p) => p.screened).map(mk), symbolSize: size,
            itemStyle: { color: T.ai, opacity: 0.88, borderColor: T.surface, borderWidth: 1.5 }, labelLayout: { hideOverlap: true }, emphasis: { focus: "none" } },
        ],
      };
    },
    table: () => [["Rank · prefecture", "Foreign nights", `vs ${D.by}`, "Long-haul", "Ski-season occ.", "Score"],
      D.screened.map((p) => [`${p.rank} · ${p.name}`, fmtN(p.nights_latest), fmtPct(p.growth_pct), p.long_haul_share.toFixed(1) + "%", p.ski_occupancy.toFixed(1) + "%", (p.score >= 0 ? "+" : "") + p.score.toFixed(2)])],
  },

  arrivals: {
    title: "Monthly visitor arrivals",
    ready: () => S.jnto,
    chip: () => [`${D.visMonth} ${fmtPct(D.visYoy)} y/y`, D.visYoy < 0 ? "shu" : "take"],
    foot: () => `JNTO · latest months are JNTO estimates`,
    option: () => {
      const j = S.jnto, y = j.year;
      const s = (yr) => (j.totals[yr] || []).map((v) => (v == null ? null : v / 1e6));
      const lastV = j.totals[y][j.last_month - 1] / 1e6;
      return {
        grid: grid(58), legend: legend(),
        tooltip: axisTip((v) => v.toFixed(2) + "M", (m) => m),
        xAxis: { type: "category", data: MON, boundaryGap: false, axisLine: { lineStyle: { color: T.axis } }, axisTick: { show: false }, axisLabel: axisLabel() },
        yAxis: yVal((v) => v + "M", { min: 2 }),
        series: [
          line("2019", s(2019), T.ctx, "2019"),
          line(String(y - 1), s(y - 1), T.ai, String(y - 1)),
          line(String(y), s(y).slice(0, j.last_month), T.shu, `${lastV.toFixed(2)}M`, { lineStyle: { color: T.shu, width: 3 } }),
        ],
      };
    },
    table: () => { const j = S.jnto, y = j.year;
      return [["Month", "2019", String(y - 1), String(y)], MON.map((m, i) => [m, fmtN(j.totals[2019][i]), fmtN(j.totals[y - 1][i]), j.totals[y][i] != null ? fmtN(j.totals[y][i]) : "–"])]; },
  },

  markets: {
    title: "Who's coming: arrivals by market, year to date",
    ready: () => S.jnto,
    chip: () => [`Jan–${D.visMonth} vs last year`, ""],
    foot: () => "JNTO · largest 14 source markets by arrivals",
    rows: () => [...S.jnto.markets].sort((a, b) => b.ytd - a.ytd).slice(0, 14).sort((a, b) => a.yoy_pct - b.yoy_pct),
    option() {
      const rows = this.rows();
      return {
        grid: { left: 4, right: 50, top: 6, bottom: 4, containLabel: true },
        tooltip: { ...TIP, trigger: "item", formatter: (p) => { const r = rows[p.dataIndex];
          return `<div class="tt-title">${esc(r.market)} · Jan–${D.visMonth}</div>${row(null, fmtN(r.ytd), "arrivals")}${row(null, fmtPct(r.yoy_pct), "vs last year")}${r.ytd_2019 ? row(null, fmtPct(100 * (r.ytd / r.ytd_2019 - 1)), "vs 2019") : ""}`; } },
        xAxis: { type: "value", axisLabel: axisLabel((v) => `${v > 0 ? "+" : ""}${v}%`), splitLine: { lineStyle: { color: T.grid } } },
        yAxis: { type: "category", data: rows.map((r) => r.market), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: T.ink2, fontSize: 11.5, fontFamily: FONT } },
        series: [{
          type: "bar", barMaxWidth: 14,
          data: rows.map((r) => ({
            value: r.yoy_pct,
            itemStyle: { color: r.yoy_pct >= 0 ? T.ai : T.shu, borderRadius: r.yoy_pct >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] },
            label: r.yoy_pct >= 0 ? { position: "right" } : r.yoy_pct < -15 ? { position: "insideLeft", color: "#fff" } : { position: "left" },
          })),
          label: { show: true, color: T.ink2, fontSize: 11, fontWeight: 600, fontFamily: FONT, formatter: (p) => fmtPct(p.value, 0) },
        }],
      };
    },
    table() { return [["Market", "Arrivals YTD", "vs last year", "vs 2019"], [...this.rows()].reverse().map((r) => [r.market, fmtN(r.ytd), fmtPct(r.yoy_pct), r.ytd_2019 ? fmtPct(100 * (r.ytd / r.ytd_2019 - 1)) : "–"])]; },
  },

  market: {
    title: "Listed REITs vs the Nikkei, past year",
    ready: () => D.reitReb && D.nikReb,
    chip: () => [`REITs ${fmtPct(last(D.reitReb)[1] - 100)}`, last(D.reitReb)[1] < 100 ? "shu" : "take"],
    foot: () => `TSE REIT Index ETF (1343) via Yahoo Finance · Nikkei 225 via FRED · 1 year ago = 100`,
    option: () => ({
      grid: grid(84), legend: legend(), tooltip: axisTip((v) => v.toFixed(1), prettyDay),
      xAxis: xTime(), yAxis: yVal((v) => v),
      series: [
        { ...line("J-REIT index ETF", D.reitReb, T.ai, `REITs ${fmtPct(last(D.reitReb)[1] - 100, 0)}`), markLine: hline(100, "1 year ago") },
        line("Nikkei 225", D.nikReb, T.ctx, `Nikkei ${fmtPct(last(D.nikReb)[1] - 100, 0)}`),
      ],
    }),
    table: () => { const nik = new Map(D.nikReb); return [["Date", "REIT ETF", "Nikkei"], D.reitReb.map(([d, v]) => [prettyDay(d), v.toFixed(1), nik.get(d)?.toFixed(1) ?? "–"]).reverse()]; },
  },

  jreit: {
    title: "J-REIT yields by sector",
    ready: () => S.jreit,
    chip: () => { const avg = S.jreit.reits.reduce((a, r) => a + r.yield, 0) / S.jreit.reits.length;
      return [`Avg ${avg.toFixed(1)}%${D.jgbLast ? ` · ${(avg - D.jgbLast).toFixed(1)}pp over JGB` : ""}`, "kin"]; },
    foot: () => "Yahoo Finance · yield = latest payout annualised · bubble size = daily trading value · colour = 1-year price change",
    SECTORS: ["Hotel", "Retail", "Diversified", "Residential", "Logistics", "Office"],
    legendBar() {
      const rs = S.jreit.reits, lo = Math.min(...rs.map((r) => r.ret1y), -1), hi = Math.max(...rs.map((r) => r.ret1y), 1);
      return `<span>${fmtPct(lo, 0)}</span><div class="bar" style="background:linear-gradient(90deg, ${T.shu}, ${MID} ${(100 * -lo / (hi - lo)).toFixed(0)}%, ${T.ai})"></div><span>${fmtPct(hi, 0)}</span><span>price change, past year</span>`;
    },
    option() {
      const rs = S.jreit.reits, maxA = Math.max(...rs.map((r) => r.adv));
      const lo = Math.min(...rs.map((r) => r.ret1y), -1), hi = Math.max(...rs.map((r) => r.ret1y), 1);
      const color = (v) => (v >= 0 ? mix(MID, T.ai, Math.pow(v / hi, 0.7)) : mix(MID, T.shu, Math.pow(v / lo, 0.7)));
      return {
        grid: { left: 4, right: 24, top: 24, bottom: 26, containLabel: true },
        tooltip: { ...TIP, trigger: "item", formatter: (p) => { const r = rs[p.dataIndex];
          return `<div class="tt-title">${esc(r.name)} · ${esc(r.sector)}</div>${row(null, r.yield.toFixed(2) + "%", "distribution yield")}${row(null, fmtPct(r.ret1y), "price, 1 year")}${row(null, "¥" + (r.adv / 1e8).toFixed(1) + "bn", "traded per day")}`; } },
        xAxis: { type: "value", scale: true, name: "Distribution yield", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: T.muted, fontSize: 11, fontFamily: FONT },
          axisLabel: axisLabel((v) => v + "%"), splitLine: { lineStyle: { color: T.grid } }, axisLine: { show: false }, axisTick: { show: false } },
        yAxis: { type: "category", data: this.SECTORS, axisLine: { show: false }, axisTick: { show: false },
          splitLine: { show: true, lineStyle: { color: T.grid } }, axisLabel: { color: T.ink2, fontSize: 12, fontWeight: 600, fontFamily: FONT } },
        series: [{
          type: "scatter",
          data: rs.map((r) => ({
            value: [r.yield, r.sector, r.name],
            symbolSize: 10 + 30 * Math.sqrt(r.adv / maxA),
            itemStyle: { color: color(r.ret1y), borderColor: T.ink2, borderWidth: 0.6 },
          })),
          emphasis: { focus: "none", scale: 1.12 },
          markLine: D.jgbLast ? { silent: true, symbol: "none", lineStyle: { color: T.ai, width: 1.5, type: "solid" },
            label: { formatter: `10Y JGB ${D.jgbLast.toFixed(2)}%`, position: "end", color: T.aiDeep, fontSize: 10.5, fontWeight: 600, fontFamily: FONT },
            data: [{ xAxis: D.jgbLast }] } : undefined,
        }],
      };
    },
    table: () => [["REIT", "Sector", "Yield %", "1y price", "Traded/day ¥bn"],
      [...S.jreit.reits].sort((a, b) => b.yield - a.yield).map((r) => [r.name, r.sector, r.yield.toFixed(2), fmtPct(r.ret1y), (r.adv / 1e8).toFixed(1)])],
  },
};

/* ---------------- map ---------------- */
const LAYERS = {
  growth: { tab: "vs 2019", kind: "div", min: [(p) => p.nights_latest >= 5e5, "0.5M+ nights/yr"], get: (p) => p.growth_pct, fmt: (v) => fmtPct(v, 0), legend: () => `Foreign guest nights, ${D.ty} vs ${D.by}` },
  month: { tab: "Latest month", kind: "div", min: [(p) => (p.live_nights ?? 0) >= 3e4, "30k+ nights/mo"], get: (p) => p.live_yoy, fmt: (v) => fmtPct(v, 0), legend: () => `Foreign guest nights, ${D.jtaLabel} vs a year earlier`, needs: () => D.jtaLabel },
  occ: { tab: "Occupancy", kind: "seq", ramp: ["#e8f4ed", "#1f6b47"], get: (p) => p.live_occ, fmt: (v) => v.toFixed(0) + "%", legend: () => `Hotel room occupancy, ${D.jtaLabel}`, needs: () => D.jtaLabel },
  nights: { tab: "Foreign nights", kind: "seq", ramp: ["#e8eff9", "#1d3f78"], sqrt: true, get: (p) => p.nights_latest, fmt: (v) => fmtM(v), legend: () => `Foreign guest nights, ${D.ty}` },
  longhaul: { tab: "Long-haul share", kind: "seq", ramp: ["#fde9df", "#b8401a"], get: (p) => p.long_haul_share, fmt: (v) => v.toFixed(0) + "%", legend: () => `Share of foreign nights from the US, Canada, Europe & Australia, ${D.ty}` },
};
const JUMPS = [
  ["All Japan", null, 1], ["Hokkaido", [142.9, 43.3], 3.4], ["Tohoku", [140.6, 39.4], 3.4], ["Tokyo", [139.55, 35.7], 7],
  ["Kansai", [135.6, 34.8], 5.5], ["Kyushu", [130.8, 32.6], 4.2], ["Okinawa", [127.9, 26.4], 7],
];
let mapLayer = "growth";

function mapTip(name) {
  const p = D.byName?.[name];
  if (!p) return esc(name ?? "");
  return `<div class="tt-title">${esc(p.name)} · ${esc(p.region)}</div>` +
    row(null, fmtM(p.nights_latest, 2), `foreign nights, ${D.ty}`) +
    (p.growth_pct != null ? row(null, fmtPct(p.growth_pct, 0), `vs ${D.by}`) : "") +
    (p.live_yoy != null ? row(null, fmtPct(p.live_yoy, 0), `${D.jtaLabel} y/y`) : "") +
    (p.live_occ != null ? row(null, p.live_occ.toFixed(0) + "%", `room occupancy, ${D.jtaLabel}`) : "") +
    (p.long_haul_share != null ? row(null, p.long_haul_share.toFixed(0) + "%", "long-haul guests") : "") +
    (p.rank ? row(null, `#${p.rank}`, `destination screen, of ${D.screened.length}`) : "");
}
function layerColors() {
  const L = LAYERS[mapLayer];
  const vals = D.prefs.map(L.get).filter((v) => v != null);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const tf = L.sqrt ? Math.sqrt : (x) => x;
  const color = (v) => {
    if (v == null) return T.grid;
    if (L.kind === "div") return v >= 0 ? mix(MID, T.ai, Math.pow(v / Math.max(hi, 1), 0.6)) : mix(MID, T.shu, Math.pow(v / Math.min(lo, -1), 0.6));
    return mix(L.ramp[0], L.ramp[1], (tf(v) - tf(lo)) / (tf(hi) - tf(lo) || 1));
  };
  return { L, lo, hi, color };
}
CHARTS.map = {
  title: "Foreign hotel demand by prefecture",
  ready: () => S.geo && D.prefs,
  chip: () => [LAYERS[mapLayer].tab, ""],
  foot: () => `Japan Tourism Agency · annual ${D.ty} & ${D.by}${D.jtaLabel ? ` · monthly release ${D.jtaLabel}` : ""} · scroll or pinch to zoom, drag to pan, click a prefecture to fly in`,
  bar() {
    const tabs = Object.entries(LAYERS).filter(([, L]) => !L.needs || L.needs())
      .map(([k, L]) => `<button data-layer="${k}" aria-pressed="${k === mapLayer}">${esc(L.tab)}</button>`).join("");
    const jumps = JUMPS.map(([n], i) => `<button data-jump="${i}">${esc(n)}</button>`).join("");
    return `<div class="seg" role="group" aria-label="Map layer">${tabs}</div><div class="jumps">${jumps}</div>`;
  },
  option() {
    if (!echarts.getMap("japan")) echarts.registerMap("japan", S.geo);
    const { L, color } = layerColors();
    return {
      tooltip: { ...TIP, trigger: "item", formatter: (p) => mapTip(p.name) },
      series: [{
        type: "map", map: "japan", roam: true, scaleLimit: { min: 1, max: 16 },
        layoutCenter: ["50%", "50%"], layoutSize: "98%",
        label: { show: false, formatter: "{b}", fontSize: 10, color: T.ink, fontFamily: FONT, textBorderColor: "rgba(255,253,249,.85)", textBorderWidth: 2 },
        itemStyle: { borderColor: T.surface, borderWidth: 0.8, areaColor: T.grid },
        emphasis: { label: { show: true, fontWeight: 700, fontSize: 11 }, itemStyle: { borderColor: T.ink, borderWidth: 1.4 } },
        select: { disabled: true },
        data: D.prefs.map((p) => { const c = color(L.get(p));
          return { name: p.name, value: L.get(p), itemStyle: { areaColor: c }, emphasis: { itemStyle: { areaColor: c } } }; }),
      }],
    };
  },
  after(chart, card) {
    const legendEl = card.querySelector(".map-legend");
    const paintLegend = () => {
      const { L, lo, hi } = layerColors();
      const grad = L.kind === "div" ? `linear-gradient(90deg, ${T.shu}, ${MID} 50%, ${T.ai})` : `linear-gradient(90deg, ${L.ramp[0]}, ${L.ramp[1]})`;
      legendEl.innerHTML = `<span>${esc(L.fmt(lo))}</span><div class="bar" style="background:${grad}"></div><span>${esc(L.fmt(hi))}</span><span>${esc(L.legend())}</span>`;
      card.querySelector(".chip").textContent = L.tab;
    };
    paintLegend();
    const topEl = card.querySelector(".map-top");
    const paintTop = () => {
      const { L, color } = layerColors();
      const ranked = D.prefs.filter((p) => L.get(p) != null && (!L.min || L.min[0](p))).sort((a, b) => L.get(b) - L.get(a)).slice(0, 10);
      const max = Math.max(...ranked.map((p) => Math.abs(L.get(p))));
      topEl.innerHTML = `<p class="mt-h">Top 10 · ${esc(L.tab)}${L.min ? `<span class="mt-sub">${esc(L.min[1])}</span>` : ""}</p>` + ranked.map((p, i) =>
        `<button class="mt-row" data-pref="${esc(p.name)}"><span class="mt-i">${i + 1}</span><span class="mt-n">${esc(p.name)}</span>` +
        `<span class="mt-bar"><span style="width:${(100 * Math.abs(L.get(p)) / max).toFixed(0)}%;background:${color(L.get(p))}"></span></span><b>${esc(L.fmt(L.get(p)))}</b></button>`).join("");
    };
    paintTop();
    topEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pref]"); if (!b) return;
      const pref = D.byName[b.dataset.pref]; flyTo([pref.lon, pref.lat], 5.5);
      chart.dispatchAction({ type: "showTip", seriesIndex: 0, name: pref.name });
    });
    const showLabels = (z) => chart.setOption({ series: [{ label: { show: z >= 2.2 } }] });
    chart.on("georoam", () => showLabels(chart.getOption().series[0].zoom || 1));
    const flyTo = (center, zoom) => {
      if (!center) { chart.setOption(this.option(), true); return; }
      chart.setOption({ series: [{ center, zoom, label: { show: zoom >= 2.2 } }] });
    };
    chart.on("click", (p) => { const pref = D.byName[p.name]; if (pref) flyTo([pref.lon, pref.lat], Math.max(chart.getOption().series[0].zoom || 1, 5)); });
    card.querySelector(".seg").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-layer]"); if (!b) return;
      mapLayer = b.dataset.layer;
      card.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      const { L, color } = layerColors();
      chart.setOption({ series: [{ data: D.prefs.map((p) => { const c = color(L.get(p)); return { name: p.name, value: L.get(p), itemStyle: { areaColor: c }, emphasis: { itemStyle: { areaColor: c } } }; }) }] });
      paintLegend();
      paintTop();
    });
    card.querySelector(".jumps").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-jump]"); if (!b) return;
      const [, c, z] = JUMPS[+b.dataset.jump]; flyTo(c, z);
    });
    card.querySelector(".zoom-ctl").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.z === "reset") return flyTo(null);
      const z = Math.min(16, Math.max(1, (chart.getOption().series[0].zoom || 1) * (b.dataset.z === "in" ? 1.6 : 1 / 1.6)));
      chart.setOption({ series: [{ zoom: z, label: { show: z >= 2.2 } }] });
    });
  },
};

/* ---------------- cards ---------------- */
function tableHTML([head, rows]) {
  return `<table class="dv"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>` +
    rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c ?? "–")}</td>`).join("")}</tr>`).join("") + "</tbody></table>";
}
function scaffold(card) {
  const def = CHARTS[card.dataset.chart];
  card.innerHTML = `
    <header class="viz-head"><h3></h3><span class="chip" hidden></span>
      <div class="viz-tools">${def.table ? `<button class="icon-btn tbl-btn" aria-pressed="false" title="Show the numbers">Data</button>` : ""}</div></header>
    ${def.bar ? `<div class="map-bar"></div>` : ""}
    <div class="chart" style="height:${card.dataset.h}px"><div class="sk-fill"></div></div>
    ${card.dataset.chart === "map" ? `<div class="zoom-ctl"><button data-z="in" aria-label="Zoom in">+</button><button data-z="out" aria-label="Zoom out">−</button><button data-z="reset" aria-label="Reset view">⟲</button></div><div class="map-top"></div>` : ""}
    ${card.dataset.chart === "map" || def.legendBar ? `<div class="map-legend"></div>` : ""}
    <div class="tbl" hidden></div>
    <p class="viz-foot"></p>`;
  card.querySelector("h3").textContent = def.title;
}
function build(card) {
  const k = card.dataset.chart, def = CHARTS[k];
  const chartEl = card.querySelector(".chart");
  if (!def.ready()) { chartEl.innerHTML = `<div class="chart-error">Source unavailable right now — reload to retry.</div>`; return; }
  try {
    const [txt, cls] = def.chip();
    const chip = card.querySelector(".chip");
    chip.textContent = txt; chip.className = `chip ${cls || ""}`; chip.hidden = false;
    card.querySelector(".viz-foot").textContent = def.foot();
    if (def.bar) card.querySelector(".map-bar").innerHTML = def.bar();
    chartEl.innerHTML = "";
    const c = echarts.init(chartEl, null, { renderer: "canvas" });
    c.setOption(def.option());
    charts[k] = c;
    if (def.legendBar) card.querySelector(".map-legend").innerHTML = def.legendBar();
    if (def.after) def.after(c, card);
    const btn = card.querySelector(".tbl-btn");
    if (btn) btn.addEventListener("click", () => {
      const tbl = card.querySelector(".tbl"), on = btn.getAttribute("aria-pressed") !== "true";
      btn.setAttribute("aria-pressed", String(on));
      if (on && !tbl.innerHTML) tbl.innerHTML = tableHTML(def.table());
      tbl.hidden = !on; chartEl.hidden = on;
      if (!on) c.resize();
    });
  } catch (e) {
    console.error(k, e);
    chartEl.innerHTML = `<div class="chart-error">Couldn't draw this chart.</div>`;
  }
}

function renderRankCards() {
  if (!D.screened) return;
  const top = D.screened.slice(0, 3);
  const max = (k) => Math.max(...D.screened.map((p) => p[k] ?? 0));
  const bar = (label, v, m, txt) => `<div class="rc-bar"><span>${label}</span><div class="rc-track"><div class="rc-fill" style="width:${Math.max(3, (100 * Math.max(v, 0)) / m).toFixed(0)}%"></div></div><b>${txt}</b></div>`;
  $("#rankCards").innerHTML = top.map((p) => `
    <div class="card rank-card">
      <div class="rc-top"><span class="rc-rank">${p.rank}</span><span class="rc-name">${esc(p.name)}</span><span class="rc-region">${esc(p.region)}</span></div>
      ${bar(`vs ${D.by}`, p.growth_pct, max("growth_pct"), fmtPct(p.growth_pct, 0))}
      ${bar("Long-haul", p.long_haul_share, max("long_haul_share"), p.long_haul_share.toFixed(0) + "%")}
      ${bar("Ski-season occ.", p.ski_occupancy, max("ski_occupancy"), p.ski_occupancy.toFixed(0) + "%")}
      ${bar(`Nights ${D.ty}`, p.nights_latest, max("nights_latest"), fmtM(p.nights_latest))}
    </div>`).join("");
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 864e5 + 1) / 7);
}

/* ---------------- boot ---------------- */
(async function main() {
  const now = new Date();
  $("#heroDate").textContent = `Week ${isoWeek(now)} · ${now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}`;
  const cards = [...document.querySelectorAll(".viz")];
  cards.forEach(scaffold);
  await loadAll();
  prepare();
  try { renderTiles(); } catch (e) { console.error(e); }
  try { renderRankCards(); } catch (e) { console.error(e); }
  cards.forEach(build);
  $("#stamp").textContent = "Live · " + now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  window.addEventListener("resize", () => Object.values(charts).forEach((c) => c.resize()));
})();
