// 依据 source 选择刷新策略：
// - hashtag: 只能用 oEmbed(permalink) + 本地池兜底（不能打 /{media-id}）
// - tag:     优先 mentioned_media.media_id()，失败再 oEmbed，再本地池；都失败给占位图

import fs from "fs/promises";

const IG_USER_ID = process.env.INSTAGRAM_IG_ID || "";          // 1784...
const USER_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || "";    // 用户令牌（必需用于 mentioned_media）
const PAGE_TOKEN = process.env.PAGE_TOKEN || "";                // 供其它场景备用（此处不用 /media-id）
const APP_ID = process.env.META_APP_ID || "";
const APP_SECRET = process.env.META_APP_SECRET || "";
const OEMBED_TOKEN = APP_ID && APP_SECRET ? `${APP_ID}|${APP_SECRET}` : "";

const CACHE_FILE = "tmp/ig_media_cache.json";
const FALLBACK_IMG = "/static/ugc-fallback.png"; // 放一张占位图

let mem = new Map();               // Map<mediaId, {raw,thumb,expiresAt}>
let inflight = new Map();          // 去抖：Map<cacheKey, Promise>

async function load() {
  if (mem.size) return;
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf-8");
    mem = new Map(Object.entries(JSON.parse(raw)));
  } catch {}
}
async function persist() {
  await fs.mkdir("tmp", { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(Object.fromEntries(mem)), "utf-8");
}

async function fetchOEmbedThumb(permalink) {
  if (!permalink || !OEMBED_TOKEN) throw new Error("NO_OEMBED");
  const u = new URL("https://graph.facebook.com/v23.0/instagram_oembed");
  u.searchParams.set("url", permalink);
  u.searchParams.set("access_token", OEMBED_TOKEN);
  u.searchParams.set("omitscript", "true");
  u.searchParams.set("hidecaption", "true");
  u.searchParams.set("maxwidth", "640");
  const r = await fetch(u.toString());
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.error) throw new Error(j?.error?.message || `oEmbed ${r.status}`);
  const thumb = j.thumbnail_url || "";
  return { raw: thumb, thumb };
}

// 只用于 tag（mentions）：/v23.0/{ig-user-id}?fields=mentioned_media.media_id(ID){...}
async function fetchMentionedMediaMinimal(mediaId) {
  if (!IG_USER_ID || !USER_TOKEN) throw new Error("NO_MENTION_TOKEN");
  const fieldsInner = "id,media_type,media_url,thumbnail_url";
  const u = new URL(`https://graph.facebook.com/v23.0/${IG_USER_ID}`);
  u.searchParams.set(
    "fields",
    `mentioned_media.media_id(${encodeURIComponent(mediaId)}){${fieldsInner}}`
  );
  u.searchParams.set("access_token", USER_TOKEN);
  const r = await fetch(u.toString());
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.error) {
    const msg = j?.error?.message || `Graph ${r.status}`;
    const code = j?.error?.code || r.status || "GRAPH_ERROR";
    throw Object.assign(new Error(msg), { code });
  }
  const node = j?.mentioned_media?.data?.[0] || {};
  const raw = node.media_url || node.thumbnail_url || "";
  const thumb = node.thumbnail_url || node.media_url || "";
  if (!raw && !thumb) throw new Error("MENTION_EMPTY");
  return { raw, thumb };
}

async function findLocalById(id) {
  const files = [
    "public/hashtag_ugc.json",
    "public/tag_ugc.json",
    // 需要可继续追加其它数据池
  ];
  for (const f of files) {
    try {
      const raw = await fs.readFile(f, "utf-8");
      const arr = JSON.parse(raw || "[]");
      const hit = arr.find((x) => String(x.id) === String(id));
      if (hit) return hit;
    } catch {}
  }
  return null;
}

/**
 * 获取媒体可用直链（带多级兜底）
 * @param {{id:string,type:'raw'|'thumb',source:'hashtag'|'tag',permalink?:string}} opts
 */
export async function getFreshMediaUrl(opts) {
  await load();
  const { id, type = "thumb", source = "hashtag", permalink = "" } = opts || {};
  const cacheKey = `${id}:${type}:${source}`;
  const now = Date.now();

  // 命中缓存
  const cached = mem.get(id);
  if (cached && now < cached.expiresAt && cached[type]) {
    return { url: cached[type] };
  }

  // 去抖：相同 id+source 的并发请求复用
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);

  const p = (async () => {
    try {
      let raw = "";
      let thumb = "";

      if (source === "tag") {
        // ✅ mentions：用 mentioned_media.media_id()
        ({ raw, thumb } = await fetchMentionedMediaMinimal(id));
      } else {
        // ✅ hashtag：不能用 /{media-id}，只能走 oEmbed
        ({ raw, thumb } = await fetchOEmbedThumb(permalink));
      }

      const ttlMs = 55 * 60 * 1000;
      const rec = { raw, thumb, expiresAt: now + ttlMs };
      mem.set(id, rec);
      persist().catch(() => {});
      return { url: type === "raw" ? rec.raw : rec.thumb };
    } catch (e) {
      // 降级：本地池
      try {
        const local = await findLocalById(id);
        if (local) {
          const raw = local.media_url || local.thumbnail_url || "";
          const thumb = local.thumbnail_url || raw || "";
          if (raw || thumb) {
            const ttlMs = 10 * 60 * 1000;
            const rec = { raw, thumb, expiresAt: now + ttlMs };
            mem.set(id, rec);
            persist().catch(() => {});
            return { url: type === "raw" ? rec.raw : rec.thumb };
          }
        }
      } catch {}

      // 最后：占位图，保证不 500
      return { url: FALLBACK_IMG };
    }
  })().finally(() => {
    inflight.delete(cacheKey);
  });

  inflight.set(cacheKey, p);
  return p;
}
