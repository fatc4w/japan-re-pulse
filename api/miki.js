// Live office-market snapshot from Miki Shoji (三鬼商事) for Japan's 7 major
// business districts: 13 months of average vacancy and average rent per city,
// plus the five central Tokyo wards.
import { getText, cache } from "../lib/common.js";
import { parseMikiTables, citySeries } from "../lib/miki.js";

const CITIES = [
  ["tokyo", "東京", "Tokyo"],
  ["osaka", "大阪", "Osaka"],
  ["nagoya", "名古屋", "Nagoya"],
  ["yokohama", "横浜", "Yokohama"],
  ["fukuoka", "福岡", "Fukuoka"],
  ["sapporo", "札幌", "Sapporo"],
  ["sendai", "仙台", "Sendai"],
];
const WARDS = { 千代田区: "Chiyoda", 中央区: "Chuo", 港区: "Minato", 新宿区: "Shinjuku", 渋谷区: "Shibuya" };

export default async function handler(req, res) {
  const pages = await Promise.allSettled(
    CITIES.map(([slug]) => getText(`https://www.e-miki.com/rent/${slug}.html`))
  );

  const cities = [];
  let wards = [];
  pages.forEach((p, i) => {
    if (p.status !== "fulfilled") return;
    const [, jp, en] = CITIES[i];
    const tables = parseMikiTables(p.value);
    const s = citySeries(tables, jp);
    if (s && s.vacancy && s.rent) cities.push({ city: en, ...s });
    if (en === "Tokyo") {
      const wv = tables["東京の地区別平均空室率"];
      const wr = tables["東京の地区別平均賃料"];
      if (wv && wr) {
        wards = Object.entries(WARDS)
          .filter(([jpw]) => wv.rows[jpw] && wr.rows[jpw])
          .map(([jpw, enw]) => ({ ward: enw, months: wv.months, vacancy: wv.rows[jpw], rent: wr.rows[jpw] }));
      }
    }
  });

  if (!cities.length) return res.status(502).json({ error: "no city pages parsed" });
  cache(res, 43200, 604800);
  return res.status(200).json({
    source: "Miki Shoji Co., Ltd. office market data",
    source_url: "https://www.e-miki.com/rent/tokyo.html",
    as_of: cities[0].months[cities[0].months.length - 1],
    cities,
    tokyo_wards: wards,
  });
}
