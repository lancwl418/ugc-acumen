// app/lib/visibleMentions.js
// VisibleMention 表 CRUD — 替代 visible_tag_ugc.json
import prisma from "../db.server.js";

/** 查所有产品 */
export async function getProducts() {
  return prisma.product.findMany();
}

/** DB row → API snake_case 对象 */
export function toAPI(vm) {
  return {
    id: vm.id,
    username: vm.username,
    timestamp: vm.timestamp instanceof Date ? vm.timestamp.toISOString() : vm.timestamp,
    media_type: vm.mediaType,
    media_url: vm.mediaUrl,
    thumbnail_url: vm.thumbnailUrl || null,
    caption: vm.caption || "",
    permalink: vm.permalink,
    category: vm.category,
    products: JSON.parse(vm.products || "[]"),
    featured: vm.featured,
    featuredAt: vm.featuredAt ? (vm.featuredAt instanceof Date ? vm.featuredAt.toISOString() : vm.featuredAt) : null,
    lastRefreshedAt: vm.lastRefreshedAt ? (vm.lastRefreshedAt instanceof Date ? vm.lastRefreshedAt.toISOString() : vm.lastRefreshedAt) : null,
    lastRefreshError: vm.lastRefreshError || null,
    like_count: vm.likeCount ?? 0,
    comments_count: vm.commentsCount ?? 0,
  };
}

/** API snake_case 对象 → Prisma data */
export function fromAPI(obj) {
  return {
    id: String(obj.id),
    username: obj.username || "",
    timestamp: new Date(obj.timestamp || 0),
    mediaType: obj.media_type || "IMAGE",
    mediaUrl: obj.media_url || "",
    thumbnailUrl: obj.thumbnail_url || null,
    caption: obj.caption || "",
    permalink: obj.permalink || "",
    category: obj.category || "camping",
    products: JSON.stringify(Array.isArray(obj.products) ? obj.products : []),
    featured: !!obj.featured,
    featuredAt: obj.featuredAt ? new Date(obj.featuredAt) : null,
    lastRefreshedAt: obj.lastRefreshedAt ? new Date(obj.lastRefreshedAt) : null,
    lastRefreshError: obj.lastRefreshError || null,
    likeCount: obj.like_count ?? 0,
    commentsCount: obj.comments_count ?? 0,
  };
}

/** 查全部 — featured 优先 + 时间倒序 */
export async function getAllVisible() {
  const rows = await prisma.visibleMention.findMany({
    orderBy: [{ featured: "desc" }, { timestamp: "desc" }],
  });
  return rows.map(toAPI);
}

/** 按分类过滤 */
export async function getVisibleByCategory(category) {
  const rows = await prisma.visibleMention.findMany({
    where: { category },
    orderBy: [{ featured: "desc" }, { timestamp: "desc" }],
  });
  return rows.map(toAPI);
}

/** 分页查询 */
export async function getVisiblePaged({ category, limit, offset } = {}) {
  const where = category ? { category } : {};
  const [rows, total] = await Promise.all([
    prisma.visibleMention.findMany({
      where,
      orderBy: [{ featured: "desc" }, { timestamp: "desc" }],
      skip: offset || 0,
      ...(limit > 0 ? { take: limit } : {}),
    }),
    prisma.visibleMention.count({ where }),
  ]);
  return { items: rows.map(toAPI), total };
}

/** 单条查询 */
export async function getVisibleById(id) {
  const row = await prisma.visibleMention.findUnique({ where: { id: String(id) } });
  return row ? toAPI(row) : null;
}

/** 计数 */
export async function getVisibleCount() {
  return prisma.visibleMention.count();
}

/** 单条 upsert */
export async function upsertVisible(entry) {
  const data = fromAPI(entry);
  const { id, ...rest } = data;
  return prisma.visibleMention.upsert({
    where: { id },
    update: rest,
    create: data,
  });
}

/** 批量 upsert（事务） */
export async function upsertManyVisible(entries) {
  return prisma.$transaction(
    entries.map((e) => {
      const data = fromAPI(e);
      const { id, ...rest } = data;
      return prisma.visibleMention.upsert({
        where: { id },
        update: rest,
        create: data,
      });
    })
  );
}

/** 全量替换（事务） */
export async function replaceAllVisible(entries) {
  return prisma.$transaction([
    prisma.visibleMention.deleteMany(),
    ...entries.map((e) => {
      const data = fromAPI(e);
      return prisma.visibleMention.create({ data });
    }),
  ]);
}
