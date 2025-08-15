// app/routes/api-hashtag-ugc.jsx
import { json } from "@remix-run/node";
import fs from "fs/promises";
import {
  VISIBLE_HASHTAG_PATH,
  ensureVisibleHashtagFile,
} from "../lib/persistPaths.js";

// 工具函数：安全读 JSON
async function readJsonSafe(path, fallback) {
  try {
    const data = await fs.readFile(path, "utf-8");
    return JSON.parse(data);
  } catch {
    return fallback;
  }
}

// 工具函数：并发限制
async function mapWithConcurrency(arr, concurrency, fn) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < arr.length) {
      const i = index++;
      results[i] = await fn(arr[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: concurrency }, () => worker())
  );
  return results;
}

// 公共 CORS 头
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  Vary: "Origin",
};

// 预检处理
export async function action({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return new Response(null, { status: 405, headers: corsHeaders });
}

export async function loader({ request }) {
  try {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const token = process.env.INSTAGRAM_ACCESS_TOKEN;
    if (!token) {
      return json(
        { error: "Missing INSTAGRAM_ACCESS_TOKEN" },
        { status: 500, headers: corsHeaders }
      );
    }

    const url = new URL(request.url);
    const filterCategory = url.searchParams.get("category");
    const limit = Number(url.searchParams.get("limit") || 0);
    const offset = Number(url.searchParams.get("offset") || 0);

    await ensureVisibleHashtagFile();
    const visible = await readJsonSafe(VISIBLE_HASHTAG_PATH, []);

    let toFetch = filterCategory
      ? visible.filter((v) => v.category === filterCategory)
      : visible.slice();

    const total = toFetch.length;
    if (limit > 0) {
      toFetch = toFetch.slice(offset, offset + limit);
    }

    const fields =
      "id,media_url,permalink,caption,media_type,timestamp,thumbnail_url";

    const failed = [];
    const concurrency = 6;

    const results = await mapWithConcurrency(toFetch, concurrency, async (entry) => {
      try {
        const res = await fetch(
          `https://graph.facebook.com/v23.0/${entry.id}?fields=${fields}&access_token=${token}`
        );
        const data = await res.json();
        if (!data || data.error) {
          failed.push({
            id: entry.id,
            category: entry.category || null,
            reason: data?.error?.message || "unknown_error",
            code: data?.error?.code || null,
          });
          return null;
        }
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
      } catch (e) {
        failed.push({
          id: entry.id,
          category: entry.category || null,
          reason: e?.message || "fetch_failed",
          code: null,
        });
        return null;
      }
    });

    const ok = results.filter(Boolean);
    ok.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));

    return json(
      { media: ok, total, failed },
      {
        headers: {
          ...corsHeaders,
          "Cache-Control": "public, max-age=60",
        },
      }
    );
  } catch (e) {
    return json(
      { error: e?.message || "internal_error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
