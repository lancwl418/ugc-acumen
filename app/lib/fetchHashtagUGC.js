// app/lib/fetchHashtagUGC.js
import fetch from "node-fetch";

/** 环境变量 */
const IG_ID      = process.env.INSTAGRAM_IG_ID || "";
const PAGE_TOKEN = process.env.PAGE_TOKEN || "";                 // hashtag edges
const USER_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || "";     // /tags & mentioned_media & media detail
const APP_ID     = process.env.META_APP_ID || "";
const APP_SECRET = process.env.META_APP_SECRET || "";
// 注意：oEmbed 相关能力正在迁移/收紧，此 token 仅用于 `fetchInstagramByPermalink`（可选功能）
const OEMBED     = (APP_ID && APP_SECRET) ? `${APP_ID}|${APP_SECRET}` : "";
const DEFAULT_TAGS = (process.env.HASHTAGS || process.env.HASHTAG || "acumencamera");

/* ============== 极简缓存 + 并发限流（保持轻量） ============== */
const mem = new Map(); // key -> {expiry, promise}
function withCache(key, ms, fn) {
  const now = Date.now();
  const hit = mem.get(key);
  if (hit && hit.expiry > now) return hit.promise;
  const p = (async () => await fn())();
  mem.set(key, { expiry: now + ms, promise: p });
  return p;
}
const MAX = 6; let inq = 0; const waiters = [];
async function withLimit(fn){ if(inq>=MAX) await new Promise(r=>waiters.push(r)); inq++; try{ return await fn(); } finally{ inq--; const n=waiters.shift(); n&&n(); }}

/* ====================== Hashtag 辅助 ======================= */
function parseTags(s){ return String(s||"").split(",").map(x=>x.trim()).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i); }
const hashtagIdCache = new Map();
async function getHashtagId(tag){
  if (hashtagIdCache.has(tag)) return hashtagIdCache.get(tag);
  const u = new URL("https://graph.facebook.com/v23.0/ig_hashtag_search");
  u.searchParams.set("user_id", IG_ID);
  u.searchParams.set("q", tag);
  u.searchParams.set("access_token", PAGE_TOKEN);
  const r = await withLimit(()=>fetch(u)); const j = await r.json();
  const id = j?.data?.[0]?.id || null; if(id) hashtagIdCache.set(tag,id);
  return id;
}
async function edgePage({hashtagId, edge="top_media", limit=10, after=""}){
  const u = new URL(`https://graph.facebook.com/v23.0/${hashtagId}/${edge}`);
  u.searchParams.set("user_id", IG_ID);
  u.searchParams.set("fields", "id,caption,media_type,media_url,permalink,timestamp");
  u.searchParams.set("limit", String(limit));
  if (after) u.searchParams.set("after", after);
  u.searchParams.set("access_token", PAGE_TOKEN);
  const r = await withLimit(()=>fetch(u)); const j = await r.json();
  if (!r.ok || j?.error) throw new Error(j?.error?.message || `Graph ${r.status}`);
  return { items: j.data || [], nextAfter: j?.paging?.cursors?.after || "" };
}

/** ✅ Hashtag 分页（多标签合并，时间排序），返回 {items, nextCursors} */
export async function fetchHashtagUGCPage({ tags=DEFAULT_TAGS, limit=12, cursors={} } = {}) {
  const key = `h:${JSON.stringify({tags,limit,cursors})}`;
  return withCache(key, 30_000, async () => {
    if (!IG_ID || !PAGE_TOKEN) return { items: [], nextCursors: {} };
    const list = Array.isArray(tags) ? tags : parseTags(tags);
    if (!list.length) return { items: [], nextCursors: {} };

    const ids = await Promise.all(list.map(getHashtagId));
    const pairs = list.map((t,i)=>({tag:t,id:ids[i]})).filter(p=>p.id);

    const per = Math.max(3, Math.ceil(limit / pairs.length));
    const all = []; const next = {};
    await Promise.all(pairs.map(async ({tag,id})=>{
      const after = cursors?.[tag]?.topAfter || "";
      const p = await edgePage({hashtagId:id, edge:"top_media", limit:per, after});
      p.items.forEach(x=>x.__hashtag = tag);
      all.push(...p.items);
      next[tag] = { topAfter: p.nextAfter || "" };
    }));

    const items = all
      .sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp))
      .slice(0, limit)
      .map(m => ({
        id: m.id,
        media_url: m.media_url || "",
        thumbnail_url: null,
        media_type: m.media_type,
        caption: m.caption || "",
        permalink: m.permalink || "",
        timestamp: m.timestamp || "",
        username: m.username || "",
        hashtag: m.__hashtag || "",
      }));

    return { items, nextCursors: next };
  });
}

/* ====================== Mentions (/tags) 分页 ======================= */
export async function fetchTagUGCPage({ limit=12, after="" } = {}) {
  const key = `t:${limit}:${after}`;
  return withCache(key, 30_000, async () => {
    if (!IG_ID || !USER_TOKEN) return { items: [], nextAfter: "" };
    const u = new URL(`https://graph.facebook.com/v23.0/${IG_ID}/tags`);
    u.searchParams.set("fields","id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,username");
    u.searchParams.set("limit", String(limit));
    if (after) u.searchParams.set("after", after);
    u.searchParams.set("access_token", USER_TOKEN);

    const r = await withLimit(()=>fetch(u)); const j = await r.json();
    if (!r.ok || j?.error) throw new Error(j?.error?.message || `Graph ${r.status}`);

    const items = (j.data || []).map(m => ({
      id: m.id,
      media_url: m.media_url || m.thumbnail_url || "",
      thumbnail_url: m.thumbnail_url || null,
      media_type: m.media_type,
      caption: m.caption || "",
      permalink: m.permalink || "",
      timestamp: m.timestamp || "",
      username: m.username || "",
    }));
    return { items, nextAfter: j?.paging?.cursors?.after || "" };
  });
}

/* ==================================================================== */
/* ========== 新增：按 hashtag 扫描，刷新指定条目的 media_url ========= */
/* ==================================================================== */

/**
 * 基于 visible 条目中的 `id` 与 `hashtag`，
 * 通过对应 hashtag 的 top_media（找不到再 recent_media）分页扫描，
 * 找到同一条 post 后，回写“当下最新”的 media 字段。
 *
 * @param {Object} entry  visible 里的一条：至少包含 { id, hashtag, ... }
 * @param {Object} opts   { per=30, maxPages=3 }
 * @return entry 的更新副本（找不到则原样返回）
 */
export async function refreshMediaUrlByHashtag(entry, { per = 30, maxPages = 3 } = {}) {
  const tag = String(entry?.hashtag || "").replace(/^#/, "");
  if (!tag) return entry;

  const hid = await getHashtagId(tag);
  if (!hid) return entry;

  async function search(edge) {
    let after = "";
    for (let i = 0; i < maxPages; i++) {
      const p = await edgePage({ hashtagId: hid, edge, limit: per, after });
      const hit = (p.items || []).find((x) => String(x.id) === String(entry.id));
      if (hit) {
        return {
          ...entry,
          media_type: hit.media_type || entry.media_type,
          media_url: hit.media_url || entry.media_url,
          caption: hit.caption ?? entry.caption,
          permalink: hit.permalink || entry.permalink,
          timestamp: hit.timestamp || entry.timestamp,
        };
      }
      if (!p.nextAfter) break;
      after = p.nextAfter;
    }
    return null;
  }

  return (await search("top_media")) || (await search("recent_media")) || entry;
}

/* ============== 仅当“没有可用图片/视频时”才补一次（不再用 oEmbed） ============== */
export async function fillMissingMediaOnce(entry, { source="hashtag" } = {}) {
  if (entry.media_url || entry.thumbnail_url) return entry; // 已有就不补
  try {
    if (source === "hashtag") {
      // ⚠️ 以前用 oEmbed 的缩略图，这里改为用 hashtag 扫描回填
      const refreshed = await refreshMediaUrlByHashtag(entry, { per: 30, maxPages: 2 });
      return refreshed || entry;
    } else {
      // mentions：single media via mentioned_media.media_id()
      if (!IG_ID || !USER_TOKEN) return entry;
      const fields = "id,media_type,media_url,thumbnail_url";
      const u = new URL(`https://graph.facebook.com/v23.0/${IG_ID}`);
      u.searchParams.set("fields", `mentioned_media.media_id(${encodeURIComponent(entry.id)}){${fields}}`);
      u.searchParams.set("access_token", USER_TOKEN);
      const r = await withLimit(()=>fetch(u)); const j = await r.json();
      const n = j?.mentioned_media?.data?.[0] || {};
      const raw   = n.media_url || n.thumbnail_url || "";
      const thumb = n.thumbnail_url || n.media_url || "";
      if (raw || thumb) return { ...entry, media_url: raw || thumb, thumbnail_url: thumb || null };
      return entry;
    }
  } catch { return entry; }
}

/* ==================================================================== */
/* ========== 可选：按 Instagram 链接抓取单条媒体（用于导入） ========== */
/* ==================================================================== */
/**
 * 说明：此方法仍借助 oEmbed 解析 media_id（官方正在迁移为 Meta oEmbed Read，
 *       未来字段可能变化）。若你不打算再用 oEmbed，可忽略此函数。
 *
 * 输入任意 Instagram 帖子/短片链接（/p/... 或 /reel/...），
 * 返回与你 hashtag/mentions 一致的结构：
 * { id, username, timestamp, media_type, media_url, thumbnail_url, caption, permalink, hashtag }
 */
export async function fetchInstagramByPermalink(permalink) {
  const url = String(permalink || "").trim();
  if (!url) throw new Error("Empty permalink");
  if (!OEMBED) throw new Error("Missing OEMBED token (META_APP_ID|META_APP_SECRET)");
  if (!USER_TOKEN && !PAGE_TOKEN) throw new Error("Missing IG access token (INSTAGRAM_ACCESS_TOKEN or PAGE_TOKEN)");

  return withCache(`p:${url}`, 30_000, async () => {
    // 1) oEmbed → media_id（注意：未来可能变更/下线该字段）
    const oe = new URL("https://graph.facebook.com/v23.0/instagram_oembed");
    oe.searchParams.set("url", url);
    // 可用 OEMBED 或 USER_TOKEN 其一
    oe.searchParams.set("access_token", OEMBED || USER_TOKEN);
    oe.searchParams.set("omitscript", "true");
    oe.searchParams.set("hidecaption", "true");
    const oeRes = await withLimit(()=>fetch(oe));
    const oeJson = await oeRes.json();
    if (!oeRes.ok || oeJson?.error) {
      throw new Error(oeJson?.error?.message || `oEmbed failed ${oeRes.status}`);
    }
    const mediaId = oeJson.media_id;
    const permalinkCanonical = url;

    if (!mediaId) throw new Error("No media_id from oEmbed");

    // 2) Graph → 媒体详情
    const token = USER_TOKEN || PAGE_TOKEN;
    const fields =
      "id,media_type,media_url,thumbnail_url,caption,username,timestamp,permalink,children{media_type,media_url,thumbnail_url}";
    const mUrl = new URL(`https://graph.facebook.com/v23.0/${encodeURIComponent(mediaId)}`);
    mUrl.searchParams.set("fields", fields);
    mUrl.searchParams.set("access_token", token);
    const mRes = await withLimit(()=>fetch(mUrl));
    const m = await mRes.json();
    if (!mRes.ok || m?.error) {
      throw new Error(m?.error?.message || `Graph media ${mRes.status}`);
    }

    // 3) 归一化
    let mediaType = m.media_type;
    let mediaUrl  = m.media_url || "";
    let thumb     = m.thumbnail_url || "";

    if (m.media_type === "CAROUSEL_ALBUM" && m.children?.data?.length) {
      const first = m.children.data[0];
      mediaType = first.media_type || mediaType;
      mediaUrl  = first.media_url || mediaUrl;
      thumb     = first.thumbnail_url || thumb || mediaUrl;
    }

    return {
      id: String(m.id),
      username: m.username || "",
      timestamp: m.timestamp || "",
      media_type: mediaType === "VIDEO" ? "VIDEO" : "IMAGE",
      media_url: mediaUrl || thumb || "",
      thumbnail_url: thumb || null,
      caption: m.caption || "",
      permalink: m.permalink || permalinkCanonical,
      hashtag: "", // 导入入口不强制归属 hashtag
    };
  });
}
