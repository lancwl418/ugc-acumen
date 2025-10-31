// app/lib/fetchHashtagUGC.js
import fetch from "node-fetch";

/** 环境变量 */
const IG_ID      = process.env.INSTAGRAM_IG_ID || "";         // IG Business 用户ID（数字）
const PAGE_TOKEN = process.env.PAGE_TOKEN || "";               // hashtag edges
const USER_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || "";   // /tags & mentioned_media
const APP_ID     = process.env.META_APP_ID || "";
const APP_SECRET = process.env.META_APP_SECRET || "";
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
  const r = await withLimit(()=>fetch(u));
  const j = await r.json();
  const id = j?.data?.[0]?.id || null;
  if (id) hashtagIdCache.set(tag,id);
  return id;
}

/**
 * 统一的 edge 请求。
 * 支持：
 *  - 传入 nextUrl（Graph 返回的 paging.next 完整 URL）
 *  - 或者传入 after 游标（我们自己构建 URL）
 */
async function edgePage({hashtagId, edge="top_media", limit=10, after="", nextUrl=""}){
  let u;
  if (nextUrl) {
    // 直接用 Graph 提供的完整 next URL（包含 access_token / after）
    u = nextUrl;
  } else {
    const url = new URL(`https://graph.facebook.com/v23.0/${hashtagId}/${edge}`);
    url.searchParams.set("user_id", IG_ID);
    url.searchParams.set("fields", "id,caption,media_type,media_url,permalink,timestamp");
    url.searchParams.set("limit", String(limit));
    if (after) url.searchParams.set("after", after);
    url.searchParams.set("access_token", PAGE_TOKEN);
    u = url.toString();
  }

  const r = await withLimit(()=>fetch(u));
  const j = await r.json();
  if (!r.ok || j?.error) throw new Error(j?.error?.message || `Graph ${r.status}`);

  return {
    items: j.data || [],
    nextAfter: j?.paging?.cursors?.after || "",
    nextUrl: j?.paging?.next || ""         // 关键：把 next 也带回来
  };
}

/** ✅ Hashtag 分页（多标签合并，时间排序），返回 {items, nextCursors} */
export async function fetchHashtagUGCPage({ tags=DEFAULT_TAGS, limit=12, cursors={} } = {}) {
  const key = `h:${JSON.stringify({tags,limit,cursors})}`;
  return withCache(key, 10_000, async () => {
    if (!IG_ID || !PAGE_TOKEN) return { items: [], nextCursors: {} };
    const list = Array.isArray(tags) ? tags : parseTags(tags);
    if (!list.length) return { items: [], nextCursors: {} };

    const ids = await Promise.all(list.map(getHashtagId));
    const pairs = list.map((t,i)=>({tag:t,id:ids[i]})).filter(p=>p.id);

    const perPerTag = Math.max(3, Math.ceil(limit / Math.max(1,pairs.length)));
    const all = []; const next = {};

    for (const {tag,id} of pairs) {
      const prev = cursors?.[tag] || {};
      const topAfter  = prev.topNext    ? "" : (prev.topAfter || "");
      const topNext   = prev.topNext    || "";
      const recAfter  = prev.recentNext ? "" : (prev.recentAfter || "");
      const recNext   = prev.recentNext || "";

      const [top, rec] = await Promise.all([
        edgePage({
          hashtagId: id,
          edge: "top_media",
          limit: Math.max(2, Math.ceil(perPerTag/2)),
          after: topAfter,
          nextUrl: topNext
        }),
        edgePage({
          hashtagId: id,
          edge: "recent_media",
          limit: Math.max(2, Math.ceil(perPerTag/2)),
          after: recAfter,
          nextUrl: recNext
        }),
      ]);

      (top.items||[]).forEach(x=>x.__hashtag=tag);
      (rec.items||[]).forEach(x=>x.__hashtag=tag);
      all.push(...(top.items||[]), ...(rec.items||[]));

      next[tag] = {
        topAfter: top.nextAfter || "",
        topNext : top.nextUrl   || "",
        recentAfter: rec.nextAfter || "",
        recentNext : rec.nextUrl   || "",
      };
    }

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

    return { items, nextCursors: next, pageSize: limit, tags };
  });
}

/* ====================== Mentions (/tags) 分页（保持不变） ======================= */
export async function fetchTagUGCPage({ limit=12, after="" } = {}) {
  const key = `t:${limit}:${after}`;
  return withCache(key, 30_000, async () => {
    if (!IG_ID || !USER_TOKEN) return { items: [], nextAfter: "" };

    const u = new URL(`https://graph.facebook.com/v23.0/${IG_ID}/tags`);
    u.searchParams.set(
      "fields",
      "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,username,children{media_type,media_url,thumbnail_url}"
    );
    u.searchParams.set("limit", String(limit));
    if (after) u.searchParams.set("after", after);
    u.searchParams.set("access_token", USER_TOKEN);

    const r = await withLimit(()=>fetch(u));
    const j = await r.json();
    if (!r.ok || j?.error) throw new Error(j?.error?.message || `Graph ${r.status}`);

    const items = (j.data || []).map(m => {
      if (m.media_type === "CAROUSEL_ALBUM" && m.children?.data?.length) {
        const f = m.children.data[0];
        m.media_type = f.media_type || m.media_type;
        m.media_url = f.media_url || m.media_url;
        m.thumbnail_url = f.thumbnail_url || m.thumbnail_url || m.media_url;
      }
      return {
        id: m.id,
        media_url: m.media_url || m.thumbnail_url || "",
        thumbnail_url: m.thumbnail_url || null,
        media_type: m.media_type,
        caption: m.caption || "",
        permalink: m.permalink || "",
        timestamp: m.timestamp || "",
        username: m.username || "",
      };
    });

    return { items, nextAfter: j?.paging?.cursors?.after || "" };
  });
}

/* ======= 其余：refresh / scan / oEmbed（与你上版相同，无需改动） ======= */
// ...（保持你现有的 refreshMediaUrlByTag / refreshMediaUrlByHashtag / fillMissingMediaOnce /
//      fetchInstagramByPermalink / scanTagsUntil / scanHashtagsUntil 全部不动）
export async function refreshMediaUrlByTag(entry, opts){ /* 原样保留 */ }
export async function refreshMediaUrlByHashtag(entry, opts){ /* 原样保留 */ }
export async function fillMissingMediaOnce(entry, opts){ /* 原样保留 */ }
export async function fetchInstagramByPermalink(permalink){ /* 原样保留 */ }
export async function scanTagsUntil(opts){ /* 原样保留 */ }
export async function scanHashtagsUntil(opts){ /* 原样保留 */ }
