// app/routes/api-hashtag-ugc.jsx
import { json } from "@remix-run/node";
import fs from "fs/promises";
import {
  VISIBLE_HASHTAG_PATH,
  ensureVisibleHashtagFile,
} from "../lib/persistPaths.js";

const token = process.env.PAGE_TOKEN;

// 读取 JSON（容错空文件/半包）
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
      // 小休眠再重试
      await new Promise((r) => setTimeout(r, 80));
    }
  }
  return [];
}

// 简单并发调度
async function mapWithConcurrency(list, concurrency, mapper) {
  const result = new Array(list.length);
  let idx = 0;

  async function worker() {
    while (idx < list.length) {
      const cur = idx++;
      try {
        result[cur] = await mapper(list[cur], cur);
      } catch {
        result[cur] = null; // 占位
      }
    }
  }

  const pool = new Array(Math.min(concurrency, list.length))
    .fill(0)
    .map(worker);

  await Promise.all(pool);
  return result;
}

export async function loader({ request }) {
  if (!token) {
    return json(
      { error: "Missing INSTAGRAM_ACCESS_TOKEN" },
      { status: 500 }
    );
  }

  // 允许 ?category=camping&limit=24&offset=0
  const url = new URL(request.url);
  const filterCategory = url.searchParams.get("category");
  const limit = Number(url.searchParams.get("limit") || 0);
  const offset = Number(url.searchParams.get("offset") || 0);

  // 1) 读可见清单
  await ensureVisibleHashtagFile();
  const visible = await readJsonSafe(VISIBLE_HASHTAG_PATH, "[]");

  // 2) 先按分类过滤
  let toFetch = filterCategory
    ? visible.filter((v) => v.category === filterCategory)
    : visible.slice();

  const total = toFetch.length;

  // 3) 分页裁切（减少后续 Graph 调用）
  if (limit > 0) {
    toFetch = toFetch.slice(offset, offset + limit);
  }

  // 4) 实时拉取 Graph（当前 media_url），并记录失败项
  const fields =
    "id,media_url,permalink,caption,media_type,timestamp,thumbnail_url";
  const concurrency = 5;

  const ok = [];
  const failed = [];

  const rows = await mapWithConcurrency(toFetch, concurrency, async (entry) => {
    const resp = await fetch(
      `https://graph.facebook.com/v23.0/${entry.id}?fields=${fields}&access_token=${token}`
    );
    const data = await resp.json();

    if (!data || data.error) {
      failed.push({
        id: entry.id,
        category: entry.category,
        code: data?.error?.code || "UNKNOWN",
        reason:
          data?.error?.message ||
          "Unsupported get request or no permission / object not found",
      });
      return null;
    }

    return {
      id: data.id,
      media_url: data.media_url || data.thumbnail_url || "",
      media_type: data.media_type,
      caption: data.caption || "",
      permalink: data.permalink,
      timestamp: data.timestamp || "",
      category: entry.category || null,
      products: entry.products || [],
      thumbnail_url: data.thumbnail_url || null,
    };
  });

  for (const r of rows) if (r) ok.push(r);

  // 5) 时间降序
  ok.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));

  return json(
    {
      media: ok,
      failed,          // 失败项单独返回，方便前端调试或埋点
      total,           // 该分类总条数（未分页前）
      page: {
        limit,
        offset,
        returned: ok.length,
      },
    },
    {
      headers: {
        // CORS 允许站外调用
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        // 轻缓存，减小服务压力（可按需调大/关掉）
        "Cache-Control": "public, max-age=60",
      },
    }
  );
}
