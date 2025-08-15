// app/routes/api.hashtag-ugc.jsx
import { json } from "@remix-run/node";
import fs from "fs/promises";
import {
  VISIBLE_HASHTAG_PATH,
  ensureVisibleHashtagFile,
} from "../lib/persistPaths.js";

const token = process.env.INSTAGRAM_ACCESS_TOKEN;

/** 容错读取 JSON（避免空文件/半包） */
async function readJsonSafe(file, fallback = "[]", retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      const raw = await fs.readFile(file, "utf-8");
      if (!raw || !raw.trim()) throw new Error("empty json file");
      return JSON.parse(raw);
    } catch (e) {
      if (i === retries - 1) {
        try {
          return JSON.parse(fallback);
        } catch {
          return [];
        }
      }
      await new Promise((r) => setTimeout(r, 80));
    }
  }
  return [];
}

/** 并发控制（避免触发 Graph 限流） */
async function mapWithConcurrency(list, concurrency, mapper) {
  const result = new Array(list.length);
  let idx = 0;

  async function worker() {
    while (idx < list.length) {
      const cur = idx++;
      try {
        result[cur] = await mapper(list[cur], cur);
      } catch (e) {
        result[cur] = null;
      }
    }
  }

  const pool = new Array(Math.min(concurrency, list.length))
    .fill(0)
    .map(worker);

  await Promise.all(pool);
  return result.filter(Boolean);
}

export async function loader({ request }) {
  if (!token) {
    return json(
      { error: "Missing INSTAGRAM_ACCESS_TOKEN" },
      {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      }
    );
  }

  const url = new URL(request.url);
  const filterCategory = url.searchParams.get("category");
  const limit = Number(url.searchParams.get("limit") || 0);
  const offset = Number(url.searchParams.get("offset") || 0);

  // 1) 读可见清单
  await ensureVisibleHashtagFile();
  const visible = await readJsonSafe(VISIBLE_HASHTAG_PATH, "[]");

  // 2) 可选分类过滤
  let toFetch = filterCategory
    ? visible.filter((v) => v.category === filterCategory)
    : visible.slice();

  // 3) 先分页裁切，减少 Graph 调用
  const total = toFetch.length;
  if (limit > 0) {
    toFetch = toFetch.slice(offset, offset + limit);
  }

  // 4) 实时拉 Graph（拿当前 media_url）
  const fields =
    "id,media_url,permalink,caption,media_type,timestamp,thumbnail_url";
  const concurrency = 6;

  const results = await mapWithConcurrency(toFetch, concurrency, async (entry) => {
    const res = await fetch(
      `https://graph.facebook.com/v23.0/${entry.id}?fields=${fields}&access_token=${token}`
    );
    const data = await res.json();

    if (!data || data.error) return null;

    return {
      id: data.id,
      media_url: data.media_url,
      media_type: data.media_type,
      caption: data.caption || "",
      permalink: data.permalink,
      timestamp: data.timestamp || "",
      category: entry.category || null,
      products: entry.products || [],
      thumbnail_url: data.thumbnail_url || null,
    };
  });

  // 5) 时间降序
  results.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));

  return json(
    { media: results, total },
    {
      headers: {
        // ✅ 一致的 CORS 头
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        // 轻缓存，减轻压力
        "Cache-Control": "public, max-age=60",
      },
    }
  );
}
