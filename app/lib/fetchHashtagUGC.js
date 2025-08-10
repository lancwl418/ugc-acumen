// app/lib/fetchHashtagUGC.js
import fs from "fs/promises";
import fetch from "node-fetch";

/**
 * 环境变量（Render 上配置）：
 * - PAGE_TOKEN        长效 Page Access Token
 * - INSTAGRAM_IG_ID   IG 业务账号 ID（1784...）
 * - HASHTAG           可选，默认 "acumencamera"
 */
const PAGE_TOKEN = process.env.PAGE_TOKEN;
const IG_ID = process.env.INSTAGRAM_IG_ID;
const DEFAULT_TAG = process.env.HASHTAG || "acumencamera";

/* ========== 小工具 ========== */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function safeFetch(url, opts = {}, tryCount = 0) {
  const res = await fetch(url, opts);
  if (res.status === 429) {
    // 简单退避：最多重试 3 次
    if (tryCount >= 3) throw new Error("Rate limited (429) repeatedly");
    const retryAfter = Number(res.headers.get("Retry-After")) || 1;
    await sleep((retryAfter + tryCount) * 1000);
    return safeFetch(url, opts, tryCount + 1);
  }
  return res;
}

/* ========== 1) 话题名 -> hashtag_id ========== */
async function getHashtagId(tag, igId, pageToken) {
  const url = new URL("https://graph.facebook.com/v23.0/ig_hashtag_search");
  url.searchParams.set("user_id", igId);
  url.searchParams.set("q", tag);
  url.searchParams.set("access_token", pageToken);

  const res = await safeFetch(url.toString());
  const json = await res.json();
  if (!json.data?.length) return null;
  return json.data[0].id;
}

/* ========== 2) 抓取某个 edge（top_media / recent_media），自动分页 ========== */
async function fetchHashtagEdge({
  hashtagId,
  igId,
  pageToken,
  edge = "top_media",
  limit = 50,
}) {
  const base = `https://graph.facebook.com/v23.0/${hashtagId}/${edge}`;
  const fields = "id,caption,media_type,media_url,permalink,timestamp";
  let collected = [];
  let nextUrl = `${base}?user_id=${igId}&fields=${encodeURIComponent(fields)}&access_token=${pageToken}`;

  while (nextUrl && collected.length < limit) {
    const res = await safeFetch(nextUrl);
    const json = await res.json();

    if (!json.data) {
      console.warn(`⚠️ ${edge} 接口无数据:`, json);
      break;
    }
    collected.push(...json.data);
    nextUrl = json.paging?.next || null;
  }

  return collected.slice(0, limit);
}

/* ========== 3) 入口函数 ========== */
/**
 * 抓取 hashtag UGC
 * @param {object} options
 * @param {string} options.tag           话题名（不带 #），默认 env.HASHTAG 或 "acumencamera"
 * @param {"top"|"recent"|"both"} options.strategy  抓热门/最新/二者合并
 * @param {number} options.limit         最大条数（合并后也会截断到该值）
 * @param {string} options.outfile       输出文件路径
 */
export async function fetchHashtagUGC({
  tag = DEFAULT_TAG,
  strategy = "top",
  limit = 50,
  outfile = "public/hashtag_ugc.json",
} = {}) {
  try {
    if (!PAGE_TOKEN || !IG_ID) {
      throw new Error("缺少环境变量：PAGE_TOKEN 或 INSTAGRAM_IG_ID");
    }

    const hashtagId = await getHashtagId(tag, IG_ID, PAGE_TOKEN);
    if (!hashtagId) {
      console.warn(`⚠️ 未找到 hashtag: ${tag}`);
      return;
    }

    let items = [];
    if (strategy === "top" || strategy === "both") {
      const top = await fetchHashtagEdge({
        hashtagId,
        igId: IG_ID,
        pageToken: PAGE_TOKEN,
        edge: "top_media",
        limit,
      });
      items.push(...top);
    }
    if (strategy === "recent" || strategy === "both") {
      const recent = await fetchHashtagEdge({
        hashtagId,
        igId: IG_ID,
        pageToken: PAGE_TOKEN,
        edge: "recent_media",
        limit,
      });
      items.push(...recent);
    }

    // 按 id 去重，并按时间倒序
    const dedupMap = new Map();
    for (const m of items) dedupMap.set(m.id, m);
    const normalized = Array.from(dedupMap.values())
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit)
      .map((item) => ({
        id: item.id,
        media_url: item.media_url,
        caption: item.caption || "",
        permalink: item.permalink,
        timestamp: item.timestamp,
        media_type: item.media_type,
        hashtag: tag,
      }));

    await fs.writeFile(outfile, JSON.stringify(normalized, null, 2), "utf-8");
    console.log(`✅ 已抓取 #${tag} 共 ${normalized.length} 条（strategy=${strategy}）`);
  } catch (err) {
    console.error("❌ fetchHashtagUGC 出错：", err);
  }
}

/* ========== 4) 允许 CLI 直接运行（可选）==========
   例：node app/lib/fetchHashtagUGC.js acumencamera both 80 public/hashtag_ugc.json
*/
if (import.meta.url === `file://${process.argv[1]}`) {
  const [tag = DEFAULT_TAG, strategy = "top", limitArg = "50", outfile = "public/hashtag_ugc.json"] =
    process.argv.slice(2);
  const limit = Number(limitArg) || 50;

  fetchHashtagUGC({ tag, strategy, limit, outfile }).catch((e) =>
    console.error("❌ CLI 运行失败：", e)
  );
}
