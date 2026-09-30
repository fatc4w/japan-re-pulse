// Shared helpers for the /api scrapers.
export const UA = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
};

// Yahoo rate-limits full browser UAs that arrive without cookies; a bare one passes.
const PLAIN_UA = { "User-Agent": "Mozilla/5.0" };

async function get(url, ms, headers = UA) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal });
    if (!r.ok) throw new Error(`${url} → ${r.status}`);
    return r;
  } finally {
    clearTimeout(t);
  }
}
export const getText = async (url, ms = 20000) => (await get(url, ms)).text();
export const getJSON = async (url, ms = 20000) => (await get(url, ms, PLAIN_UA)).json();

// Run async fn over items with at most `limit` in flight.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try { out[i] = { status: "fulfilled", value: await fn(items[i]) }; }
      catch (e) { out[i] = { status: "rejected", reason: e }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
export const getBuffer = async (url, ms = 45000) => Buffer.from(await (await get(url, ms)).arrayBuffer());

export function cache(res, sMaxAge, swr) {
  res.setHeader("Cache-Control", `s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`);
}

export function absUrl(base, href) {
  return new URL(href, base).toString();
}

// Every <a href="...ext">text</a> on a page, with tags stripped from the text.
export function links(html, ext) {
  const out = [];
  const re = new RegExp(`<a[^>]+href="([^"]+\\.${ext})"[^>]*>([\\s\\S]*?)</a>`, "g");
  let m;
  while ((m = re.exec(html))) out.push({ href: m[1], text: m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() });
  return out;
}

export const num = (v) => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/[,\s]/g, "").replace(/^\*/, ""));
  return Number.isFinite(n) ? n : null;
};

// Japanese prefecture name → English, in JIS order.
export const PREF_JP = {
  北海道: "Hokkaido", 青森県: "Aomori", 岩手県: "Iwate", 宮城県: "Miyagi", 秋田県: "Akita",
  山形県: "Yamagata", 福島県: "Fukushima", 茨城県: "Ibaraki", 栃木県: "Tochigi", 群馬県: "Gunma",
  埼玉県: "Saitama", 千葉県: "Chiba", 東京都: "Tokyo", 神奈川県: "Kanagawa", 新潟県: "Niigata",
  富山県: "Toyama", 石川県: "Ishikawa", 福井県: "Fukui", 山梨県: "Yamanashi", 長野県: "Nagano",
  岐阜県: "Gifu", 静岡県: "Shizuoka", 愛知県: "Aichi", 三重県: "Mie", 滋賀県: "Shiga",
  京都府: "Kyoto", 大阪府: "Osaka", 兵庫県: "Hyogo", 奈良県: "Nara", 和歌山県: "Wakayama",
  鳥取県: "Tottori", 島根県: "Shimane", 岡山県: "Okayama", 広島県: "Hiroshima", 山口県: "Yamaguchi",
  徳島県: "Tokushima", 香川県: "Kagawa", 愛媛県: "Ehime", 高知県: "Kochi", 福岡県: "Fukuoka",
  佐賀県: "Saga", 長崎県: "Nagasaki", 熊本県: "Kumamoto", 大分県: "Oita", 宮崎県: "Miyazaki",
  鹿児島県: "Kagoshima", 沖縄県: "Okinawa",
};
// JTA row labels look like "　01北海道"
export function prefFromLabel(label) {
  const jp = String(label ?? "").replace(/[\s　]/g, "").replace(/^\d+/, "");
  return PREF_JP[jp] ?? null;
}
