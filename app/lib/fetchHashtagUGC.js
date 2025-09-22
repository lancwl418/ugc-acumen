// app/lib/fetchHashtagUGC.js
import fetch from "node-fetch";

/** 环境变量 */
const IG_ID      = process.env.INSTAGRAM_IG_ID || "";     // 你的 IG Business 用户ID（数字）
const PAGE_TOKEN = process.env.PAGE_TOKEN || "";          // hashtag edges
const USER_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || ""; // /tags & mentioned_media
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
async function edgePage({hashtagId, edge="top_media", limit=10, after=""}){
  const u = new URL(`https://graph.facebook.com/v23.0/${hashtagId}/${edge}`);
  u.searchParams.set("user_id", IG_ID);
  // 加上 username 便于后台展示（不强依赖）
  u.searchParams.set("fields", "id,caption,media_type,media_url,permalink,timestamp,username");
  u.searchParams.set("limit", String(limit));
  if (after) u.searchParams.set("after", after);
  u.searchParams.set("access_token", PAGE_TOKEN);
  const r = await withLimit(()=>fetch(u));
  const j = await r.json();
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

    const per = Math.max(3, Math.ceil(limit / Math.max(1,pairs.length)));
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
      // 轮播：第一帧兜底
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

/* ==================================================================== */
/* ========== 新增：按 /tags 翻页匹配刷新指定条目的 media_url ========= */
/* ==================================================================== */
export async function refreshMediaUrlByTag(entry, { per = 50, maxPages = 3 } = {}) {
  if (!IG_ID || !USER_TOKEN) return entry;

  let after = "";
  for (let i = 0; i < maxPages; i++) {
    const u = new URL(`https://graph.facebook.com/v23.0/${IG_ID}/tags`);
    u.searchParams.set(
      "fields",
      "id,media_type,media_url,thumbnail_url,caption,permalink,timestamp,username,children{media_type,media_url,thumbnail_url}"
    );
    u.searchParams.set("limit", String(per));
    if (after) u.searchParams.set("after", after);
    u.searchParams.set("access_token", USER_TOKEN);

    const r = await withLimit(() => fetch(u));
    const j = await r.json();
    if (!r.ok || j?.error) break;

    const hit = (j.data || []).find(m => String(m.id) === String(entry.id));
    if (hit) {
      if (hit.media_type === "CAROUSEL_ALBUM" && hit.children?.data?.length) {
        const f = hit.children.data[0];
        hit.media_type    = f.media_type || hit.media_type;
        hit.media_url     = f.media_url  || hit.media_url;
        hit.thumbnail_url = f.thumbnail_url || hit.thumbnail_url || hit.media_url;
      }
      if (!hit.media_url && !hit.thumbnail_url) return entry;

      return {
        ...entry,
        media_type:    hit.media_type || entry.media_type,
        media_url:     hit.media_url  || entry.media_url,
        thumbnail_url: hit.thumbnail_url ?? entry.thumbnail_url ?? null,
        caption:       hit.caption ?? entry.caption,
        permalink:     hit.permalink || entry.permalink,
        timestamp:     hit.timestamp || entry.timestamp,
        username:      hit.username  || entry.username,
      };
    }

    after = j?.paging?.cursors?.after || "";
    if (!after) break;
  }
  return entry;
}

/* ==================================================================== */
/* ========== Hashtag：按 hashtag 扫描刷新指定条目（保留） ============ */
/* ==================================================================== */
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
          username: hit.username || entry.username,
        };
      }
      if (!p.nextAfter) break;
      after = p.nextAfter;
    }
    return null;
  }

  return (await search("top_media")) || (await search("recent_media")) || entry;
}

/* ==================================================================== */
/* ========== 仅当“没有可用媒体”时才补一次（hashtag / mentions） ===== */
/* ==================================================================== */
export async function fillMissingMediaOnce(entry, { source="hashtag" } = {}) {
  if (entry.media_url || entry.thumbnail_url) return entry;
  try {
    if (source === "hashtag") {
      const refreshed = await refreshMediaUrlByHashtag(entry, { per: 30, maxPages: 2 });
      return refreshed || entry;
    } else {
      const refreshed = await refreshMediaUrlByTag(entry, { per: 50, maxPages: 3 });
      return refreshed || entry;
    }
  } catch { return entry; }
}

/* ==================================================================== */
/* ========== 可选：按链接导入（若不用 oEmbed，可忽略此函数） ========= */
/* ==================================================================== */
export async function fetchInstagramByPermalink(permalink) {
  const url = String(permalink || "").trim();
  if (!url) throw new Error("Empty permalink");
  if (!OEMBED) throw new Error("Missing OEMBED token (META_APP_ID|META_APP_SECRET)");
  if (!USER_TOKEN && !PAGE_TOKEN) throw new Error("Missing IG access token");

  return withCache(`p:${url}`, 30_000, async () => {
    const oe = new URL("https://graph.facebook.com/v23.0/instagram_oembed");
    oe.searchParams.set("url", url);
    oe.searchParams.set("access_token", OEMBED || USER_TOKEN);
    oe.searchParams.set("omitscript", "true");
    oe.searchParams.set("hidecaption", "true");
    const oeRes = await withLimit(()=>fetch(oe));
    const oeJson = await oeRes.json();
    if (!oeRes.ok || oeJson?.error) throw new Error(oeJson?.error?.message || `oEmbed failed ${oeRes.status}`);
    const mediaId = oeJson.media_id;
    const permalinkCanonical = url;
    if (!mediaId) throw new Error("No media_id from oEmbed");

    const token = USER_TOKEN || PAGE_TOKEN;
    const fields =
      "id,media_type,media_url,thumbnail_url,caption,username,timestamp,permalink,children{media_type,media_url,thumbnail_url}";
    const mUrl = new URL(`https://graph.facebook.com/v23.0/${encodeURIComponent(mediaId)}`);
    mUrl.searchParams.set("fields", fields);
    mUrl.searchParams.set("access_token", token);
    const mRes = await withLimit(()=>fetch(mUrl));
    const m = await mRes.json();
    if (!mRes.ok || m?.error) throw new Error(m?.error?.message || `Graph media ${mRes.status}`);

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
      hashtag: "",
    };
  });
}
