// Parser for Miki Shoji office-market pages (e-miki.com/rent/<city>.html).
// Each page has <h2>…の平均空室率</h2> / <h2>…の平均賃料</h2> sections followed by a
// 13-month table whose header cells look like "2025.08", "09", …, "2026.01", ….

const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

export function parseMikiTables(html) {
  const tables = {};
  const re = /<h2[^>]*>([\s\S]*?)<\/h2>[\s\S]*?<table>([\s\S]*?)<\/table>/g;
  let m;
  while ((m = re.exec(html))) {
    const title = strip(m[1]);
    const body = m[2];
    const ths = [...body.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((x) => strip(x[1]));
    // resolve "2025.08", "09", … into ISO months
    let year = null;
    const months = [];
    for (const h of ths) {
      const full = h.match(/^(\d{4})\.(\d{2})$/);
      const part = h.match(/^(\d{2})$/);
      if (full) { year = +full[1]; months.push(`${full[1]}-${full[2]}`); }
      else if (part && year) {
        if (months.length && +part[1] < +months[months.length - 1].slice(5)) year++;
        months.push(`${year}-${part[1]}`);
      }
    }
    const rows = {};
    for (const tr of body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => strip(x[1]));
      if (tds.length < 2) continue;
      const vals = tds.slice(1, 1 + months.length).map((v) => {
        const n = parseFloat(v.replace(/,/g, ""));
        return Number.isFinite(n) ? n : null;
      });
      rows[tds[0]] = vals;
    }
    if (months.length) tables[title] = { months, rows };
  }
  return tables;
}

// Pull the headline vacancy + rent series for a city from parsed tables.
export function citySeries(tables, cityJp) {
  const vac = tables[`${cityJp}の平均空室率`];
  const rent = tables[`${cityJp}の平均賃料`];
  if (!vac || !rent) return null;
  return {
    months: vac.months,
    vacancy: vac.rows["平均空室率"] ?? null,
    rent: rent.rows["平均賃料"] ?? null,
  };
}
