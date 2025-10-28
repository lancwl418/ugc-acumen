// app/lib/fetchHashtagUGC.js
import fetch from "node-fetch";

/** 环境变量 */
const IG_ID      = process.env.INSTAGRAM_IG_ID || "";         // IG Business 用户ID（数字）
const PAGE_TOKEN = process.env.PAGE_TOKEN || "";               // hashtag edges
const USER_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || "";   // /tags & mentioned_media & media detail
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
      // 轮播/视频第一帧兜底
      for (const m of p.items || []) {
        if (m.media_type === "CAROUSEL_ALBUM" && m.children?.data?.length) {
          const f = m.children.data[0];
          m.media_type    = f.media_type || m.media_type;
          m.media_url     = f.media_url  || m.media_url;
          m.thumbnail_url = f.thumbnail_url || m.thumbnail_url || m.media_url;
        } else if (m.media_type === "VIDEO") {
          m.thumbnail_url = m.thumbnail_url || m.media_url || null;
        }
        m.__hashtag = tag;
      }
      all.push(...(p.items || []));
      next[tag] = { topAfter: p.nextAfter || "" };
    }));

    const items = all
      .sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp))
      .slice(0, limit)
      .map(m => ({
        id: m.id,
        media_url: m.media_url || m.thumbnail_url || "",
        thumbnail_url: m.thumbnail_url || null,
        media_type: m.media_type,
        caption: m.caption || "",
        permalink: m.permalink || "",
        timestamp: m.timestamp || "",
        username: "",             // hashtag edges 不保证提供
        hashtag: m.__hashtag || "",
      }));

    return { items, nextCursors: next };
  });
}

/* ====================== Mentions (/tags) 分页（保持原样，不改） ======================= */
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
      } else if (m.media_type === "VIDEO") {
        m.thumbnail_url = m.thumbnail_url || m.media_url || null;
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
/* ========== 新：/tags 单条刷新 —— 扫到命中为止 ===================== */
/* ==================================================================== */
export async function refreshMediaUrlByTag(entry, {
  per = 50,              // 每页条数（IG 通常 50 比较稳）
  maxScan = 5000,        // 最多扫描多少条，防止极端情况
  hardPageCap = 200,     // 硬性最多翻多少页，双保险
  retry = 3,             // 瞬时错误重试
  retryBaseMs = 500,     // 重试的基础退避
} = {}) {
  if (!IG_ID || !USER_TOKEN || !entry || !entry.id) return entry;

  let after = "";
  let scanned = 0;
  let pageCount = 0;

  while (true) {
    if (scanned >= maxScan || pageCount >= hardPageCap) break;

    const u = new URL(`https://graph.facebook.com/v23.0/${IG_ID}/tags`);
    u.searchParams.set(
      "fields",
      "id,media_type,media_url,thumbnail_url,caption,permalink,timestamp,username,children{media_type,media_url,thumbnail_url}"
    );
    u.searchParams.set("limit", String(per));
    if (after) u.searchParams.set("after", after);
    u.searchParams.set("access_token", USER_TOKEN);

    let r, j;
    for (let k = 0; k <= retry; k++) {
      r = await withLimit(() => fetch(u));
      j = await r.json();
      const transient =
        j?.error?.code === 4 || // rate limit
        j?.error?.code === 17 || // user request limit
        j?.error?.code === 32 || // read-only mode
        r.status >= 500;         // server error
      if (r.ok && !j?.error) break;
      if (k < retry && transient) {
        const backoff = retryBaseMs * Math.pow(2, k);
        await new Promise((res) => setTimeout(res, backoff));
        continue;
      }
      return entry; // 非瞬时或最终失败：保持原样
    }

    const data = Array.isArray(j?.data) ? j.data : [];
    scanned += data.length;
    pageCount++;

    const hit = data.find((m) => String(m.id) === String(entry.id));
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
        __refreshedBy: "tags",
      };
    }

    after = j?.paging?.cursors?.after || "";
    if (!after) break;
  }

  return entry; // 没命中则保持原样
}

/* ==================================================================== */
/* ========== Hashtag：按 hashtag 扫描刷新指定条目（保留） ============ */
/* ==================================================================== */
export async function refreshMediaUrlByHashtag(entry, {
  per = 30, maxScan = 3000, hardPageCap = 200
} = {}) {
  const tag = String(entry?.hashtag || "").replace(/^#/, "");
  if (!tag) return entry;

  const hid = await getHashtagId(tag);
  if (!hid) return entry;

  async function search(edge) {
    let after = "";
    let scanned = 0;
    let pages = 0;
    while (scanned < maxScan && pages < hardPageCap) {
      const p = await edgePage({ hashtagId: hid, edge, limit: per, after });
      const list = Array.isArray(p.items) ? p.items : [];
      scanned += list.length;
      pages++;

      // ✅ 命中即对视频/轮播做兜底，保证 media_url/thumbnail_url 可用
      const hit = list.find((x) => String(x.id) === String(entry.id));
      if (hit) {
        if (hit.media_type === "CAROUSEL_ALBUM" && hit.children?.data?.length) {
          const f = hit.children.data[0];
          hit.media_type    = f.media_type || hit.media_type;
          hit.media_url     = f.media_url  || hit.media_url;
          hit.thumbnail_url = f.thumbnail_url || hit.thumbnail_url || hit.media_url;
        } else if (hit.media_type === "VIDEO") {
          hit.thumbnail_url = hit.thumbnail_url || hit.media_url || null;
        }
        const mediaUrl = hit.media_url || hit.thumbnail_url || entry.media_url || "";
        const thumbUrl = hit.thumbnail_url ?? entry.thumbnail_url ?? null;
        return {
          ...entry,
          media_type: hit.media_type || entry.media_type,
          media_url: mediaUrl,
          thumbnail_url: thumbUrl,
          caption: hit.caption ?? entry.caption,
          permalink: hit.permalink || entry.permalink,
          timestamp: hit.timestamp || entry.timestamp,
          username: entry.username || "", // hashtag edges不提供
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
      const refreshed = await refreshMediaUrlByHashtag(entry, { per: 30, maxScan: 3000, hardPageCap: 200 });
      return refreshed || entry;
    } else {
      const refreshed = await refreshMediaUrlByTag(entry, { per: 50, maxScan: 5000, hardPageCap: 200 });
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

/* ==================================================================== */
/* ========== 新：一次扫描 /tags，直到命中所有 targetIds 即停 ========= */
/* ==================================================================== */
export async function scanTagsUntil({
  targetIds,
  per = 50,
  maxScan = 10000,
  hardPageCap = 300,
  retry = 3,
  retryBaseMs = 500,
} = {}) {
  if (!IG_ID || !USER_TOKEN) return { hits: new Map(), scanned: 0, pages: 0, done: true };

  const goals = new Set(Array.isArray(targetIds) ? targetIds.map(String) : Array.from(targetIds).map(String));
  const hits = new Map(); // id -> mediaObject
  let after = "";
  let scanned = 0;
  let pages = 0;

  while (goals.size > 0 && scanned < maxScan && pages < hardPageCap) {
    const u = new URL(`https://graph.facebook.com/v23.0/${IG_ID}/tags`);
    u.searchParams.set(
      "fields",
      "id,media_type,media_url,thumbnail_url,caption,permalink,timestamp,username,children{media_type,media_url,thumbnail_url}"
    );
    u.searchParams.set("limit", String(per));
    if (after) u.searchParams.set("after", after);
    u.searchParams.set("access_token", USER_TOKEN);

    let r, j;
    for (let k = 0; k <= retry; k++) {
      r = await withLimit(() => fetch(u));
      j = await r.json();
      const transient = j?.error?.code === 4 || j?.error?.code === 17 || j?.error?.code === 32 || r.status >= 500;
      if (r.ok && !j?.error) break;
      if (k < retry && transient) {
        await new Promise(res => setTimeout(res, retryBaseMs * Math.pow(2, k)));
        continue;
      }
      return { hits, scanned, pages, done: false, error: j?.error || { status: r.status } };
    }

    const data = Array.isArray(j?.data) ? j.data : [];
    scanned += data.length;
    pages++;

    for (const m of data) {
      const id = String(m.id || "");
      if (!goals.has(id)) continue;

      if (m.media_type === "CAROUSEL_ALBUM" && m.children?.data?.length) {
        const f = m.children.data[0];
        m.media_type    = f.media_type || m.media_type;
        m.media_url     = f.media_url  || m.media_url;
        m.thumbnail_url = f.thumbnail_url || m.thumbnail_url || m.media_url;
      } else if (m.media_type === "VIDEO") {
        m.thumbnail_url = m.thumbnail_url || m.media_url || null;
      }

      hits.set(id, {
        id,
        media_type: m.media_type,
        media_url: m.media_url || m.thumbnail_url || "",
        thumbnail_url: m.thumbnail_url || null,
        caption: m.caption || "",
        permalink: m.permalink || "",
        timestamp: m.timestamp || "",
        username: m.username || "",
      });

      goals.delete(id);
      if (goals.size === 0) break; // ✅ 所有目标已命中，提前结束
    }

    if (goals.size === 0) break;
    after = j?.paging?.cursors?.after || "";
    if (!after) break; // 没有下一页了
  }

  const done = goals.size === 0 || !after;
  return { hits, scanned, pages, done };
}
/* ==================================================================== */
/* ========== Mentions：单条刷新（按 /tags 扫到命中为止） ============== */
/* ==================================================================== */
export async function scanHashtagsUntil({
  tags = DEFAULT_TAGS,               // string 或 string[]
  targetIds,                         // Set<string> / string[]
  per = 50,                          // 每页条数
  maxScanPerTagPerEdge = 6000,       // 单 tag 单 edge 最大扫描条数
  hardPageCapPerTagPerEdge = 200,    // 单 tag 单 edge 最大翻页数
} = {}) {
  const tagList = Array.isArray(tags) ? tags : parseTags(tags);
  const goals = new Set(Array.isArray(targetIds) ? targetIds.map(String) : Array.from(targetIds).map(String));
  const hits = new Map(); // id -> mediaObject

  if (!IG_ID || !PAGE_TOKEN || !tagList.length) {
    return { hits, done: goals.size === 0, scanned: 0, pages: 0 };
  }

  let scanned = 0, pages = 0;

  const ids = await Promise.all(tagList.map(getHashtagId));
  const pairs = tagList.map((t,i)=>({tag:t,id:ids[i]})).filter(p=>p.id);

  // 逐个 hashtag：先 top_media，再 recent_media；随时命中完就提前退出
  for (const {tag, id: hid} of pairs) {
    for (const edge of ["top_media", "recent_media"]) {
      let after = "", localScanned = 0, localPages = 0;

      while (goals.size > 0 && localScanned < maxScanPerTagPerEdge && localPages < hardPageCapPerTagPerEdge) {
        const p = await edgePage({ hashtagId: hid, edge, limit: per, after });
        const data = p.items || [];
        localScanned += data.length; localPages++;
        scanned += data.length; pages++;

        for (const m of data) {
          const id = String(m.id || "");
          if (!goals.has(id)) continue;

          hits.set(id, {
            id,
            media_type: m.media_type,
            media_url: m.media_url || "",
            thumbnail_url: null,
            caption: m.caption || "",
            permalink: m.permalink || "",
            timestamp: m.timestamp || "",
            username: m.username || "",
          });

          goals.delete(id);
          if (goals.size === 0) break;
        }

        if (goals.size === 0) break;
        after = p.nextAfter || "";
        if (!after) break;
      }

      if (goals.size === 0) break;
    }
    if (goals.size === 0) break;
  }

  return { hits, done: goals.size === 0, scanned, pages };
}