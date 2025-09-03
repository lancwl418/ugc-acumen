// app/lib/ugcResolverTag.server.js
import fs from "fs/promises";
import { VISIBLE_TAG_PATH, ensureVisibleTagFile } from "./persistPaths.js";

const PAGE_TOKEN   = process.env.PAGE_TOKEN;
const APP_ID       = process.env.META_APP_ID;
const APP_SECRET   = process.env.META_APP_SECRET;
const OEMBED_TOKEN = (APP_ID && APP_SECRET) ? `${APP_ID}|${APP_SECRET}` : null;

// ---- helpers ----
async function safeReadVisible() {
  await ensureVisibleTagFile();
  try {
    const raw = await fs.readFile(VISIBLE_TAG_PATH, "utf-8");
    return JSON.parse(raw || "[]");
  } catch {
    return [];
  }
}

function normalize(o = {}) {
  return {
    id: String(o.id || ""),
    media_url: o.media_url || o.thumbnail_url || "",
    thumbnail_url: o.thumbnail_url || null,
    media_type: o.media_type || "IMAGE",
    caption: o.caption || "",
    permalink: o.permalink || "",
    timestamp: o.timestamp || "",
    username: o.username || "",
    category: o.category ?? null,
    products: Array.isArray(o.products) ? o.products : [],
    // ✅ 保持 children 继续透传（如果 admin 也写了）
    children: Array.isArray(o.children) ? o.children : [],
  };
}

// ---- Graph by media_id ----
export async function fetchGraphById(id) {
  if (!PAGE_TOKEN) throw Object.assign(new Error("No PAGE_TOKEN"), { code: "NO_PAGE_TOKEN" });

  // ✅ 多加 children，便于相册还原
  const fields = "id,media_url,thumbnail_url,media_type,caption,permalink,timestamp,username,children{media_type,media_url,thumbnail_url,id}";
  const r = await fetch(`https://graph.facebook.com/v23.0/${id}?fields=${fields}&access_token=${PAGE_TOKEN}`);
  const j = await r.json();
  if (!r.ok || j?.error) throw Object.assign(new Error(j?.error?.message || "Graph error"), { code: j?.error?.code || "GRAPH_ERROR" });
  return normalize({
    ...j,
    children: Array.isArray(j.children?.data)
      ? j.children.data.map(c => ({
          id: c.id,
          media_type: c.media_type,
          media_url: c.media_url || "",
          thumbnail_url: c.thumbnail_url || null,
        }))
      : [],
  });
}

// ---- oEmbed ----
export async function fetchOEmbed(permalink) {
  if (!permalink) throw Object.assign(new Error("Missing permalink"), { code: "NO_PERMALINK" });
  if (!OEMBED_TOKEN) throw Object.assign(new Error("No APP token for oEmbed"), { code: "NO_OEMBED_TOKEN" });

  const u = new URL("https://graph.facebook.com/v23.0/instagram_oembed");
  u.searchParams.set("url", permalink);
  u.searchParams.set("access_token", OEMBED_TOKEN);
  u.searchParams.set("omitscript", "true");
  u.searchParams.set("hidecaption", "false");
  u.searchParams.set("maxwidth", "640");

  const r = await fetch(u.toString());
  const j = await r.json();
  if (!r.ok || j?.error) throw Object.assign(new Error(j?.error?.message || "oEmbed error"), { code: j?.error?.code || "OEMBED_ERROR" });

  const media_type = j.html && /<video/i.test(j.html) ? "VIDEO" : "IMAGE";
  return normalize({
    id: "",
    media_url: j.thumbnail_url || "",
    thumbnail_url: j.thumbnail_url || "",
    media_type,
    caption: j.title || "",
    permalink,
    username: j.author_name || "",
  });
}

// ---- Admin fallback ----
export function buildFromAdmin(entry) {
  return normalize(entry);
}

// ---- 单条兜底：Graph -> oEmbed -> Admin ----
export async function resolveOne(entryOrId, visibleList) {
  let base = {};
  if (typeof entryOrId === "string") {
    const list = visibleList || await safeReadVisible();
    base = list.find(x => String(x.id) === String(entryOrId)) || { id: entryOrId };
  } else {
    base = entryOrId || {};
  }

  try {
    const g = await fetchGraphById(base.id);
    if (g.media_url || g.thumbnail_url) {
      return normalize({ ...g, category: base.category, products: base.products });
    }
  } catch (_) {}

  try {
    if (base.permalink) {
      const e = await fetchOEmbed(base.permalink);
      if (e.media_url) {
        return normalize({ ...e, id: base.id, category: base.category, products: base.products });
      }
    }
  } catch (_) {}

  const admin = buildFromAdmin(base);
  if (admin.media_url) return admin;

  return null;
}

// ---- 批量并发 ----
export async function resolveMany(entries, concurrency = 5) {
  const res = new Array(entries.length);
  let i = 0;
  async function worker() {
    while (i < entries.length) {
      const idx = i++;
      res[idx] = await resolveOne(entries[idx]).catch(() => null);
    }
  }
  await Promise.all(new Array(Math.min(entries.length, concurrency)).fill(0).map(worker));
  return res.filter(Boolean);
}
