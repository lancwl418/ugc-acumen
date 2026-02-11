// app/lib/syncAllMentions.server.js
// 从 Instagram API 拉全量 mentions，媒体上传 R2，保存到 all_mentions.json
import fs from "fs/promises";
import { ALL_MENTIONS_PATH, ensureAllMentionsFile } from "./persistPaths.js";
import { fetchTagUGCPage } from "./fetchHashtagUGC.js";
import { r2PutObject } from "./r2Client.server.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 检查文件是否需要刷新（不存在、为空、或超过 1 天） */
async function isStale() {
  try {
    const stat = await fs.stat(ALL_MENTIONS_PATH);
    if (stat.size <= 4) return true; // 空文件或只有 "[]"
    return Date.now() - stat.mtimeMs > DAY_MS;
  } catch {
    return true; // 文件不存在
  }
}

/** 上传单条媒体到 R2，返回更新后的 entry */
async function ensureOnCDN(entry) {
  const base = (process.env.CF_R2_PUBLIC_BASE || "").replace(/\/+$/, "");
  if (!base) return entry;
  if (entry.media_url && entry.media_url.startsWith(base + "/")) return entry;
  if (!entry.media_url) return entry;

  try {
    const res = await fetch(entry.media_url, { redirect: "follow" });
    if (!res.ok) return entry;
    const ct = res.headers.get("content-type") || "application/octet-stream";
    const buf = Buffer.from(await res.arrayBuffer());

    const ext = (() => {
      if (ct.includes("jpeg")) return "jpg";
      if (ct.includes("png")) return "png";
      if (ct.includes("webp")) return "webp";
      if (ct.includes("mp4")) return "mp4";
      return entry.media_type === "VIDEO" ? "mp4" : "jpg";
    })();

    const key = `mentions/${entry.username || "author"}/${entry.id}.${ext}`;
    const cdnUrl = await r2PutObject(key, buf, ct);
    return { ...entry, media_url: cdnUrl, thumbnail_url: entry.thumbnail_url || cdnUrl };
  } catch (err) {
    console.error("R2 upload failed for", entry.id, err?.message || err);
    return entry;
  }
}

/** 拉取全量 mentions 并持久化 */
async function fetchAndPersist(maxItems = 500) {
  console.log("[syncAllMentions] fetchAndPersist started, ALL_MENTIONS_PATH:", ALL_MENTIONS_PATH);
  const all = [];
  let after = "";

  while (all.length < maxItems) {
    try {
      const page = await fetchTagUGCPage({ limit: 50, after });
      console.log(`[syncAllMentions] fetched page: ${page.items?.length || 0} items, nextAfter: ${page.nextAfter ? "yes" : "no"}`);
      if (!page.items || page.items.length === 0) break;
      all.push(...page.items);
      after = page.nextAfter || "";
      if (!after) break;
    } catch (err) {
      console.error("[syncAllMentions] fetchTagUGCPage error:", err?.message || err);
      break;
    }
  }

  console.log(`[syncAllMentions] total fetched from API: ${all.length}`);

  // 读取已有数据，保留已上传到 CDN 的 URL
  let existing = [];
  try {
    existing = JSON.parse(await fs.readFile(ALL_MENTIONS_PATH, "utf-8") || "[]");
  } catch {}
  const existingById = new Map(existing.map((e) => [String(e.id), e]));

  // 合并：新数据更新已有条目，老数据保留（只增不减）
  const base = (process.env.CF_R2_PUBLIC_BASE || "").replace(/\/+$/, "");
  const mergedById = new Map(existing.map((e) => [String(e.id), e]));

  for (const item of all) {
    const prev = mergedById.get(String(item.id));
    if (prev && prev.media_url && base && prev.media_url.startsWith(base + "/")) {
      // 已有 CDN URL，保留，更新其他字段
      mergedById.set(String(item.id), { ...item, media_url: prev.media_url, thumbnail_url: prev.thumbnail_url || prev.media_url });
    } else {
      // 新条目或需要上传到 CDN
      mergedById.set(String(item.id), await ensureOnCDN(item));
    }
  }

  const merged = Array.from(mergedById.values())
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

  await ensureAllMentionsFile();
  await fs.writeFile(ALL_MENTIONS_PATH, JSON.stringify(merged, null, 2), "utf-8");
  console.log(`✅ all_mentions.json updated: ${merged.length} items`);
  return merged;
}

/**
 * 获取全量 mentions 数据。
 * 文件不存在或超过 1 天自动刷新，否则读本地 JSON。
 */
export async function getAllMentions() {
  const stale = await isStale();
  console.log(`[syncAllMentions] getAllMentions called, stale: ${stale}, path: ${ALL_MENTIONS_PATH}`);
  if (stale) {
    try {
      return await fetchAndPersist();
    } catch (err) {
      console.error("[syncAllMentions] fetchAndPersist failed:", err?.message || err, err?.stack);
      // 降级：尝试读旧数据
    }
  }

  await ensureAllMentionsFile();
  try {
    return JSON.parse(await fs.readFile(ALL_MENTIONS_PATH, "utf-8") || "[]");
  } catch {
    return [];
  }
}
