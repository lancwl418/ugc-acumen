// app/routes/api-hashtag-ugc.jsx
import { json } from "@remix-run/node";
import fs from "fs/promises";
import {
  VISIBLE_HASHTAG_PATH,
  ensureVisibleHashtagFile,
} from "../lib/persistPaths.js";

const token = process.env.PAGE_TOKEN; // 用客户 Page 长效 token

// 读 JSON（容错空文件/半包）
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

// 简单并发调度器
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
  return result;
}

export async function loader({ request }) {
  if (!token) {
    return json({ error: "Missing PAGE_TOKEN" }, { status: 500 });
  }

  const url = new URL(request.url);
  const filterCategory = url.searchParams.get("category");
  const limit = Number(url.searchParams.get("limit") || 0);
  const offset = Number(url.searchParams.get("offset") || 0);
  const noRefetch = url.searchParams.get("noRefetch") === "1"; // ✅ 只读本地富字段

  // 1) 读可见清单
  await ensureVisibleHashtagFile();
  const visible = await readJsonSafe(VISIBLE_HASHTAG_PATH, "[]");

  // 2) 分类过滤
  let toFetch = filterCategory
    ? visible.filter((v) => v.category === filterCategory)
    : visible.slice();

  const total = toFetch.length;

  // 3) 分页裁切
  if (limit > 0) {
    toFetch = toFetch.slice(offset, offset + limit);
  }

  const fields =
    "id,media_url,permalink,caption,media_type,timestamp,thumbnail_url";
  const concurrency = 5;

  const ok = [];
  const failed = [];

  // 4) 逐条拿详情（或直接返回本地富字段）
  const rows = await mapWithConcurrency(toFetch, concurrency, async (entry) => {
    // ✅ 文件里已有富字段并且 noRefetch=1：直接用，完全不打 Graph
    if (
      noRefetch &&
      entry.permalink &&
      (entry.media_url || entry.thumbnail_url)
    ) {
      return {
        id: entry.id,
        media_url: entry.media_url || entry.thumbnail_url || "",
        media_type: entry.media_type || "IMAGE",
        caption: entry.caption || "",
        permalink: entry.permalink,
        timestamp: entry.timestamp || "",
        category: entry.category || null,
        products: entry.products || [],
        thumbnail_url: entry.thumbnail_url || null,
      };
    }

    // 允许旧数据兜底：还是尝试拉一次 Graph
    try {
      const graphUrl = `https://graph.facebook.com/v23.0/${entry.id}?fields=${fields}&access_token=${encodeURIComponent(
        token
      )}`;
      const resp = await fetch(graphUrl);

      const text = await resp.text(); // 记录原文，便于定位
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }

      if (!resp.ok) {
        failed.push({
          id: entry.id,
          category: entry.category,
          code: data?.error?.code || resp.status,
          reason:
            data?.error?.message || `HTTP ${resp.status} ${resp.statusText}`,
        });
        return null;
      }

      if (!data || data.error) {
        failed.push({
          id: entry.id,
          category: entry.category,
          code: data?.error?.code || "UNKNOWN",
          reason: data?.error?.message || "Unknown error",
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
    } catch (err) {
      failed.push({
        id: entry.id,
        category: entry.category,
        code: "FETCH_EXCEPTION",
        reason: String(err?.message || err),
      });
      return null;
    }
  });

  for (const r of rows) if (r) ok.push(r);

  // 5) 时间降序
  ok.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));

  return json(
    {
      media: ok,
      failed,
      total,
      page: { limit, offset, returned: ok.length },
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Cache-Control": "public, max-age=60",
      },
    }
  );
}
