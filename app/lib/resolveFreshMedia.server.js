// app/lib/resolveFreshMedia.server.js
// 依据 source 选择刷新策略：
// - hashtag: 只能用 oEmbed(permalink) + 本地池兜底
// - tag:     优先 mentioned_media.media_id()，失败再 oEmbed，再本地池；都失败给 data URI 占位

// ✅ 这里不再写任何磁盘缓存文件，不需要新建 tmp/ 或 json 文件
//    一切走进程内内存 Map；重启/热更会自然清空。

const IG_USER_ID = process.env.INSTAGRAM_IG_ID || "";
const USER_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || "";
const APP_ID     = process.env.META_APP_ID || "";
const APP_SECRET = process.env.META_APP_SECRET || "";
const OEMBED_TOKEN = (APP_ID && APP_SECRET) ? `${APP_ID}|${APP_SECRET}` : "";

// 透明 1×1 PNG（极小），用于“万不得已”的兜底；不依赖 public 文件
const TINY_PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";

// 进程内缓存：Map<mediaId, { raw, thumb, expiresAt }>
const mem = new Map();
// 并发去抖：Map<cacheKey, Promise>
const inflight = new Map();

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
  if (!thumb) throw new Error("OEMBED_EMPTY");
  // oEmbed 拿不到原图，这里原样用 thumb
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
  const node  = j?.mentioned_media?.data?.[0] || {};
  const raw   = node.media_url || node.thumbnail_url || "";
  const thumb = node.thumbnail_url || node.media_url || "";
  if (!raw && !thumb) throw new Error("MENTION_EMPTY");
  return { raw, thumb };
}

async function findLocalById(id) {
  const files = ["public/hashtag_ugc.json", "public/tag_ugc.json"];
  for (const f of files) {
    try {
      const txt = await (await import("fs/promises")).readFile(f, "utf-8");
      const arr = JSON.parse(txt || "[]");
      const hit = arr.find((x) => String(x.id) === String(id));
      if (hit) return hit;
    } catch {}
  }
  return null;
}

/**
 * 获取媒体可用直链（带多级兜底）
 * @param {{id:string,type:'raw'|'thumb',source:'hashtag'|'tag',permalink?:string}} opts
 * @returns {Promise<{url: string}>} url 可能是 http(s) 或 data URI
 */
export async function getFreshMediaUrl(opts) {
  const { id, type = "thumb", source = "hashtag", permalink = "" } = opts || {};
  const now = Date.now();
  const cacheKey = `${id}:${type}:${source}`;

  // 先看缓存
  const hit = mem.get(id);
  if (hit && now < hit.expiresAt && hit[type]) {
    return { url: hit[type] };
  }

  // 去抖
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);

  const p = (async () => {
    try {
      let raw = "", thumb = "";

      if (source === "tag") {
        // ✅ mentions：精确 media
        ({ raw, thumb } = await fetchMentionedMediaMinimal(id));
      } else {
        // ✅ hashtag：只能 oEmbed（permalink）
        ({ raw, thumb } = await fetchOEmbedThumb(permalink));
      }

      const ttlMs = 55 * 60 * 1000; // 55 min
      const rec = { raw, thumb, expiresAt: now + ttlMs };
      mem.set(id, rec);
      return { url: type === "raw" ? rec.raw : rec.thumb };
    } catch {
      // 降级 1：本地池
      try {
        const local = await findLocalById(id);
        if (local) {
          const raw = local.media_url || local.thumbnail_url || "";
          const thumb = local.thumbnail_url || raw || "";
          if (raw || thumb) {
            const rec = { raw, thumb, expiresAt: now + 10 * 60 * 1000 };
            mem.set(id, rec);
            return { url: type === "raw" ? rec.raw : rec.thumb };
          }
        }
      } catch {}

      // 降级 2：data URI 占位（绝不 500/404）
      return { url: TINY_PNG_DATA_URI };
    }
  })().finally(() => inflight.delete(cacheKey));

  inflight.set(cacheKey, p);
  return p;
}
