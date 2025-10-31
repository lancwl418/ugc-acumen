import fetch from "node-fetch";

/** 环境变量 */
const IG_ID      = process.env.INSTAGRAM_IG_ID || "";         // IG Business 用户ID（数字）
const PAGE_TOKEN = process.env.PAGE_TOKEN || "";               // hashtag edges
const USER_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || "";   // /tags & mentioned_media
const APP_ID     = process.env.META_APP_ID || "";
const APP_SECRET = process.env.META_APP_SECRET || "";
const OEMBED     = (APP_ID && APP_SECRET) ? `${APP_ID}|${APP_SECRET}` : "";
const DEFAULT_TAGS = (process.env.HASHTAGS || process.env.HASHTAG || "acumencamera");

const DEBUG = String(process.env.DEBUG_UGC || "") === "1";

/* ============== 轻量缓存 + 并发限流 ============== */
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

/** 统一把 after/next URL 解析成游标 */
function normalizeAfter(v) {
  const s = String(v || "");
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) {
    try { const u = new URL(s); return u.searchParams.get("after") || ""; }
    catch { return ""; }
  }
  return s;
}

/** ✅ 支持 after 或直接传 Graph 的 paging.next URL */
async function edgePage({
  hashtagId,
  edge = "top_media",
  limit = 10,
  after = "",
  nextUrl = ""
}){
  let r, j;

  if (nextUrl) {
    r = await withLimit(() => fetch(nextUrl));
  } else {
    const u = new URL(`https://graph.facebook.com/v23.0/${hashtagId}/${edge}`);
    u.searchParams.set("user_id", IG_ID);
    // 注意：hashtag edge 不支持 username 字段
    u.searchParams.set("fields", "id,caption,media_type,media_url,permalink,timestamp");
    u.searchParams.set("limit", String(limit));
    if (after) u.searchParams.set("after", after);
    u.searchParams.set("access_token", PAGE_TOKEN);
    r = await withLimit(()=>fetch(u));
  }

  j = await r.json();
  if (!r.ok || j?.error) throw new Error(j?.error?.message || `Graph ${r.status}`);

  return {
    items: j.data || [],
    nextAfter: j?.paging?.cursors?.after || "",
    nextUrl: j?.paging?.next || ""
  };
}

/** ✅ Hashtag 分页（多标签合并，时间排序 + 去重 + 游标耗尽标记） */
export async function fetchHashtagUGCPage({ tags=DEFAULT_TAGS, limit=12, cursors={} } = {}) {
  const key = `h:${JSON.stringify({tags,limit,cursors})}`;
  return withCache(key, 10_000, async () => { // 调试期把缓存降到 10s
    if (!IG_ID || !PAGE_TOKEN) return { items: [], nextCursors: {} };
    const list = Array.isArray(tags) ? tags : parseTags(tags);
    if (!list.length) return { items: [], nextCursors: {} };

    const ids = await Promise.all(list.map(getHashtagId));
    const pairs = list.map((t,i)=>({tag:t,id:ids[i]})).filter(p=>p.id);

    const perPerTag = Math.max(3, Math.ceil(limit / Math.max(1,pairs.length)));
    const bucket = []; const next = {};
    const seen = new Set(); // 去重

    await Promise.all(pairs.map(async ({tag,id})=>{
      const prev = cursors?.[tag] || {};
      const topDone = !!prev.topDone;
      const recDone = !!prev.recentDone;

      // 当前轮的配额：若某 edge 已完成，把配额全部给另一侧
      const qTop = topDone ? 0 : (recDone ? perPerTag : Math.max(2, Math.ceil(perPerTag/2)));
      const qRec = recDone ? 0 : (topDone ? perPerTag : Math.max(2, Math.ceil(perPerTag/2)));

      const topNextUrl = String(prev.topNext || "");
      const recNextUrl = String(prev.recentNext || "");
      const topAfter   = normalizeAfter(prev.topAfter || prev.topNext || "");
      const recAfter   = normalizeAfter(prev.recentAfter || prev.recentNext || "");

      let top = { items: [], nextAfter: "", nextUrl: "" };
      let rec = { items: [], nextAfter: "", nextUrl: "" };

      if (qTop > 0) {
        top = await edgePage({
          hashtagId:id, edge:"top_media", limit:qTop,
          nextUrl: topNextUrl || "", after: topNextUrl ? "" : topAfter
        });
      }
      if (qRec > 0) {
        rec = await edgePage({
          hashtagId:id, edge:"recent_media", limit:qRec,
          nextUrl: recNextUrl || "", after: recNextUrl ? "" : recAfter
        });
      }

      (top.items||[]).forEach(x=>x.__hashtag=tag);
      (rec.items||[]).forEach(x=>x.__hashtag=tag);

      for (const it of [...(top.items||[]), ...(rec.items||[])]) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        bucket.push(it);
      }

      // 计算“是否已耗尽”
      const topNoMore = !top.nextAfter && !top.nextUrl && qTop > 0;
      const recNoMore = !rec.nextAfter && !rec.nextUrl && qRec > 0;

      next[tag] = {
        topAfter: top.nextAfter || "",      topNext: top.nextUrl || "",
        recentAfter: rec.nextAfter || "",   recentNext: rec.nextUrl || "",
        topDone: topDone || topNoMore,
        recentDone: recDone || recNoMore,
      };

      if (DEBUG) {
        console.log(`[UGC] tag=${tag} qTop=${qTop} qRec=${qRec}`,
          { inTopAfter: topAfter, inTopNext: topNextUrl, inRecAfter: recAfter, inRecNext: recNextUrl,
            outTopAfter: top.nextAfter, outTopNext: top.nextUrl,
            outRecAfter: rec.nextAfter, outRecNext: rec.nextUrl,
            topDone: next[tag].topDone, recentDone: next[tag].recentDone,
            pageSize: (top.items?.length||0) + (rec.items?.length||0)
          });
      }
    }));

    const items = bucket
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
        username: "",              // hashtag edge 不返回 username
        hashtag: m.__hashtag || "",
      }));

    if (DEBUG) {
      console.log(`[UGC] merge out: items=${items.length}`, {
        first: items[0]?.id, last: items[items.length-1]?.id, nextKeys: Object.keys(next)
      });
    }

    return { items, nextCursors: next, pageSize: limit, tags };
  });
}

/* ====================== Mentions (/tags) 分页 ======================= */
export async function fetchTagUGCPage({ limit=12, after="" } = {}) {
  const key = `t:${limit}:${after}`;
  return withCache(key, 10_000, async () => {
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
        m.media_url  = f.media_url  || m.media_url;
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
/* ========== /tags 单条刷新（命中为止） =============================== */
export async function refreshMediaUrlByTag(entry, {
  per = 50, maxScan = 5000, hardPageCap = 200, retry = 3, retryBaseMs = 500,
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
      const transient = j?.error?.code === 4 || j?.error?.code === 17 || j?.error?.code === 32 || r.status >= 500;
      if (r.ok && !j?.error) break;
      if (k < retry && transient) {
        const backoff = retryBaseMs * Math.pow(2, k);
        await new Promise((res) => setTimeout(res, backoff));
        continue;
      }
      return entry;
    }

    const data = Array.isArray(j?.data) ? j.data : [];
    scanned += data.length; pageCount++;

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

  return entry;
}

/* ==================================================================== */
/* ========== Hashtag 单条刷新（保留） ================================= */
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
      scanned += (p.items || []).length;
      pages++;

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
/* ========== 仅当“没有可用媒体”时才补一次 ============================= */
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
/* ========== 批量扫描（/tags & hashtags） ============================ */
export async function scanTagsUntil({
  targetIds, per = 50, maxScan = 10000, hardPageCap = 300, retry = 3, retryBaseMs = 500,
} = {}) {
  if (!IG_ID || !USER_TOKEN) return { hits: new Map(), scanned: 0, pages: 0, done: true };

  const goals = new Set(Array.isArray(targetIds) ? targetIds.map(String) : Array.from(targetIds).map(String));
  const hits = new Map();
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
    scanned += data.length; pages++;

    for (const m of data) {
      const id = String(m.id || "");
      if (!goals.has(id)) continue;

      if (m.media_type === "CAROUSEL_ALBUM" && m.children?.data?.length) {
        const f = m.children.data[0];
        m.media_type    = f.media_type || m.media_type;
        m.media_url     = f.media_url  || m.media_url;
        m.thumbnail_url = f.thumbnail_url || m.thumbnail_url || m.media_url;
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
      if (goals.size === 0) break;
    }

    if (goals.size === 0) break;
    after = j?.paging?.cursors?.after || "";
    if (!after) break;
  }

  const done = goals.size === 0 || !after;
  return { hits, scanned, pages, done };
}

export async function scanHashtagsUntil({
  tags = DEFAULT_TAGS, targetIds, per = 50,
  maxScanPerTagPerEdge = 6000, hardPageCapPerTagPerEdge = 200,
} = {}) {
  const tagList = Array.isArray(tags) ? tags : parseTags(tags);
  const goals = new Set(Array.isArray(targetIds) ? targetIds.map(String) : Array.from(targetIds).map(String));
  const hits = new Map();

  if (!IG_ID || !PAGE_TOKEN || !tagList.length) {
    return { hits, done: goals.size === 0, scanned: 0, pages: 0 };
  }

  let scanned = 0, pages = 0;
  const ids = await Promise.all(tagList.map(getHashtagId));
  const pairs = tagList.map((t,i)=>({tag:t,id:ids[i]})).filter(p=>p.id);

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
