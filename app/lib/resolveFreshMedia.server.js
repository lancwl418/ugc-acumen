// 本地 KV + 文件落盘缓存；失效后用 Graph 拉新
import fs from "fs/promises";

const IG_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || process.env.PAGE_TOKEN; // 二选一
const CACHE_FILE = "tmp/ig_media_cache.json";

let mem = new Map();
let loaded = false;

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf-8");
    const obj = JSON.parse(raw);
    mem = new Map(Object.entries(obj));
  } catch {
    // 首次无缓存文件时忽略
  }
}

async function persist() {
  const obj = Object.fromEntries(mem);
  await fs.mkdir("tmp", { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(obj), "utf-8");
}

/**
 * @param {string} id  Instagram 媒体 ID
 * @param {"thumb"|"raw"} type
 * @returns {Promise<{url: string}>}
 */
export async function getFreshMediaUrl(id, type = "thumb") {
  await load();
  const now = Date.now();
  const cached = mem.get(id);

  if (cached && now < cached.expiresAt && cached[type]) {
    return { url: cached[type] };
  }

  if (!IG_TOKEN) throw new Error("Missing INSTAGRAM_ACCESS_TOKEN or PAGE_TOKEN");

  const fields =
    "id,media_type,media_url,thumbnail_url,permalink,children{media_type,media_url,thumbnail_url,id}";
  const api = `https://graph.facebook.com/v23.0/${id}?fields=${encodeURIComponent(
    fields
  )}&access_token=${encodeURIComponent(IG_TOKEN)}`;

  const res = await fetch(api);
  const j = await res.json();
  if (!res.ok || !j) throw new Error(JSON.stringify(j || {}));

  const raw = j.media_url || j.thumbnail_url || "";
  const thumb = j.thumbnail_url || raw;

  // 常见 1h 级别 CDN 有效期，这里保守 55min，避免边界抖动
  const ttlMs = 55 * 60 * 1000;

  const record = { raw, thumb, expiresAt: now + ttlMs };
  mem.set(id, record);
  persist().catch(() => {});

  return { url: type === "raw" ? record.raw : record.thumb };
}
