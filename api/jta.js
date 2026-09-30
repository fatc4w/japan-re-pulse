// Live hotel data from the Japan Tourism Agency's monthly Overnight Travel
// Statistics (second preliminary release): foreign guest nights and room
// occupancy for every prefecture in the latest published month.
import * as XLSX from "xlsx";
import { getText, getBuffer, cache, links, absUrl, num, prefFromLabel } from "../lib/common.js";

const PAGE = "https://www.mlit.go.jp/kankocho/tokei_hakusyo/shukuhakutokei.html";

function sheetRows(wb, name) {
  const ws = wb.Sheets[name];
  return ws ? XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) : null;
}

export default async function handler(req, res) {
  const html = await getText(PAGE);
  const pick = links(html, "xlsx").find((l) => /第2次速報値/.test(l.text) && /集計結果/.test(l.text));
  if (!pick) return res.status(502).json({ error: "monthly release not found" });
  const ym = pick.text.match(/(\d{4})年.*?(\d{1,2})月分/);
  const year = +ym[1], month = +ym[2];
  const url = absUrl(PAGE, pick.href);
  const wb = XLSX.read(await getBuffer(url), { type: "buffer" });

  // 第2表: guest nights; the foreign column is headed "うち外国人延べ宿泊者数"
  const t2 = sheetRows(wb, `第2表(${month}月)`);
  // 第8表: room occupancy; column 1 is the all-facility rate
  const t8 = sheetRows(wb, `第8表(${month}月)`);
  if (!t2 || !t8) return res.status(502).json({ error: "tables not found" });

  let fcol = -1;
  for (let r = 0; r < 8 && fcol < 0; r++) {
    fcol = (t2[r] || []).findIndex((c) => typeof c === "string" && c.replace(/\s/g, "").startsWith("うち外国人延べ宿泊者数"));
  }
  if (fcol < 0) return res.status(502).json({ error: "foreign column not found" });

  const prefectures = {};
  let national = null;
  for (const r of t2) {
    if (!r) continue;
    const en = prefFromLabel(r[0]);
    if (en) prefectures[en] = { foreign_nights: num(r[fcol]), total_nights: num(r[1]) };
    else if (typeof r[0] === "string" && /^令和/.test(r[0]) && national == null) {
      national = { foreign_nights: num(r[fcol]), total_nights: num(r[1]) };
    }
  }
  let natOcc = null;
  for (const r of t8) {
    if (!r) continue;
    const en = prefFromLabel(r[0]);
    if (en && prefectures[en]) prefectures[en].occupancy = num(r[1]);
    else if (typeof r[0] === "string" && /^令和/.test(r[0]) && natOcc == null) natOcc = num(r[1]);
  }
  if (national) national.occupancy = natOcc;

  cache(res, 43200, 604800);
  return res.status(200).json({
    source: "Japan Tourism Agency, Overnight Travel Statistics (monthly, 2nd preliminary)",
    source_url: url,
    year, month, national, prefectures,
  });
}
