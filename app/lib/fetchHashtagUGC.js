// app/lib/fetchInstagram.js
import fs from "fs/promises";
import fetch from "node-fetch";

/**
 * 环境变量：
 * - PAGE_TOKEN           长效 Page Access Token
 * - INSTAGRAM_IG_ID      IG 业务账号 ID（1784...）
 * - HASHTAG(S)           可选：默认 "acumencamera"；也可配成 "tag1,tag2,tag3"
 */
const PAGE_TOKEN = process.env.PAGE_TOKEN;
const IG_ID = process.env.INSTAGRAM_IG_ID;
const DEFAULT_TAGS = (process.env.HASHTAGS || process.env.HASHTAG || "acumencamera");

/* ==================== 你现有的用户媒体抓取（保留） ==================== */
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
      username: item.username || "", // hashtag edge 通常不给，这里保留字段
    }));

    await fs.writeFile("public/ugc.json", JSON.stringify(items, null, 2), "utf-8");
    console.log(`✅ 已抓取 ${items.length} 条 Instagram UGC`);
  } catch (err) {
    console.error("❌ 抓取 Instagram 内容出错:", err);
  }
}

/* ==================== Hashtag 抓取增强版（支持多标签） ==================== */

/** 把 "tag1, tag2 ,tag3" 解析成去重后的 tag 数组 */
function parseTags(tagOrCsv) {
  return String(tagOrCsv || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
}

/** 通过标签名获取 hashtag_id */
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

/** 拉取某个 endpoint（top_media / recent_media），带简单分页 */
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
    nextUrl = json.paging?.next || null;
  }

  return collected.slice(0, limit);
}

/**
 * 抓取 hashtag UGC（支持多标签）
 * @param {object} options
 * @param {string|string[]} options.tag   单个标签（"foo"）或逗号分隔（"foo,bar"）或数组(["foo","bar"])
 * @param {"top"|"recent"|"both"} options.strategy  抓热门/最新/二者合并
 * @param {number} options.limit          合并后的总最大条数（所有标签合并后再截断）
 * @param {string} options.outfile        输出文件
 */
export async function fetchHashtagUGC({
  tag = DEFAULT_TAGS,           // 允许 "a,b,c"
  strategy = "top",
  limit = 50,
  outfile = "public/hashtag_ugc.json",
} = {}) {
  try {
    if (!PAGE_TOKEN || !IG_ID) {
      throw new Error("缺少 PAGE_TOKEN 或 INSTAGRAM_IG_ID 环境变量");
    }

    // 解析标签集合
    const tags = Array.isArray(tag) ? tag : parseTags(tag);
    if (!tags.length) {
      console.warn("⚠️ 未提供有效的 hashtag，已跳过");
      return;
    }

    // 每个标签“目标抓取上限”（为了尽量平均分配；只是初始目标，后续会合并去重再整体截断）
    const perTagLimit = Math.max(1, Math.ceil(limit / tags.length));

    // 1) 先并发获取每个 tag 的 hashtag_id
    const idResults = await Promise.all(tags.map(t => getHashtagId(t, IG_ID, PAGE_TOKEN)));
    const tagIdPairs = tags
      .map((t, i) => ({ tag: t, id: idResults[i] }))
      .filter(p => p.id);

    if (!tagIdPairs.length) {
      console.warn("⚠️ 没有任何标签解析出 hashtag_id，已跳过");
      return;
    }

    // 2) 并发抓各标签的 top/recent
    const allItems = [];
    await Promise.all(tagIdPairs.map(async ({ tag: oneTag, id: hashtagId }) => {
      let items = [];
      if (strategy === "top" || strategy === "both") {
        const top = await fetchHashtagEdge(hashtagId, IG_ID, PAGE_TOKEN, "top_media", perTagLimit);
        items = items.concat(top);
      }
      if (strategy === "recent" || strategy === "both") {
        const recent = await fetchHashtagEdge(hashtagId, IG_ID, PAGE_TOKEN, "recent_media", perTagLimit);
        items = items.concat(recent);
      }
      // 标注来源标签
      items.forEach(m => (m.__hashtag = oneTag));
      allItems.push(...items);
    }));

    if (!allItems.length) {
      console.warn("⚠️ 未从任何标签抓到内容");
      await fs.writeFile(outfile, "[]", "utf-8");
      return;
    }

    // 3) 合并去重（按 id），按时间倒序，然后整体截断到 limit
    const dedup = new Map();
    for (const m of allItems) {
      dedup.set(m.id, m);
    }
    const merged = Array.from(dedup.values())
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);

    // 4) 归一化
    const normalized = merged.map((item) => ({
      id: item.id,
      media_url: item.media_url,
      caption: item.caption || "",
      permalink: item.permalink,
      timestamp: item.timestamp,
      media_type: item.media_type,
      hashtag: item.__hashtag || "",   // ✅ 标注命中的标签
      username: item.username || "",   // hashtag edge 通常不给；保留字段占位
    }));

    await fs.writeFile(outfile, JSON.stringify(normalized, null, 2), "utf-8");
    console.log(`✅ 已抓取 ${tags.join(", ")} 共 ${normalized.length} 条（strategy=${strategy}，合并后截断=${limit}）`);
  } catch (err) {
    console.error("❌ 抓取 Hashtag UGC 出错:", err);
  }
}
