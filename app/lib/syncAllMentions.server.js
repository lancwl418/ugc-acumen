// app/lib/syncAllMentions.server.js
// 从 Instagram API 拉全量 mentions，媒体上传 R2 creators/ 文件夹，保存到 all_mentions.json
import fs from "fs/promises";
import { ALL_MENTIONS_PATH, ensureAllMentionsFile } from "./persistPaths.js";
import { fetchTagUGCPage, fetchTagsWithComments } from "./fetchHashtagUGC.js";
import { r2PutObject } from "./r2Client.server.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const CDN_CONCURRENCY = 3;

/** 检查文件是否需要刷新（不存在、为空、或超过 1 天） */
async function isStale() {
  try {
    const stat = await fs.stat(ALL_MENTIONS_PATH);
    if (stat.size <= 4) return true;
    return Date.now() - stat.mtimeMs > DAY_MS;
  } catch {
    return true;
  }
}

/** 上传单条媒体到 R2 creators/ 文件夹 */
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

    const key = `creators/${entry.username || "unknown"}/${entry.id}.${ext}`;
    const cdnUrl = await r2PutObject(key, buf, ct);
    return { ...entry, media_url: cdnUrl, thumbnail_url: entry.thumbnail_url || cdnUrl };
  } catch (err) {
    console.error("[syncAllMentions] R2 upload failed:", entry.id, err?.message || err);
    return entry;
  }
}

/** 并发控制：最多同时 N 个任务 */
async function mapWithLimit(items, limit, fn) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/** 拉取全量 mentions 并持久化 */
async function fetchAndPersist(maxItems = 100) {
  console.log("[syncAllMentions] fetchAndPersist started, path:", ALL_MENTIONS_PATH);
  const all = [];
  let after = "";

  while (all.length < maxItems) {
    try {
      const page = await fetchTagUGCPage({ limit: 12, after });
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
  if (all.length === 0) return [];

  // 读取已有数据
  let existing = [];
  try {
    existing = JSON.parse(await fs.readFile(ALL_MENTIONS_PATH, "utf-8") || "[]");
  } catch {}

  const mergedById = new Map(existing.map((e) => [String(e.id), e]));
  const base = (process.env.CF_R2_PUBLIC_BASE || "").replace(/\/+$/, "");

  // 找出需要上传 CDN 的新条目
  const needCDN = [];
  for (const item of all) {
    const prev = mergedById.get(String(item.id));
    if (prev && prev.media_url && base && prev.media_url.startsWith(base + "/")) {
      // 已有 CDN URL，更新其他字段
      mergedById.set(String(item.id), { ...prev, ...item, media_url: prev.media_url, thumbnail_url: prev.thumbnail_url || prev.media_url });
    } else {
      needCDN.push(item);
    }
  }

  // 并发上传 CDN（限制 3 个同时）
  if (needCDN.length > 0) {
    console.log(`[syncAllMentions] uploading ${needCDN.length} items to R2 (concurrency: ${CDN_CONCURRENCY})`);
    const uploaded = await mapWithLimit(needCDN, CDN_CONCURRENCY, ensureOnCDN);
    for (const item of uploaded) {
      mergedById.set(String(item.id), item);
    }
  }

  // === 第二轮：用 fetchTagsWithComments (limit:3) 补充 comments ===
  const allIds = new Set([...mergedById.keys()]);
  const idsWithComments = new Set();
  // 跳过已有 comments 的条目
  for (const [id, item] of mergedById) {
    if (item.comments && item.comments.length > 0) idsWithComments.add(id);
  }
  const needComments = allIds.size - idsWithComments.size;
  if (needComments > 0) {
    console.log(`[syncAllMentions] fetching comments for ${needComments} posts (limit:3 per page)`);
    let cAfter = "";
    let cScanned = 0;
    const MAX_COMMENT_SCAN = 200;
    while (cScanned < MAX_COMMENT_SCAN && idsWithComments.size < allIds.size) {
      try {
        const cPage = await fetchTagsWithComments({ limit: 3, after: cAfter });
        if (!cPage.items || cPage.items.length === 0) break;
        for (const cItem of cPage.items) {
          const cId = String(cItem.id);
          if (allIds.has(cId) && !idsWithComments.has(cId)) {
            const prev = mergedById.get(cId);
            mergedById.set(cId, { ...prev, comments: cItem.comments || [] });
            idsWithComments.add(cId);
          }
        }
        cScanned += cPage.items.length;
        cAfter = cPage.nextAfter || "";
        if (!cAfter) break;
      } catch (err) {
        console.error("[syncAllMentions] fetchTagsWithComments error:", err?.message || err);
        break;
      }
    }
    console.log(`[syncAllMentions] comments enriched: ${idsWithComments.size}/${allIds.size}`);
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
    }
  }

  await ensureAllMentionsFile();
  try {
    return JSON.parse(await fs.readFile(ALL_MENTIONS_PATH, "utf-8") || "[]");
  } catch {
    return [];
  }
}

/** 强制刷新：清空文件后重新拉取 */
export async function forceRefresh() {
  console.log("[syncAllMentions] forceRefresh triggered");
  await ensureAllMentionsFile();
  await fs.writeFile(ALL_MENTIONS_PATH, "[]", "utf-8");
  return fetchAndPersist();
}
