// app/lib/ugcResolver.server.js
import fs from "fs/promises";
import { VISIBLE_HASHTAG_PATH, ensureVisibleHashtagFile } from "./persistPaths.js";

const PAGE_TOKEN   = process.env.PAGE_TOKEN;
const APP_ID       = process.env.META_APP_ID;
const APP_SECRET   = process.env.META_APP_SECRET;
const OEMBED_TOKEN = (APP_ID && APP_SECRET) ? `${APP_ID}|${APP_SECRET}` : null;

// ------- helpers -------
async function safeReadVisible() {
  await ensureVisibleHashtagFile();
  try {
    const raw = await fs.readFile(VISIBLE_HASHTAG_PATH, "utf-8");
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
  };
}

// ------- Graph by media_id -------
export async function fetchGraphById(id, fields) {
  if (!PAGE_TOKEN) throw Object.assign(new Error("No PAGE_TOKEN"), { code: "NO_PAGE_TOKEN" });
  const f = fields || "id,media_url,thumbnail_url,media_type,caption,permalink,timestamp,username";
  const r = await fetch(`https://graph.facebook.com/v23.0/${id}?fields=${f}&access_token=${PAGE_TOKEN}`);
  const j = await r.json();
  if (!r.ok || j?.error) throw Object.assign(new Error(j?.error?.message || "Graph error"), { code: j?.error?.code || "GRAPH_ERROR" });
  return normalize(j);
}

// ------- oEmbed by permalink (APP_ID|APP_SECRET) -------
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

  // html 仅用于 iframe 场景；这里主要取 thumbnail_url + author_name + title
  const media_type = j.html && /<video/i.test(j.html) ? "VIDEO" : "IMAGE";
  return normalize({
    id: "", // oEmbed 不给 media_id
    media_url: j.thumbnail_url || "",
    thumbnail_url: j.thumbnail_url || "",
    media_type,
    caption: j.title || "",
    permalink,
    username: j.author_name || "",
  });
}

// ------- Admin fallback -------
export function buildFromAdmin(entry) {
  // entry 来自 visible_hashtag.json（admin 勾选时已写入更多字段的话，这里会带出来）
  return normalize(entry);
}

// ------- 单条兜底：Graph -> oEmbed -> Admin -------
export async function resolveOne(entryOrId, visibleList) {
  // entryOrId：可以是 “可见清单里的条目对象” 或 “纯字符串 ID”
  let base = {};
  if (typeof entryOrId === "string") {
    // 如果只传了 id，则到本地清单里捞出它（用于 /api-ugc-media-detail）
    const list = visibleList || await safeReadVisible();
    base = list.find(x => String(x.id) === String(entryOrId)) || { id: entryOrId };
  } else {
    base = entryOrId || {};
  }

  // 1) Graph
  try {
    const g = await fetchGraphById(base.id);
    if (g.media_url || g.thumbnail_url) {
      // 合并 admin 的分类/产品等信息
      return normalize({ ...g, category: base.category, products: base.products });
    }
  } catch (err) {
    // 不中断，落下去
  }

  // 2) oEmbed
  try {
    if (base.permalink) {
      const e = await fetchOEmbed(base.permalink);
      if (e.media_url) {
        return normalize({ ...e, id: base.id, category: base.category, products: base.products });
      }
    }
  } catch (err) {
    // 不中断，落下去
  }

  // 3) Admin
  const admin = buildFromAdmin(base);
  if (admin.media_url) return admin;

  // 三重都失败：返回 null
  return null;
}

// ------- 批量并发 -------
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
