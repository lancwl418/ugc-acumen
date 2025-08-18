// app/lib/fetchInstagram.js
import fs from "fs/promises";
import fetch from "node-fetch";

/**
 * 环境变量：
 * - PAGE_TOKEN           长效 Page Access Token（你已经配在 Render）
 * - INSTAGRAM_IG_ID      IG 业务账号 ID（1784...）
 * - HASHTAG              可选：默认 "acumencamera"
 */
const PAGE_TOKEN = process.env.PAGE_TOKEN;
const IG_ID = process.env.INSTAGRAM_IG_ID;
const DEFAULT_TAG = process.env.HASHTAG || "acumencamera";

// ---- 你现有的函数（保留） ----
const igUserToken = process.env.INSTAGRAM_ACCESS_TOKEN;
const igUserId = process.env.INSTAGRAM_IG_ID;
const userMediaUrl = `https://graph.facebook.com/v23.0/${igUserId}/media?fields=id,media_url,caption,permalink,timestamp,media_type&access_token=${igUserToken}`;

export async function fetchInstagramUGC() {
  try {
    const res = await fetch(userMediaUrl);
    const json = await res.json();

    if (!json.data) {
      console.warn("⚠️ Instagram 返回无数据:", json);
      return;
    }

    const items = json.data.map((item) => ({
      id: item.id,
      media_url: item.media_url,
      caption: item.caption || "",
      permalink: item.permalink,
      timestamp: item.timestamp,
      media_type: item.media_type,
      username: item.username
    }));

    await fs.writeFile("public/ugc.json", JSON.stringify(items, null, 2), "utf-8");
    console.log(`✅ 已抓取 ${items.length} 条 Instagram UGC`);
  } catch (err) {
    console.error("❌ 抓取 Instagram 内容出错:", err);
  }
}

// ---- 新增：抓取指定 hashtag 的 UGC（top_media + 可选 recent_media） ----

/**
 * 通过标签名获取 hashtag_id
 */
async function getHashtagId(tag, igId, pageToken) {
  const url = new URL("https://graph.facebook.com/v23.0/ig_hashtag_search");
  url.searchParams.set("user_id", igId);
  url.searchParams.set("q", tag);
  url.searchParams.set("access_token", pageToken);

  const res = await fetch(url);
  const json = await res.json();
  if (!json.data?.length) return null;
  return json.data[0].id;
}

/**
 * 拉取某个 endpoint（top_media / recent_media），带简单分页
 */
async function fetchHashtagEdge(hashtagId, igId, pageToken, edge = "top_media", limit = 50) {
  const base = `https://graph.facebook.com/v23.0/${hashtagId}/${edge}`;
  const fields = "id,caption,media_type,media_url,permalink,timestamp";
  let collected = [];
  let nextUrl = `${base}?user_id=${igId}&fields=${encodeURIComponent(fields)}&access_token=${pageToken}`;

  while (nextUrl && collected.length < limit) {
    const res = await fetch(nextUrl);
    const json = await res.json();
    if (!json.data) {
      console.warn(`⚠️ ${edge} 接口无数据:`, json);
      break;
    }
    collected = collected.concat(json.data);
    // 分页
    nextUrl = json.paging?.next || null;
  }

  return collected.slice(0, limit);
}

/**
 * 抓取 hashtag UGC
 * @param {object} options
 * @param {string} options.tag - 话题名（不带 #），默认取 env HASHTAG 或 "acumencamera"
 * @param {"top"|"recent"|"both"} options.strategy - 抓热门/最新/二者合并
 * @param {number} options.limit - 最大条数
 * @param {string} options.outfile - 输出文件
 */
export async function fetchHashtagUGC({
  tag = DEFAULT_TAG,
  strategy = "top",
  limit = 50,
  outfile = "public/hashtag_ugc.json",
} = {}) {
  try {
    if (!PAGE_TOKEN || !IG_ID) {
      throw new Error("缺少 PAGE_TOKEN 或 INSTAGRAM_IG_ID 环境变量");
    }

    const hashtagId = await getHashtagId(tag, IG_ID, PAGE_TOKEN);
    if (!hashtagId) {
      console.warn(`⚠️ 未找到 hashtag: ${tag}`);
      return;
    }

    let items = [];
    if (strategy === "top" || strategy === "both") {
      const top = await fetchHashtagEdge(hashtagId, IG_ID, PAGE_TOKEN, "top_media", limit);
      items = items.concat(top);
    }
    if (strategy === "recent" || strategy === "both") {
      const recent = await fetchHashtagEdge(hashtagId, IG_ID, PAGE_TOKEN, "recent_media", limit);
      items = items.concat(recent);
    }

    // 去重（按 id）
    const map = new Map();
    for (const m of items) map.set(m.id, m);
    const deduped = Array.from(map.values())
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);

    const normalized = deduped.map((item) => ({
      id: item.id,
      media_url: item.media_url,
      caption: item.caption || "",
      permalink: item.permalink,
      timestamp: item.timestamp,
      media_type: item.media_type,
      hashtag: tag,
      username: item.username
    }));

    await fs.writeFile(outfile, JSON.stringify(normalized, null, 2), "utf-8");
    console.log(`✅ 已抓取 #${tag} 共 ${normalized.length} 条（strategy=${strategy}）`);
  } catch (err) {
    console.error("❌ 抓取 Hashtag UGC 出错:", err);
  }
}
