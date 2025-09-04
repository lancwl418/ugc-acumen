// app/lib/fetchHashtagUGC.js
import fs from "fs/promises";
import fetch from "node-fetch";

/**
 * 环境变量：
 * - PAGE_TOKEN                长效 Page Access Token（Business/系统令牌，用于 hashtag edges）
 * - INSTAGRAM_IG_ID           IG 业务账号 ID（1784...）
 * - INSTAGRAM_ACCESS_TOKEN    用户令牌（/tags、mentioned_media 用）
 * - HASHTAG(S)                可选：默认 "acumencamera"；也可配成 "tag1,tag2,tag3"
 */
const PAGE_TOKEN = process.env.PAGE_TOKEN;
const IG_ID = process.env.INSTAGRAM_IG_ID;
const USER_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const DEFAULT_TAGS = (process.env.HASHTAGS || process.env.HASHTAG || "acumencamera");

/* ==================== 你现有的用户媒体抓取（保留） ==================== */
const igUserToken = USER_TOKEN;
const igUserId = IG_ID;
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
      username: item.username || "",
    }));
    await fs.writeFile("public/ugc.json", JSON.stringify(items, null, 2), "utf-8");
    console.log(`✅ 已抓取 ${items.length} 条 Instagram UGC`);
  } catch (err) {
    console.error("❌ 抓取 Instagram 内容出错:", err);
  }
}

/* ==================== 工具函数 ==================== */

function parseTags(tagOrCsv) {
  return String(tagOrCsv || "")
    .split(",").map(s => s.trim()).filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
}

const hashtagIdCache = new Map(); // name -> id

async function getHashtagId(tag, igId, pageToken) {
  if (hashtagIdCache.has(tag)) return hashtagIdCache.get(tag);
  const url = new URL("https://graph.facebook.com/v23.0/ig_hashtag_search");
  url.searchParams.set("user_id", igId);
  url.searchParams.set("q", tag);
  url.searchParams.set("access_token", pageToken);
  const res = await fetch(url);
  const json = await res.json();
  const id = json?.data?.[0]?.id || null;
  if (id) hashtagIdCache.set(tag, id);
  return id;
}

/* ==================== Hashtag：分页（按标签游标） ==================== */

async function fetchHashtagEdgePage({ hashtagId, igId, pageToken, edge = "top_media", limit = 20, after = "" }) {
  const base = `https://graph.facebook.com/v23.0/${hashtagId}/${edge}`;
  const fields = "id,caption,media_type,media_url,permalink,timestamp";
  const u = new URL(base);
  u.searchParams.set("user_id", igId);
  u.searchParams.set("fields", fields);
  u.searchParams.set("limit", String(limit));
  if (after) u.searchParams.set("after", after);
  u.searchParams.set("access_token", pageToken);

  const res = await fetch(u.toString());
  const json = await res.json();

  if (!res.ok || json?.error) {
    const msg = json?.error?.message || `Graph ${res.status}`;
    throw new Error(msg);
  }

  const items = Array.isArray(json.data) ? json.data : [];
  const nextAfter = json?.paging?.cursors?.after || "";
  return { items, nextAfter };
}

/**
 * ✅ Hashtag 游标分页（多标签、可选 top/recent/both），做时间归并
 * @param {object} options
 * @param {string[]|string} options.tags   标签数组/逗号分隔字符串（缺省走 env）
 * @param {'top'|'recent'|'both'} options.strategy
 * @param {number} options.limit           单页条数（建议 12~60）
 * @param {object} options.cursors         { "<tag>": { topAfter?: string, recentAfter?: string } }
 * @returns {Promise<{items: Array, nextCursors: object}>}
 */
export async function fetchHashtagUGCPage({
  tags = DEFAULT_TAGS,
  strategy = "top",
  limit = 24,
  cursors = {},
} = {}) {
  if (!PAGE_TOKEN || !IG_ID) throw new Error("缺少 PAGE_TOKEN 或 INSTAGRAM_IG_ID");

  const tagArr = Array.isArray(tags) ? tags : parseTags(tags);
  if (!tagArr.length) return { items: [], nextCursors: {} };

  const edges = strategy === "both" ? ["top_media", "recent_media"]
               : strategy === "recent" ? ["recent_media"] : ["top_media"];

  const perBucket = Math.max(3, Math.ceil(limit / (tagArr.length * edges.length)));

  const ids = await Promise.all(tagArr.map(t => getHashtagId(t, IG_ID, PAGE_TOKEN)));
  const pairs = tagArr.map((t, i) => ({ tag: t, id: ids[i] })).filter(p => p.id);

  const buckets = [];
  const nextCursors = {};

  await Promise.all(pairs.map(async ({ tag, id }) => {
    for (const edge of edges) {
      const after = cursors?.[tag]?.[edge === "top_media" ? "topAfter" : "recentAfter"] || "";
      try {
        const page = await fetchHashtagEdgePage({
          hashtagId: id,
          igId: IG_ID,
          pageToken: PAGE_TOKEN,
          edge,
          limit: perBucket,
          after,
        });
        page.items.forEach(m => { m.__hashtag = tag; m.__edge = edge; });
        buckets.push(...page.items);
        if (!nextCursors[tag]) nextCursors[tag] = {};
        if (edge === "top_media") nextCursors[tag].topAfter = page.nextAfter || "";
        else nextCursors[tag].recentAfter = page.nextAfter || "";
      } catch {}
    }
  }));

  const merged = buckets
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      media_url: item.media_url,
      caption: item.caption || "",
      permalink: item.permalink,
      timestamp: item.timestamp,
      media_type: item.media_type,
      hashtag: item.__hashtag || "",
      username: item.username || "",
    }));

  return { items: merged, nextCursors };
}

/* ==================== Hashtag：一次抓满写盘（保留） ==================== */
export async function fetchHashtagUGC({
  tag = DEFAULT_TAGS,
  strategy = "top",
  limit = 50,
  outfile = "public/hashtag_ugc.json",
} = {}) {
  try {
    let collected = [];
    let cursors = {};
    while (collected.length < limit) {
      const page = await fetchHashtagUGCPage({
        tags: tag,
        strategy,
        limit: Math.min(60, limit - collected.length),
        cursors,
      });
      collected.push(...page.items);
      cursors = page.nextCursors;
      if (!page.items.length) break;
      await new Promise(r => setTimeout(r, 120));
    }

    const map = new Map();
    for (const m of collected) map.set(m.id, m);
    const merged = Array.from(map.values())
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);

    await fs.writeFile(outfile, JSON.stringify(merged, null, 2), "utf-8");
    console.log(`✅ hashtag 合并抓取 ${merged.length} 条，写入 ${outfile}`);
  } catch (err) {
    console.error("❌ 抓取 Hashtag UGC 出错:", err);
  }
}

/* ==================== Mentions（/tags）：分页 ==================== */

function buildTagsFields(includeChildren = false) {
  if (includeChildren) {
    return [
      "id","caption","media_type","media_url","thumbnail_url","permalink","timestamp","username",
      "children{media_type,media_url,thumbnail_url,id}",
    ].join(",");
  }
  return ["id","caption","media_type","media_url","thumbnail_url","permalink","timestamp","username"].join(",");
}

function normalizeTagItem(m) {
  return {
    id: m.id,
    media_url: m.media_url || m.thumbnail_url || "",
    thumbnail_url: m.thumbnail_url || null,
    media_type: m.media_type,
    caption: m.caption || "",
    permalink: m.permalink,
    timestamp: m.timestamp || "",
    username: m.username || "",
    children: Array.isArray(m.children?.data)
      ? m.children.data.map((c) => ({
          id: c.id,
          media_type: c.media_type,
          media_url: c.media_url || "",
          thumbnail_url: c.thumbnail_url || null,
        }))
      : [],
  };
}

/**
 * ✅ Mentions (/tags) 游标分页（单页）
 */
export async function fetchTagUGCPage({ limit = 24, after = "", includeChildren = false } = {}) {
  if (!USER_TOKEN || !IG_ID) throw new Error("缺少 INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_IG_ID");

  const u = new URL(`https://graph.facebook.com/v23.0/${IG_ID}/tags`);
  u.searchParams.set("fields", buildTagsFields(includeChildren));
  u.searchParams.set("limit", String(limit));
  if (after) u.searchParams.set("after", after);
  u.searchParams.set("access_token", USER_TOKEN);

  const res = await fetch(u.toString());
  const json = await res.json();

  if (!res.ok || json?.error) {
    const msg = json?.error?.message || `Graph ${res.status}`;
    const code = json?.error?.code || res.status;
    throw Object.assign(new Error(msg), { code });
  }

  const items = Array.isArray(json.data) ? json.data.map(normalizeTagItem) : [];
  const nextAfter = json?.paging?.cursors?.after || "";
  const nextUrl = json?.paging?.next || "";

  return { items, nextAfter, nextUrl };
}

/**
 * 保留：mentions 一次抓够写盘（内部逐页）
 */
export async function fetchTagUGC({
  limit = 100,
  outfile = "public/tag_ugc.json",
  includeChildren = false,
} = {}) {
  if (!USER_TOKEN || !IG_ID) {
    console.error("❌ 缺少 igUserToken 或 INSTAGRAM_IG_ID 环境变量");
    return;
  }

  let collected = [];
  let after = "";
  try {
    while (collected.length < limit) {
      const page = await fetchTagUGCPage({
        limit: Math.min(50, limit - collected.length),
        after,
        includeChildren,
      });
      collected.push(...page.items);
      if (!page.nextAfter) break;
      after = page.nextAfter;
      await new Promise((r) => setTimeout(r, 120));
    }

    const map = new Map();
    for (const m of collected) map.set(m.id, m);
    const merged = Array.from(map.values())
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);

    await fs.writeFile(outfile, JSON.stringify(merged, null, 2), "utf-8");
    console.log(`✅ mentions 逐页抓取 ${merged.length} 条，写入 ${outfile}`);
  } catch (err) {
    console.error("❌ 抓取 mentions 出错：", err);
  }
}
