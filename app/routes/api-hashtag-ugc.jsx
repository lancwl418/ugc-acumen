// app/routes/api-hashtag-ugc.jsx
import { json } from "@remix-run/node";
import fs from "fs/promises";
import {
  VISIBLE_HASHTAG_PATH,
  ensureVisibleHashtagFile,
} from "../lib/persistPaths.js";

const PAGE_TOKEN = process.env.PAGE_TOKEN;

// oEmbed 需要 App Token，推荐 APP_ID|APP_SECRET 的 client token
const APP_ID = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;
const OEMBED_TOKEN = (APP_ID && APP_SECRET) ? `${APP_ID}|${APP_SECRET}` : null;

// 安全读 JSON
async function readJsonSafe(file, fallback = "[]") {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw || fallback);
  } catch {
    return JSON.parse(fallback);
  }
}

// 简单并发
async function mapWithConcurrency(list, concurrency, mapper) {
  const res = new Array(list.length);
  let i = 0;
  async function worker() {
    while (i < list.length) {
      const idx = i++;
      try {
        res[idx] = await mapper(list[idx], idx);
      } catch {
        res[idx] = null;
      }
    }
  }
  await Promise.all(new Array(Math.min(concurrency, list.length)).fill(0).map(worker));
  return res;
}

// —— oEmbed ——
// 注意：需要在 App 设置中配置 App Domains/Website，且使用 APP_ID|APP_SECRET 作为 access_token
async function fetchOEmbed(permalink) {
  if (!permalink) throw Object.assign(new Error("Missing permalink for oEmbed"), { code: "NO_PERMALINK" });
  if (!OEMBED_TOKEN) throw Object.assign(new Error("Missing META_APP_ID/SECRET for oEmbed"), { code: "NO_OEMBED_TOKEN" });

  const u = new URL("https://graph.facebook.com/v23.0/instagram_oembed");
  u.searchParams.set("url", permalink);
  u.searchParams.set("access_token", OEMBED_TOKEN);
  // 可选项
  u.searchParams.set("omitscript", "true");
  u.searchParams.set("hidecaption", "false");
  u.searchParams.set("maxwidth", "640");

  const resp = await fetch(u.toString());
  const data = await resp.json();
  if (data?.error) throw data.error;

  // 常见字段：author_name, author_url, thumbnail_url, title, html
  return {
    username: data.author_name || "",
    caption: data.title || "",
    media_url: data.thumbnail_url || "", // 作为图片/视频封面使用
    permalink, // 仍用外部传入的
    // 无法从 oEmbed 精确判断 media_type（可以粗略用 html 包含 <video> 判断）
    media_type: data.html && /<video/i.test(data.html) ? "VIDEO" : "IMAGE",
    thumbnail_url: data.thumbnail_url || null,
  };
}

export async function loader({ request }) {
  const url = new URL(request.url);
  const filterCategory = url.searchParams.get("category");
  const limit = Number(url.searchParams.get("limit") || 0);
  const offset = Number(url.searchParams.get("offset") || 0);

  await ensureVisibleHashtagFile();
  const visible = await readJsonSafe(VISIBLE_HASHTAG_PATH, "[]");

  // 1) 过滤分类
  let toFetch = filterCategory
    ? visible.filter((v) => v.category === filterCategory)
    : visible.slice();

  const total = toFetch.length;

  // 2) 分页
  if (limit > 0) {
    toFetch = toFetch.slice(offset, offset + limit);
  }

  // 3) 依次尝试 Graph → oEmbed → Admin兜底
  const fields =
    "id,media_url,permalink,caption,media_type,timestamp,thumbnail_url,username";
  const concurrency = 5;

  const ok = [];
  const failed = [];

  const rows = await mapWithConcurrency(toFetch, concurrency, async (entry) => {
    // A) Graph 尝试
    let graph = null;
    if (PAGE_TOKEN) {
      try {
        const resp = await fetch(
          `https://graph.facebook.com/v23.0/${entry.id}?fields=${fields}&access_token=${PAGE_TOKEN}`
        );
        const data = await resp.json();
        if (data?.error) throw data.error;
        graph = data;
      } catch (err) {
        failed.push({
          id: entry.id,
          category: entry.category,
          code: err?.code || "GRAPH_ERROR",
          reason: err?.message || "Graph request failed",
        });
      }
    } else {
      failed.push({
        id: entry.id,
        category: entry.category,
        code: "NO_PAGE_TOKEN",
        reason: "No PAGE_TOKEN, skip Graph",
      });
    }

    // 如果 Graph 成功，直接返回
    if (graph && (graph.media_url || graph.thumbnail_url)) {
      return {
        id: graph.id || entry.id,
        media_url: graph.media_url || graph.thumbnail_url || "",
        media_type: graph.media_type || entry.media_type || "IMAGE",
        caption: graph.caption ?? entry.caption ?? "",
        permalink: graph.permalink || entry.permalink || "",
        timestamp: graph.timestamp || entry.timestamp || "",
        username: graph.username || entry.username || "",
        category: entry.category || null,
        products: entry.products || [],
        thumbnail_url: graph.thumbnail_url || entry.thumbnail_url || null,
      };
    }

    // B) oEmbed 尝试（需要 permalink）
    let embed = null;
    try {
      if (entry.permalink) {
        embed = await fetchOEmbed(entry.permalink);
      } else {
        throw Object.assign(new Error("No permalink to call oEmbed"), { code: "NO_PERMALINK" });
      }
    } catch (err) {
      failed.push({
        id: entry.id,
        category: entry.category,
        code: err?.code || "OEMBED_ERROR",
        reason: err?.message || "oEmbed request failed",
      });
    }

    if (embed && embed.media_url) {
      return {
        id: entry.id, // oEmbed 不回 media id，用原 id
        media_url: embed.media_url,
        media_type: embed.media_type || entry.media_type || "IMAGE",
        caption: embed.caption ?? entry.caption ?? "",
        permalink: embed.permalink || entry.permalink || "",
        timestamp: entry.timestamp || "", // oEmbed 不提供时间，回落本地/空
        username: embed.username || entry.username || "",
        category: entry.category || null,
        products: entry.products || [],
        thumbnail_url: embed.thumbnail_url || entry.thumbnail_url || null,
      };
    }

    // C) Admin 本地兜底（最后一道）
    const fallback_media =
      entry.media_url || entry.thumbnail_url || "";
    if (!fallback_media) {
      failed.push({
        id: entry.id,
        category: entry.category,
        code: "NO_MEDIA",
        reason: "No media_url/thumbnail_url in graph/oembed/admin",
      });
      return null;
    }

    return {
      id: entry.id,
      media_url: fallback_media,
      media_type: entry.media_type || "IMAGE",
      caption: entry.caption || "",
      permalink: entry.permalink || "",
      timestamp: entry.timestamp || "",
      username: entry.username || "",
      category: entry.category || null,
      products: entry.products || [],
      thumbnail_url: entry.thumbnail_url || null,
    };
  });

  for (const r of rows) if (r) ok.push(r);

  // 4) 时间降序（尽可能用 timestamp）
  ok.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));

  return json(
    {
      media: ok,
      failed, // 用于调试观察
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
