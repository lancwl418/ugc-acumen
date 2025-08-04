import { json } from "@remix-run/node";
import fs from "fs/promises";
import path from "path";

const token = process.env.INSTAGRAM_ACCESS_TOKEN;

const CACHE_FILE = path.resolve("public/cache_ugc.json");
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

async function fetchFreshData(visible) {
  const results = await Promise.all(
    visible.map(async (entry) => {
      const res = await fetch(
        `https://graph.facebook.com/v23.0/${entry.id}?fields=id,media_url,permalink,caption,media_type,timestamp&access_token=${token}`
      );
      const data = await res.json();
      // 合并 category 和 products
      return {
        ...data,
        category: entry.category || null,
        products: entry.products || [],
      };
    })
  );

  // 保存缓存
  const cacheData = {
    lastFetch: new Date().toISOString(),
    media: results,
  };
  await fs.writeFile(CACHE_FILE, JSON.stringify(cacheData, null, 2), "utf-8");

  return results;
}

export async function loader() {
  const visiblePath = path.resolve("public/visible.json");
  const visibleRaw = await fs.readFile(visiblePath, "utf-8");
  const visible = JSON.parse(visibleRaw);

  try {
    const cacheRaw = await fs.readFile(CACHE_FILE, "utf-8");
    const cache = JSON.parse(cacheRaw);
    const isFresh =
      Date.now() - new Date(cache.lastFetch).getTime() < CACHE_TTL;

    if (isFresh) {
      console.log("✅ Using cached UGC data");
      // 把 visible 的 category/products 合并到缓存 media
      const merged = cache.media.map((item) => {
        const extra = visible.find((v) => v.id === item.id);
        return {
          ...item,
          category: extra?.category || null,
          products: extra?.products || [],
        };
      });
      return json(
        { media: merged },
        {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          }
        }
      );
    }
  } catch (e) {
    console.log("⚠️ No cache or invalid cache, fetching fresh data...");
  }

  // 缓存过期或不存在
  const fresh = await fetchFreshData(visible);
  return json(
    { media: fresh },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      }
    }
  );
}
