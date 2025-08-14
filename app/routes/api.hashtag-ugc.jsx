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

/** 并发控制：以 concurrency 个同时跑 */
async function mapWithConcurrency(list, concurrency, mapper) {
  const result = new Array(list.length);
  let idx = 0;

  async function worker() {
    while (idx < list.length) {
      const cur = idx++;
      try {
        result[cur] = await mapper(list[cur], cur);
      } catch (e) {
        // 出错时用 null 占位，稍后 filter 掉
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
      { status: 500 }
    );
  }

  // 允许：?category=camping&limit=24&offset=0
  const url = new URL(request.url);
  const filterCategory = url.searchParams.get("category");
  const limit = Number(url.searchParams.get("limit") || 0);
  const offset = Number(url.searchParams.get("offset") || 0);

  // 1) 读可见清单（含 category/products）
  await ensureVisibleHashtagFile();
  const visible = await readJsonSafe(VISIBLE_HASHTAG_PATH, "[]");

  // 2) 可选 category 过滤（先按可见列表过滤，减少后续 Graph 调用）
  let toFetch = filterCategory
    ? visible.filter((v) => v.category === filterCategory)
    : visible.slice();

  // 3) 排序（按保存顺序 or timestamp 无法在这里拿到，后面拿到数据后再按 timestamp 排）
  // 先做分页裁切，以减少 Graph 调用次数
  const total = toFetch.length;
  if (limit > 0) {
    toFetch = toFetch.slice(offset, offset + limit);
  }

  // 4) 实时拉取 Graph（拿当前 media_url）
  const fields =
    "id,media_url,permalink,caption,media_type,timestamp,thumbnail_url";

  const concurrency = 6; // 并发安全值，避免触发限流
  const results = await mapWithConcurrency(toFetch, concurrency, async (entry) => {
    const res = await fetch(
      `https://graph.facebook.com/v23.0/${entry.id}?fields=${fields}&access_token=${token}`
    );
    const data = await res.json();

    // Graph 错误时跳过
    if (!data || data.error) return null;

    return {
      id: data.id,
      media_url: data.media_url,
      media_type: data.media_type,
      caption: data.caption || "",
      permalink: data.permalink,
      timestamp: data.timestamp || "",
      // 加上保存的可见配置
      category: entry.category || null,
      products: entry.products || [],
      // 有需要也可暴露 thumbnail_url
      thumbnail_url: data.thumbnail_url || null,
    };
  });

  // 5) 时间降序
  results.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));

  return json(
    { media: results, total },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Cache-Control": "public, max-age=60", // 轻缓存 60 秒
      },
    }
  );
}
