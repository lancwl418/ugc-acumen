// app/lib/tagResolver.server.js
import fs from "fs/promises";
import { VISIBLE_TAG_PATH, ensureVisibleTagFile } from "./persistPaths.js";

const IG_USER_ID   = process.env.INSTAGRAM_IG_ID;        // 1784...
const USER_TOKEN   = process.env.INSTAGRAM_ACCESS_TOKEN; // User access token
const APP_ID       = process.env.META_APP_ID;
const APP_SECRET   = process.env.META_APP_SECRET;
const OEMBED_TOKEN = (APP_ID && APP_SECRET) ? `${APP_ID}|${APP_SECRET}` : null;

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
  };
}

/**
 * ✅ Graph for TAG — 用 mentioned_media.media_id() 精确拉取单条
 */
export async function fetchMentionedByMediaId(mediaId) {
  if (!IG_USER_ID || !USER_TOKEN) {
    throw Object.assign(new Error("Missing IG_USER_ID/USER_TOKEN"), { code: "NO_USER_TOKEN" });
  }
  // 组 fields
  const fields = [
    "id","caption","media_type","media_url","thumbnail_url",
    "permalink","timestamp","username",
    "children{media_type,media_url,thumbnail_url,id}"
  ].join(",");

  const url = new URL(`https://graph.facebook.com/v23.0/${IG_USER_ID}`);
  url.searchParams.set(
    "fields",
    `mentioned_media.media_id(${encodeURIComponent(mediaId)}){${fields}}`
  );
  url.searchParams.set("access_token", USER_TOKEN);

  const r = await fetch(url.toString());
  const j = await r.json();
  if (!r.ok || j?.error) {
    throw Object.assign(
      new Error(j?.error?.message || "Graph error"),
      { code: j?.error?.code || "GRAPH_ERROR" }
    );
  }

  // 返回结构：{ mentioned_media: { data: [ {...} ] } }
  const node = j?.mentioned_media?.data?.[0] || null;
  if (!node) throw Object.assign(new Error("Empty mentioned_media"), { code: "EMPTY" });
  return normalize(node);
}

/** oEmbed 兜底（可选） */
export async function fetchOEmbed(permalink) {
  if (!permalink || !OEMBED_TOKEN) throw Object.assign(new Error("NO_OEMBED"), { code: "NO_OEMBED" });
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
    id: "", media_url: j.thumbnail_url || "", thumbnail_url: j.thumbnail_url || "",
    media_type, caption: j.title || "", permalink, username: j.author_name || "",
  });
}

/** Admin 兜底 */
export function buildFromAdmin(entry) { return normalize(entry); }

/**
 * ✅ 单条兜底：Graph(mentioned_media.media_id) → oEmbed → Admin
 * entryOrId: 可传 {id, permalink, ...} 或纯 media_id
 */
export async function resolveOneTag(entryOrId, visibleList) {
  let base = {};
  if (typeof entryOrId === "string") {
    const list = visibleList || await safeReadVisible();
    base = list.find(x => String(x.id) === String(entryOrId)) || { id: entryOrId };
  } else {
    base = entryOrId || {};
  }

  // 1) Graph
  try {
    const g = await fetchMentionedByMediaId(base.id);
    if (g.media_url || g.thumbnail_url) {
      return normalize({ ...g, category: base.category, products: base.products });
    }
  } catch {}

  // 2) oEmbed
  try {
    if (base.permalink) {
      const e = await fetchOEmbed(base.permalink);
      if (e.media_url) return normalize({ ...e, id: base.id, category: base.category, products: base.products });
    }
  } catch {}

  // 3) Admin
  const admin = buildFromAdmin(base);
  if (admin.media_url) return admin;

  return null;
}

export async function resolveManyTag(entries, concurrency = 5) {
  const res = new Array(entries.length);
  let i = 0;
  async function worker() {
    while (i < entries.length) {
      const idx = i++;
      res[idx] = await resolveOneTag(entries[idx]).catch(() => null);
    }
  }
  await Promise.all(new Array(Math.min(entries.length, concurrency)).fill(0).map(worker));
  return res.filter(Boolean);
}
