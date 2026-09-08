// app/lib/visibleSave.server.js
// Shared server logic for saving curated UGC (VisibleMention): form-entry
// parsing, R2 upload, and the single-item save/remove used by the per-card
// buttons on both the Mentions and Visible UGC admin pages.
import { r2PutObject } from "./r2Client.server.js";
import { getVisibleById, upsertVisible, deleteVisible } from "./visibleMentions.js";

const R2_BASE = (process.env.CF_R2_PUBLIC_BASE || "").replace(/\/+$/, "");
const onR2 = (u) => !!(R2_BASE && u && u.startsWith(R2_BASE + "/"));

/** 表单里的 ugc_entry JSON → 规范化 entry */
export function parseEntry(raw) {
  const e = typeof raw === "string" ? JSON.parse(raw) : raw || {};
  return {
    id: String(e.id),
    category: e.category || "driving",
    products: Array.isArray(e.products) ? e.products : [],
    username: e.username || "",
    timestamp: e.timestamp || "",
    media_type: e.media_type || "IMAGE",
    media_url: e.media_url || "",
    thumbnail_url: e.thumbnail_url || "",
    caption: e.caption || "",
    permalink: e.permalink || "",
    featured: !!e.featured,
  };
}

// Download a remote URL and put it on R2; returns the public CDN url.
async function fetchToR2(url, keyNoExt, mediaTypeHint) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`fetch ${keyNoExt} failed: ${res.status}`);
  const ct = res.headers.get("content-type") || "application/octet-stream";
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = ct.includes("jpeg") ? "jpg"
    : ct.includes("png") ? "png"
    : ct.includes("webp") ? "webp"
    : ct.includes("gif") ? "gif"
    : ct.includes("mp4") ? "mp4"
    : (mediaTypeHint === "VIDEO" ? "mp4" : "bin");
  return r2PutObject(`${keyNoExt}.${ext}`, buf, ct);
}

/** 确保 media / thumbnail 都在 R2 上（已在 R2 的跳过）。 */
export async function ensureOnCDN(e) {
  const dir = `mentions/${e.username || "author"}`;
  const out = { ...e };

  // 1) Main media → R2 (skip if already there).
  if (out.media_url && !onR2(out.media_url)) {
    out.media_url = await fetchToR2(out.media_url, `${dir}/${e.id}`, e.media_type);
  }

  // 2) Thumbnail → R2. Instagram thumbnail URLs expire, so never persist a
  //    non-R2 thumbnail. For images the R2 media doubles as the thumbnail;
  //    for videos upload the poster separately, dropping it if it's dead.
  if (e.media_type === "VIDEO") {
    if (out.thumbnail_url && !onR2(out.thumbnail_url)) {
      try {
        out.thumbnail_url = await fetchToR2(out.thumbnail_url, `${dir}/${e.id}-poster`, "IMAGE");
      } catch (err) {
        console.error("R2 poster upload failed:", e.id, err?.message || err);
        out.thumbnail_url = null;
      }
    }
  } else {
    out.thumbnail_url = onR2(out.thumbnail_url) ? out.thumbnail_url : out.media_url;
  }

  return out;
}

/**
 * 单条保存 / 下架。
 * - visible=false → 从 VisibleMention 删除
 * - visible=true  → 上传 R2 后与已有记录合并 upsert（首次 featured 时写 featuredAt）
 * 返回可直接 json() 的结果对象。
 */
export async function saveVisibleOne({ entry, visible = true }) {
  const e = parseEntry(entry);
  if (!e.id || e.id === "undefined") return { ok: false, op: "saveOne", error: "Missing entry id" };
  try {
    if (!visible) {
      const removed = await deleteVisible(e.id);
      return { ok: true, op: "saveOne", id: e.id, visible: false, removed };
    }
    const prev = await getVisibleById(e.id);
    // Merge over the stored row so partial edits (e.g. from the Visible UGC
    // page, which only sends category/products/featured) keep the rest.
    let merged = { ...(prev || {}), ...e };
    if (prev) {
      for (const k of ["username", "timestamp", "media_type", "media_url", "thumbnail_url", "caption", "permalink"]) {
        if (!e[k]) merged[k] = prev[k];
      }
    }
    try { merged = await ensureOnCDN(merged); }
    catch (err) { console.error("R2 upload failed:", e.id, err?.message || err); }
    const becameFeatured = !prev?.featured && merged.featured;
    await upsertVisible({
      ...merged,
      ...(becameFeatured ? { featuredAt: new Date().toISOString() } : {}),
    });
    return { ok: true, op: "saveOne", id: e.id, visible: true };
  } catch (err) {
    return { ok: false, op: "saveOne", id: e.id, error: err?.message || String(err) };
  }
}
