// 临时 API — 导入 mentions + visible 数据，用完后删除此文件和 import_data.json
import { json } from "@remix-run/node";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import prisma from "../db.server.js";

function loadData() {
  const dir = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(dir, "../lib/import_data.json"), "utf-8");
  return JSON.parse(raw);
}

export async function loader() {
  const data = loadData();
  return json({ mentionCount: data.mentions.length, visibleCount: data.visible.length });
}

export async function action() {
  const data = loadData();
  const results = { mentionsImported: 0, visibleImported: 0, commentsImported: 0 };

  // 1. Import all 124 mentions
  for (const m of data.mentions) {
    await prisma.mention.upsert({
      where: { id: m.id },
      update: {
        username: m.username,
        timestamp: new Date(m.timestamp),
        mediaType: m.media_type,
        mediaUrl: m.media_url,
        thumbnailUrl: m.thumbnail_url || null,
        caption: m.caption || "",
        permalink: m.permalink,
        likeCount: m.like_count ?? 0,
        commentsCount: m.comments_count ?? 0,
      },
      create: {
        id: m.id,
        username: m.username,
        timestamp: new Date(m.timestamp),
        mediaType: m.media_type,
        mediaUrl: m.media_url,
        thumbnailUrl: m.thumbnail_url || null,
        caption: m.caption || "",
        permalink: m.permalink,
        likeCount: m.like_count ?? 0,
        commentsCount: m.comments_count ?? 0,
      },
    });
    results.mentionsImported++;

    // Import comments
    for (const c of (m.comments || [])) {
      await prisma.comment.upsert({
        where: { id: String(c.id) },
        update: { text: c.text || "", username: c.username || "", timestamp: new Date(c.timestamp) },
        create: {
          id: String(c.id),
          mentionId: m.id,
          text: c.text || "",
          username: c.username || "",
          timestamp: new Date(c.timestamp),
        },
      });
      results.commentsImported++;
    }
  }

  // 2. Import 23 visible mentions
  for (const v of data.visible) {
    await prisma.visibleMention.upsert({
      where: { id: v.id },
      update: {
        category: v.category,
        products: JSON.stringify(v.products),
      },
      create: {
        id: v.id,
        username: v.username,
        timestamp: new Date(v.timestamp),
        mediaType: v.media_type,
        mediaUrl: v.media_url,
        thumbnailUrl: v.thumbnail_url || null,
        caption: v.caption || "",
        permalink: v.permalink,
        category: v.category,
        products: JSON.stringify(v.products),
        likeCount: v.like_count ?? 0,
        commentsCount: v.comments_count ?? 0,
      },
    });
    results.visibleImported++;
  }

  return json({ ok: true, ...results });
}
