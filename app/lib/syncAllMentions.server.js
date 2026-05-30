// app/lib/syncAllMentions.server.js
// 从 Instagram API 拉全量 mentions，媒体上传 R2 creators/ 文件夹，保存到 DB
import prisma from "../db.server.js";
import { fetchTagUGCPage, fetchTagsWithComments } from "./instagramAPI.js";
import { r2PutObject } from "./r2Client.server.js";
import { fetchAndStoreProfilePic } from "./instagramProfile.server.js";
import { updateProfilePic } from "./creatorLinks.server.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const CDN_CONCURRENCY = 3;

/** DB row → legacy snake_case 对象（保持消费者兼容） */
function mentionToLegacy(m) {
  return {
    id: m.id,
    username: m.username,
    timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
    media_type: m.mediaType,
    media_url: m.mediaUrl,
    thumbnail_url: m.thumbnailUrl || null,
    caption: m.caption || "",
    permalink: m.permalink,
    like_count: m.likeCount ?? 0,
    comments_count: m.commentsCount ?? 0,
    comments: (m.comments || []).map(c => ({
      id: c.id,
      text: c.text || "",
      username: c.username || "",
      timestamp: c.timestamp instanceof Date ? c.timestamp.toISOString() : c.timestamp,
    })),
  };
}

/** 检查是否需要刷新（无数据或超过 1 天） */
async function isStale() {
  const latest = await prisma.mention.findFirst({
    orderBy: { fetchedAt: "desc" },
    select: { fetchedAt: true },
  });
  if (!latest) return true;
  return Date.now() - latest.fetchedAt.getTime() > DAY_MS;
}

/** 下载远程 URL 并上传到 R2，返回公开 CDN url */
async function uploadToR2(url, keyNoExt, mediaTypeHint) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`fetch ${keyNoExt} failed: ${res.status}`);
  const ct = res.headers.get("content-type") || "application/octet-stream";
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = ct.includes("jpeg") ? "jpg"
    : ct.includes("png") ? "png"
    : ct.includes("webp") ? "webp"
    : ct.includes("gif") ? "gif"
    : ct.includes("mp4") ? "mp4"
    : (mediaTypeHint === "VIDEO" ? "mp4" : "jpg");
  return r2PutObject(`${keyNoExt}.${ext}`, buf, ct);
}

/** 把单条 mention 的媒体 + 缩略图都落到 R2 creators/ 文件夹 */
async function ensureOnCDN(entry) {
  const base = (process.env.CF_R2_PUBLIC_BASE || "").replace(/\/+$/, "");
  if (!base) return entry;
  const onR2 = (u) => !!(u && u.startsWith(base + "/"));

  const dir = `creators/${entry.username || "unknown"}`;
  const out = { ...entry };

  // 1) 主媒体 → R2（已在 R2 则跳过）
  if (out.media_url && !onR2(out.media_url)) {
    try {
      out.media_url = await uploadToR2(out.media_url, `${dir}/${entry.id}`, entry.media_type);
    } catch (err) {
      console.error("[syncAllMentions] R2 media upload failed:", entry.id, err?.message || err);
      return entry; // 主媒体失败则整条保持原样
    }
  }

  // 2) 缩略图 → R2。Instagram 缩略图会过期，绝不持久化非 R2 链接。
  //    图片：R2 主图即缩略图；视频：单独上传封面（sync 时封面还有效），失败则置空。
  if (entry.media_type === "VIDEO") {
    if (out.thumbnail_url && !onR2(out.thumbnail_url)) {
      try {
        out.thumbnail_url = await uploadToR2(out.thumbnail_url, `${dir}/${entry.id}-poster`, "IMAGE");
      } catch (err) {
        console.error("[syncAllMentions] R2 poster upload failed:", entry.id, err?.message || err);
        out.thumbnail_url = null;
      }
    }
  } else {
    out.thumbnail_url = onR2(out.thumbnail_url) ? out.thumbnail_url : out.media_url;
  }

  return out;
}

/** 并发控制 */
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

/** 拉取全量 mentions 并持久化到 DB */
async function fetchAndPersist(maxItems = 100) {
  console.log("[syncAllMentions] fetchAndPersist started");
  const all = [];
  let after = "";

  while (all.length < maxItems) {
    try {
      const page = await fetchTagUGCPage({ limit: 12, after });
      console.log(`[syncAllMentions] fetched page: ${page.items?.length || 0} items`);
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

  // 读取已有数据（检查 CDN URL）
  const existingRows = await prisma.mention.findMany({ select: { id: true, mediaUrl: true } });
  const existingMap = new Map(existingRows.map(r => [r.id, r.mediaUrl]));
  const base = (process.env.CF_R2_PUBLIC_BASE || "").replace(/\/+$/, "");

  // 媒体已在 R2 的条目复用旧 URL（ensureOnCDN 会据此跳过主媒体重传），但
  // 仍让每一条都走 ensureOnCDN —— 这样缩略图也会被归一化到 R2（Instagram
  // 缩略图会过期，不能每次 sync 又写回 Instagram 链接）。
  const prepared = all.map((item) => {
    const prevUrl = existingMap.get(String(item.id));
    return (prevUrl && base && prevUrl.startsWith(base + "/"))
      ? { ...item, media_url: prevUrl }
      : item;
  });

  console.log(`[syncAllMentions] normalizing ${prepared.length} items onto R2`);
  const merged = await mapWithLimit(prepared, CDN_CONCURRENCY, ensureOnCDN);

  // Upsert 到 Mention 表
  const nowISO = new Date();
  for (const item of merged) {
    await prisma.mention.upsert({
      where: { id: String(item.id) },
      update: {
        username: item.username || "",
        timestamp: new Date(item.timestamp || 0),
        mediaType: item.media_type || "IMAGE",
        mediaUrl: item.media_url || "",
        thumbnailUrl: item.thumbnail_url || null,
        caption: item.caption || "",
        permalink: item.permalink || "",
        likeCount: item.like_count ?? 0,
        commentsCount: item.comments_count ?? 0,
        fetchedAt: nowISO,
      },
      create: {
        id: String(item.id),
        username: item.username || "",
        timestamp: new Date(item.timestamp || 0),
        mediaType: item.media_type || "IMAGE",
        mediaUrl: item.media_url || "",
        thumbnailUrl: item.thumbnail_url || null,
        caption: item.caption || "",
        permalink: item.permalink || "",
        likeCount: item.like_count ?? 0,
        commentsCount: item.comments_count ?? 0,
        fetchedAt: nowISO,
      },
    });
  }

  // === 第二轮：用 fetchTagsWithComments 补充 comments ===
  const allIds = new Set(merged.map(m => String(m.id)));
  const withComments = await prisma.comment.findMany({
    select: { mentionId: true },
    distinct: ["mentionId"],
  });
  const idsWithComments = new Set(withComments.map(c => c.mentionId));
  const needComments = allIds.size - idsWithComments.size;

  if (needComments > 0) {
    console.log(`[syncAllMentions] fetching comments for ${needComments} posts`);
    let cAfter = "";
    let cScanned = 0;
    const MAX_COMMENT_SCAN = 200;
    while (cScanned < MAX_COMMENT_SCAN && idsWithComments.size < allIds.size) {
      try {
        const cPage = await fetchTagsWithComments({ limit: 3, after: cAfter });
        if (!cPage.items || cPage.items.length === 0) break;
        for (const cItem of cPage.items) {
          const cId = String(cItem.id);
          if (allIds.has(cId) && !idsWithComments.has(cId) && cItem.comments?.length > 0) {
            for (const c of cItem.comments) {
              await prisma.comment.upsert({
                where: { id: String(c.id) },
                update: { text: c.text || "", username: c.username || "", timestamp: new Date(c.timestamp || 0) },
                create: {
                  id: String(c.id),
                  mentionId: cId,
                  text: c.text || "",
                  username: c.username || "",
                  timestamp: new Date(c.timestamp || 0),
                },
              });
            }
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

  // === 第三轮：自动抓取新 creator 的 profile pic ===
  const allUsernames = [...new Set(merged.map(m => m.username).filter(Boolean))];
  const existingLinks = await prisma.creatorLink.findMany({
    where: { username: { in: allUsernames } },
    select: { username: true, profilePicUrl: true },
  });
  const hasProfilePic = new Set(existingLinks.filter(l => l.profilePicUrl).map(l => l.username));
  const needProfilePic = allUsernames.filter(u => !hasProfilePic.has(u));

  if (needProfilePic.length > 0) {
    console.log(`[syncAllMentions] fetching profile pics for ${needProfilePic.length} creators`);
    for (const username of needProfilePic) {
      try {
        const cdnUrl = await fetchAndStoreProfilePic(username);
        if (cdnUrl) {
          await updateProfilePic(username, cdnUrl);
          console.log(`[syncAllMentions] profile pic saved for @${username}`);
        }
      } catch (err) {
        console.error(`[syncAllMentions] profile pic failed for @${username}:`, err?.message || err);
      }
    }
  }

  // 返回全部数据
  const result = await prisma.mention.findMany({
    include: { comments: true },
    orderBy: { timestamp: "desc" },
  });
  console.log(`[syncAllMentions] DB updated: ${result.length} items`);
  return result.map(mentionToLegacy);
}

/**
 * 获取全量 mentions 数据。
 * DB 为空或超过 1 天自动刷新，否则读 DB。
 */
export async function getAllMentions() {
  const stale = await isStale();
  console.log(`[syncAllMentions] getAllMentions called, stale: ${stale}`);
  if (stale) {
    try {
      return await fetchAndPersist();
    } catch (err) {
      console.error("[syncAllMentions] fetchAndPersist failed:", err?.message || err, err?.stack);
    }
  }

  const rows = await prisma.mention.findMany({
    include: { comments: true },
    orderBy: { timestamp: "desc" },
  });
  return rows.map(mentionToLegacy);
}

/** 强制刷新：重新拉取 */
export async function forceRefresh() {
  console.log("[syncAllMentions] forceRefresh triggered");
  return fetchAndPersist();
}
