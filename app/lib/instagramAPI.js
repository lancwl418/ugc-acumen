// app/lib/instagramAPI.js
// Instagram Graph API — mentions (/tags) 专用接口
import fetch from "node-fetch";

const IG_ID      = process.env.INSTAGRAM_IG_ID || "";
const USER_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || "";

/* ============== 缓存 + 并发限流 ============== */
const mem = new Map();
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

/* ====================== Mentions (/tags) 分页 ======================= */
export async function fetchTagUGCPage({ limit=12, after="" } = {}) {
  const key = `t:${limit}:${after}`;
  return withCache(key, 30_000, async () => {
    if (!IG_ID || !USER_TOKEN) return { items: [], nextAfter: "" };

    const u = new URL(`https://graph.facebook.com/v23.0/${IG_ID}/tags`);
    u.searchParams.set(
      "fields",
      "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,username,like_count,comments_count,children{media_type,media_url,thumbnail_url}"
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
        like_count: m.like_count ?? 0,
        comments_count: m.comments_count ?? 0,
      };
    });

    return { items, nextAfter: j?.paging?.cursors?.after || "" };
  });
}

/* ====================== /tags 带 comments edge ======================= */
export async function fetchTagsWithComments({ limit = 3, after = "" } = {}) {
  const key = `tc:${limit}:${after}`;
  return withCache(key, 30_000, async () => {
    if (!IG_ID || !USER_TOKEN) return { items: [], nextAfter: "" };

    const u = new URL(`https://graph.facebook.com/v23.0/${IG_ID}/tags`);
    u.searchParams.set(
      "fields",
      "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,username,like_count,comments_count,comments{id,text,username,timestamp},children{media_type,media_url,thumbnail_url}"
    );
    u.searchParams.set("limit", String(limit));
    if (after) u.searchParams.set("after", after);
    u.searchParams.set("access_token", USER_TOKEN);

    const r = await withLimit(() => fetch(u));
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
        like_count: m.like_count ?? 0,
        comments_count: m.comments_count ?? 0,
        comments: (m.comments?.data || []).map(c => ({
          id: c.id,
          text: c.text || "",
          username: c.username || "",
          timestamp: c.timestamp || "",
        })),
      };
    });

    return { items, nextAfter: j?.paging?.cursors?.after || "" };
  });
}

/* ======= refresh / scan stubs ======= */
export async function refreshMediaUrlByTag(entry, opts){ /* 原样保留 */ }
export async function scanTagsUntil(opts){ /* 原样保留 */ }
