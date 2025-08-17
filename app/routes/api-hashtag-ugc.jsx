// app/routes/api-hashtag-ugc.jsx
import { json } from "@remix-run/node";
import fs from "fs/promises";
import {
  VISIBLE_HASHTAG_PATH,
  ensureVisibleHashtagFile,
} from "../lib/persistPaths.js";

// 优先用用户长效 token（若配置），否则回退 Page Token
const token = process.env.IG_USER_TOKEN || process.env.PAGE_TOKEN;

// CORS 头
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  Vary: "Origin",
};

// 读取 JSON（容错空文件/半包）
async function readJsonSafe(file, fallback = "[]", retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      const raw = await fs.readFile(file, "utf-8");
      if (!raw || !raw.trim()) throw new Error("empty json file");
      return JSON.parse(raw);
    } catch (e) {
      if (i === retries - 1) {
        try { return JSON.parse(fallback); } catch { return []; }
      }
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
      try { result[cur] = await mapper(list[cur], cur); }
      catch { result[cur] = null; }
    }
  }
  const pool = new Array(Math.min(concurrency, list.length)).fill(0).map(worker);
  await Promise.all(pool);
  return result;
}

// 处理预检
export async function action({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  return new Response(null, { status: 405, headers: CORS });
}

export async function loader({ request }) {
  const url = new URL(request.url);
  const filterCategory = url.searchParams.get("category");
  const limit = Number(url.searchParams.get("limit") || 0);
  const offset = Number(url.searchParams.get("offset") || 0);
  const skipDetail = url.searchParams.get("skipDetail") === "1"; // ✅ Dev 下建议传 1

  // 1) 读可见清单（admin 勾选后写入）
  await ensureVisibleHashtagFile();
  const visible = await readJsonSafe(VISIBLE_HASHTAG_PATH, "[]");

  // 2) 先按分类过滤
  let list = filterCategory
    ? visible.filter((v) => v.category === filterCategory)
    : visible.slice();

  const total = list.length;

  // 3) 分页裁切
  if (limit > 0) list = list.slice(offset, offset + limit);

  // ✅ Dev：直接用 admin 保存的字段返回，避免逐条打 /{media_id}
  if (skipDetail) {
    const media = list.map((e) => ({
      id: e.id,
      media_url: e.media_url || e.thumbnail_url || "", // admin 抓的时候请一并保存
      thumbnail_url: e.thumbnail_url || null,
      media_type: e.media_type || "IMAGE",
      caption: e.caption || "",
      permalink: e.permalink || "",
      timestamp: e.timestamp || "",
      category: e.category || null,
      products: e.products || [],
    }))
    .filter((x) => x.media_url || x.permalink);

    media.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));

    return json(
      { media, failed: [], total, page: { limit, offset, returned: media.length } },
      { headers: { ...CORS, "Cache-Control": "public, max-age=60", "x-mode": "skipDetail" } }
    );
  }

  // 🔽 Live 后：按 media_id 实时拉详情（你原有逻辑）
  if (!token) {
    return json(
      { error: "Missing IG_USER_TOKEN or PAGE_TOKEN" },
      { status: 500, headers: CORS }
    );
  }

  const fields = "id,media_url,permalink,caption,media_type,timestamp,thumbnail_url";
  const concurrency = 5;
  const ok = [];
  const failed = [];

  const rows = await mapWithConcurrency(list, concurrency, async (entry) => {
    const resp = await fetch(
      `https://graph.facebook.com/v23.0/${entry.id}?fields=${fields}&access_token=${token}`
    );
    const data = await resp.json();
    if (!data || data.error) {
      failed.push({
        id: entry.id,
        category: entry.category,
        code: data?.error?.code || "UNKNOWN",
        reason: data?.error?.message || "Unsupported get request or no permission / object not found",
      });
      return null;
    }
    return {
      id: data.id,
      media_url: data.media_url || data.thumbnail_url || "", // 加兜底
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
        ...CORS,
        "Cache-Control": "public, max-age=60",
      },
    }
  );
}
