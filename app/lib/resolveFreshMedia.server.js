// app/lib/resolveFreshMedia.server.js
const IG_USER_ID   = process.env.INSTAGRAM_IG_ID || "";
const USER_TOKEN   = process.env.INSTAGRAM_ACCESS_TOKEN || "";
const APP_ID       = process.env.META_APP_ID || "";
const APP_SECRET   = process.env.META_APP_SECRET || "";
const OEMBED_TOKEN = (APP_ID && APP_SECRET) ? `${APP_ID}|${APP_SECRET}` : "";

// 极小 1x1 PNG（data URI 兜底，不依赖任何静态文件）
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";

// 进程内缓存：Map<mediaId, { raw, thumb, expiresAt }>
const mem = new Map();
// 去抖相同请求：Map<cacheKey, Promise>
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
  return { raw: thumb, thumb };
}

async function fetchMentionedMediaMinimal(mediaId) {
  if (!IG_USER_ID || !USER_TOKEN) throw new Error("NO_MENTION_TOKEN");
  const fields = "id,media_type,media_url,thumbnail_url";
  const u = new URL(`https://graph.facebook.com/v23.0/${IG_USER_ID}`);
  u.searchParams.set("fields", `mentioned_media.media_id(${encodeURIComponent(mediaId)}){${fields}}`);
  u.searchParams.set("access_token", USER_TOKEN);
  const r = await fetch(u.toString());
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.error) throw new Error(j?.error?.message || `Graph ${r.status}`);
  const n = j?.mentioned_media?.data?.[0] || {};
  const raw = n.media_url || n.thumbnail_url || "";
  const thumb = n.thumbnail_url || n.media_url || "";
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

/** 获取媒体可用直链或 data URI（带多级兜底） */
export async function getFreshMediaUrl({ id, type = "thumb", source = "hashtag", permalink = "" }) {
  const now = Date.now();
  const key = `${id}:${type}:${source}`;

  const cached = mem.get(id);
  if (cached && now < cached.expiresAt && cached[type]) return { url: cached[type] };
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    try {
      let raw = "", thumb = "";
      if (source === "tag") ({ raw, thumb } = await fetchMentionedMediaMinimal(id));
      else ({ raw, thumb } = await fetchOEmbedThumb(permalink));

      const rec = { raw, thumb, expiresAt: now + 55 * 60 * 1000 };
      mem.set(id, rec);
      return { url: type === "raw" ? rec.raw : rec.thumb };
    } catch {
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
      return { url: TINY_PNG };
    }
  })().finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p;
}
