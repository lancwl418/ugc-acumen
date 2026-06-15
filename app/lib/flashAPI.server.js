// app/lib/flashAPI.server.js
// FlashAPI (RapidAPI flashapi1) 客户端 —— Instagram 数据抓取。
// 取代 Instagram Graph API 用于 mentions(被标记的帖子)与 creator 头像。
//
// 接口：
//   GET /ig/user_id/?user=<username>            → { id }            用户名 → 数字 pk
//   GET /ig/info_username/?user=<username>       → { user: {...} }   资料 / 头像
//   GET /ig/tagged/?id_user=<pk>&end_cursor=     → { items, ... }    被标记的帖子(mentions)
//   GET /ig/comments/?shortcode=<code>&sort=     → { comments }      单帖评论

const HOST = process.env.RAPIDAPI_HOST || "flashapi1.p.rapidapi.com";
const KEY  = process.env.RAPIDAPI_KEY  || ""; // 必须由环境变量提供，无硬编码 fallback

// 品牌账号：被顾客 @标记 的官方账号。pk 是 Instagram 私有 API 的数字 id，
// 与 Graph 的 INSTAGRAM_IG_ID(商业账号 id)不是同一个数。
const BRAND_USERNAME = process.env.INSTAGRAM_USERNAME || "acumencamera";
const BRAND_PK       = process.env.INSTAGRAM_USER_PK  || "12064862121";

const FETCH_TIMEOUT = 15_000; // 单次请求超时
const MIN_INTERVAL  = 1200;   // 两次请求最小间隔(provider 有每秒限流)
const MAX_RETRIES   = 3;

/* ===================== 内存缓存 ===================== */
const mem = new Map();
export function withCache(key, ms, fn) {
  const now = Date.now();
  const hit = mem.get(key);
  if (hit && hit.expiry > now) return hit.promise;
  const p = (async () => await fn())();
  p.catch(() => mem.delete(key)); // 失败的 promise 不缓存
  mem.set(key, { expiry: now + ms, promise: p });
  return p;
}

/* ============ 串行限流器：保证调用间隔 ≥ MIN_INTERVAL ============ */
let chain = Promise.resolve();
let lastAt = 0;
function schedule(fn) {
  const run = chain.then(async () => {
    const wait = MIN_INTERVAL - (Date.now() - lastAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try { return await fn(); }
    finally { lastAt = Date.now(); }
  });
  chain = run.catch(() => {});
  return run;
}

function fetchWithTimeout(url, opts = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT);
  return fetch(url, { ...opts, signal: ac.signal }).finally(() => clearTimeout(timer));
}

/* ===================== 底层 GET（限流 + 429 重试） ===================== */
export async function flashGet(path, params = {}) {
  if (!KEY) throw new Error("[flashAPI] missing RAPIDAPI_KEY");
  const u = new URL(`https://${HOST}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  }

  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const r = await schedule(() =>
        fetchWithTimeout(u, { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY } })
      );
      if (r.status === 429) {
        lastErr = new Error("FlashAPI 429 rate limited");
        await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
        continue;
      }
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message || `FlashAPI ${r.status}`);
      return j;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
      }
    }
  }
  throw lastErr || new Error("FlashAPI request failed");
}

/* ===================== username → pk（带缓存） ===================== */
const idCache = new Map();
export async function resolveUserId(username = BRAND_USERNAME) {
  if (username === BRAND_USERNAME && BRAND_PK) return BRAND_PK;
  if (idCache.has(username)) return idCache.get(username);
  const j = await flashGet("/ig/user_id/", { user: username });
  const id = j?.id ? String(j.id) : "";
  if (id) idCache.set(username, id);
  return id;
}

/* ===================== 媒体字段归一化 ===================== */
const MEDIA_TYPE = { 1: "IMAGE", 2: "VIDEO", 8: "CAROUSEL_ALBUM" };

function mediaUrls(node) {
  const img = node?.image_versions2?.candidates?.[0]?.url || "";
  const vid = node?.video_versions?.[0]?.url || "";
  return { img, vid };
}

/**
 * 把 /ig/tagged/ 的原始 item 归一化成项目内通用的 legacy snake_case 结构。
 * CAROUSEL 取第一张子媒体（与旧 Graph 逻辑一致）。
 */
export function normalizeTaggedItem(it) {
  let typeCode = it.media_type; // 1=IMAGE 2=VIDEO 8=CAROUSEL
  let node = it;
  if (typeCode === 8 && Array.isArray(it.carousel_media) && it.carousel_media.length) {
    node = it.carousel_media[0];
    typeCode = node.media_type; // 摊平为首张子媒体的类型
  }
  const { img, vid } = mediaUrls(node);
  const isVideo = typeCode === 2;
  const code = it.code || "";
  return {
    id: String(it.pk || it.id || ""),
    media_url: isVideo ? (vid || img) : img,
    thumbnail_url: img || null,
    media_type: MEDIA_TYPE[typeCode] || "IMAGE",
    caption: it.caption?.text || "",
    permalink: code ? `https://www.instagram.com/p/${code}/` : "",
    timestamp: it.taken_at ? new Date(it.taken_at * 1000).toISOString() : "",
    username: it.user?.username || "",
    like_count: it.like_count ?? 0,
    comments_count: it.comment_count ?? 0,
  };
}
