// app/lib/shopifyProducts.server.js
// 从 Shopify Admin API 拉取指定分类（Shopify 标准产品分类 / taxonomy category）
// 的产品，同步到 Product 表。Product 表同时给后台的「Linked Products」选择器
// 和前台 widget（/api-products）使用。
import prisma from "../db.server.js";
import { unauthenticated } from "../shopify.server.js";

export const PRODUCT_CATEGORY =
  process.env.UGC_PRODUCT_CATEGORY || "Dash Video Cameras";

/** 把 Shopify 库抛出的 Response / Error 统一转成可读文本 */
export function describeError(err) {
  if (err instanceof Response) return `Shopify auth error (HTTP ${err.status}). Try reopening the app from Shopify admin.`;
  return err?.message || String(err);
}

const SYNC_TTL = 10 * 60 * 1000; // 同一进程内最多每 10 分钟自动同步一次
let lastSyncAt = 0;

async function getShopDomain() {
  if (process.env.SHOPIFY_SHOP) return process.env.SHOPIFY_SHOP;
  const s = await prisma.session.findFirst({
    where: { isOnline: false },
    orderBy: { id: "asc" },
  });
  return s?.shop || "";
}

const QUERY = `#graphql
  query UgcProducts($after: String) {
    shop { primaryDomain { url } }
    products(first: 100, after: $after, sortKey: TITLE) {
      pageInfo { hasNextPage endCursor }
      nodes {
        handle
        title
        status
        onlineStoreUrl
        category { name fullName }
        featuredImage { url }
        priceRangeV2 { minVariantPrice { amount } }
      }
    }
  }
`;

function matchesCategory(p, want) {
  const name = (p.category?.name || "").trim().toLowerCase();
  const full = (p.category?.fullName || "").trim().toLowerCase();
  return name === want || full === want || full.endsWith("> " + want);
}

/** 拉取 Shopify 上属于指定分类、状态为 ACTIVE 的产品，返回 Product 表结构。 */
export async function fetchCategoryProducts(admin, category = PRODUCT_CATEGORY) {
  const want = category.trim().toLowerCase();
  const all = [];
  let storeUrl = "";
  let after = null;
  do {
    const res = await admin.graphql(QUERY, { variables: { after } });
    const body = await res.json();
    if (body.errors?.length) {
      throw new Error(body.errors.map((e) => e.message).join("; "));
    }
    storeUrl = body.data?.shop?.primaryDomain?.url || storeUrl;
    const conn = body.data?.products;
    all.push(...(conn?.nodes || []));
    after = conn?.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (after);

  const base = (storeUrl || "").replace(/\/+$/, "");
  return all
    .filter((p) => p.status === "ACTIVE" && matchesCategory(p, want))
    .map((p) => ({
      handle: p.handle,
      title: p.title,
      image: p.featuredImage?.url || null,
      link: p.onlineStoreUrl || (base ? `${base}/products/${p.handle}` : null),
      price: Number(p.priceRangeV2?.minVariantPrice?.amount || 0),
    }));
}

/**
 * 同步分类产品到 Product 表（全量替换）。
 * - 默认带 TTL，页面加载时调用不会每次都打 Shopify。
 * - 分类下一个产品都匹配不到时不清空旧数据，避免分类名写错把表清空。
 */
export async function syncProducts({ force = false } = {}) {
  if (!force && Date.now() - lastSyncAt < SYNC_TTL) {
    return { synced: false, products: await prisma.product.findMany({ orderBy: { title: "asc" } }) };
  }

  const shop = await getShopDomain();
  if (!shop) throw new Error("No Shopify offline session found. Reinstall / reopen the app once.");

  const { admin } = await unauthenticated.admin(shop);
  const list = await fetchCategoryProducts(admin, PRODUCT_CATEGORY);
  if (list.length === 0) {
    throw new Error(
      `No ACTIVE products found in Shopify category "${PRODUCT_CATEGORY}". Check the category name on the products.`
    );
  }

  await prisma.$transaction([
    prisma.product.deleteMany({ where: { handle: { notIn: list.map((p) => p.handle) } } }),
    ...list.map((p) =>
      prisma.product.upsert({ where: { handle: p.handle }, update: p, create: p })
    ),
  ]);
  lastSyncAt = Date.now();
  return { synced: true, products: list };
}
