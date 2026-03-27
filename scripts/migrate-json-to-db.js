// scripts/migrate-json-to-db.js
// 一次性脚本：将 JSON 文件数据导入 Prisma SQLite 数据库
import { PrismaClient } from "@prisma/client";
import fs from "fs/promises";
import path from "path";

const prisma = new PrismaClient();

async function readJSON(file) {
  for (const p of [file, path.resolve("public", file), path.resolve("public/data", file)]) {
    try {
      const raw = await fs.readFile(p, "utf-8");
      const data = JSON.parse(raw);
      console.log(`  Read ${p} (${Array.isArray(data) ? data.length + " items" : typeof data})`);
      return data;
    } catch {}
  }
  return null;
}

async function migrateProducts() {
  console.log("\n--- Products ---");
  const products = await readJSON("products.json");
  if (!Array.isArray(products) || products.length === 0) {
    console.log("  Skipped: no products data");
    return;
  }
  let count = 0;
  for (const p of products) {
    if (!p.handle) continue;
    await prisma.product.upsert({
      where: { handle: p.handle },
      update: { title: p.title || "", image: p.image || null, link: p.link || null, price: p.price ?? 0 },
      create: { handle: p.handle, title: p.title || "", image: p.image || null, link: p.link || null, price: p.price ?? 0 },
    });
    count++;
  }
  console.log(`  Migrated ${count} products`);
}

async function migrateVisibleMentions() {
  console.log("\n--- Visible Mentions ---");
  const visible = await readJSON("visible_tag_ugc.json");
  if (!Array.isArray(visible) || visible.length === 0) {
    console.log("  Skipped: no visible mentions data");
    return;
  }
  let count = 0;
  for (const v of visible) {
    if (!v.id) continue;
    const data = {
      id: String(v.id),
      username: v.username || "",
      timestamp: new Date(v.timestamp || 0),
      mediaType: v.media_type || "IMAGE",
      mediaUrl: v.media_url || "",
      thumbnailUrl: v.thumbnail_url || null,
      caption: v.caption || "",
      permalink: v.permalink || "",
      category: v.category || "camping",
      products: JSON.stringify(Array.isArray(v.products) ? v.products : []),
      featured: !!v.featured,
      featuredAt: v.featuredAt ? new Date(v.featuredAt) : null,
      lastRefreshedAt: v.lastRefreshedAt ? new Date(v.lastRefreshedAt) : null,
      lastRefreshError: v.lastRefreshError || null,
      likeCount: v.like_count ?? 0,
      commentsCount: v.comments_count ?? 0,
    };
    const { id, ...rest } = data;
    await prisma.visibleMention.upsert({
      where: { id },
      update: rest,
      create: data,
    });
    count++;
  }
  console.log(`  Migrated ${count} visible mentions`);
}

async function migrateAllMentions() {
  console.log("\n--- All Mentions ---");
  const mentions = await readJSON("all_mentions.json");
  if (!Array.isArray(mentions) || mentions.length === 0) {
    console.log("  Skipped: no all_mentions data");
    return;
  }
  let mentionCount = 0;
  let commentCount = 0;
  for (const m of mentions) {
    if (!m.id) continue;
    const data = {
      id: String(m.id),
      username: m.username || "",
      timestamp: new Date(m.timestamp || 0),
      mediaType: m.media_type || "IMAGE",
      mediaUrl: m.media_url || "",
      thumbnailUrl: m.thumbnail_url || null,
      caption: m.caption || "",
      permalink: m.permalink || "",
      likeCount: m.like_count ?? 0,
      commentsCount: m.comments_count ?? 0,
    };
    const { id, ...rest } = data;
    await prisma.mention.upsert({
      where: { id },
      update: rest,
      create: data,
    });
    mentionCount++;

    for (const c of (m.comments || [])) {
      if (!c.id) continue;
      await prisma.comment.upsert({
        where: { id: String(c.id) },
        update: { text: c.text || "", username: c.username || "", timestamp: new Date(c.timestamp || 0) },
        create: {
          id: String(c.id),
          mentionId: String(m.id),
          text: c.text || "",
          username: c.username || "",
          timestamp: new Date(c.timestamp || 0),
        },
      });
      commentCount++;
    }
  }
  console.log(`  Migrated ${mentionCount} mentions, ${commentCount} comments`);
}

async function migrateCreatorLinks() {
  console.log("\n--- Creator Links ---");
  const links = await readJSON("creator_links.json");
  if (!links || typeof links !== "object" || Array.isArray(links)) {
    console.log("  Skipped: no creator_links data");
    return;
  }
  let count = 0;
  for (const [username, data] of Object.entries(links)) {
    if (!username || !data.customerId) continue;
    await prisma.creatorLink.upsert({
      where: { username },
      update: {
        customerId: data.customerId,
        displayName: data.displayName || null,
        email: data.email || null,
      },
      create: {
        username,
        customerId: data.customerId,
        displayName: data.displayName || null,
        email: data.email || null,
        linkedAt: data.linkedAt ? new Date(data.linkedAt) : new Date(),
      },
    });
    count++;
  }
  console.log(`  Migrated ${count} creator links`);
}

async function main() {
  console.log("=== JSON → DB Migration ===");
  await migrateProducts();
  await migrateVisibleMentions();
  await migrateAllMentions();
  await migrateCreatorLinks();
  console.log("\n=== Migration complete ===");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
