// app/lib/ugcResolver.server.js
// 只读 Admin/visible，不再访问 Graph / oEmbed。

import fs from "fs/promises";
import { VISIBLE_HASHTAG_PATH, ensureVisibleHashtagFile } from "./persistPaths.js";

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

// ------- Admin only -------
export function buildFromAdmin(entry = {}) {
  return normalize(entry);
}

/**
 * 只读 visible 的单条解析：
 * - 入参可为 entry 对象或纯 id 字符串
 * - 不做任何外部请求
 */
export async function resolveOne(entryOrId, visibleList) {
  let base = {};
  if (typeof entryOrId === "string") {
    const list = visibleList || await safeReadVisible();
    base = list.find(x => String(x.id) === String(entryOrId)) || { id: entryOrId };
  } else {
    base = entryOrId || {};
  }
  const admin = buildFromAdmin(base);
  return admin.media_url ? admin : null;
}

/**
 * 只读 visible 的批量解析（保持与旧签名一致）
 */
export async function resolveMany(entries = [], _concurrency = 5) {
  const list = Array.isArray(entries) ? entries : [];
  const out = [];
  for (const it of list) {
    const item = await resolveOne(it).catch(() => null);
    if (item) out.push(item);
  }
  return out;
}

/* =================== 停用的外部兜底（保留空壳/注释，防误用） ===================

// Graph by media_id — DISABLED
export async function fetchGraphById() {
  throw Object.assign(new Error("Graph disabled"), { code: "GRAPH_DISABLED" });
}

// oEmbed by permalink — DISABLED
export async function fetchOEmbed() {
  throw Object.assign(new Error("oEmbed disabled"), { code: "OEMBED_DISABLED" });
}

*/