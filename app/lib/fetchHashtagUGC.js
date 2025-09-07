// app/lib/fetchHashtagUGC.js
import fetch from "node-fetch";

/** 环境变量 */
const IG_ID      = process.env.INSTAGRAM_IG_ID || "";
const PAGE_TOKEN = process.env.PAGE_TOKEN || "";                 // hashtag edges
const USER_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || "";     // /tags & mentioned_media
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

/* ============== 仅当“没有可用图片时”才补一次 ============== */
export async function fillMissingMediaOnce(entry, { source="hashtag" } = {}) {
  if (entry.media_url || entry.thumbnail_url) return entry; // 已有就不补
  try {
    if (source === "hashtag") {
      if (!OEMBED || !entry.permalink) return entry;
      const u = new URL("https://graph.facebook.com/v23.0/instagram_oembed");
      u.searchParams.set("url", entry.permalink);
      u.searchParams.set("access_token", OEMBED);
      u.searchParams.set("omitscript", "true");
      u.searchParams.set("hidecaption", "true");
      u.searchParams.set("maxwidth", "640");
      const r = await withLimit(()=>fetch(u)); const j = await r.json();
      const thumb = j?.thumbnail_url || "";
      if (thumb) return { ...entry, media_url: thumb, thumbnail_url: thumb };
      return entry;
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
