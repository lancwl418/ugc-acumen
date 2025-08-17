// app/routes/api-hashtag-ugc.jsx
import { json } from "@remix-run/node";
import fs from "fs/promises";
import {
  VISIBLE_HASHTAG_PATH,
  ensureVisibleHashtagFile,
} from "../lib/persistPaths.js";

const token = process.env.PAGE_TOKEN; // 用你现在的 Page 长效 Token

// --- utils ---
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function safeParse(s, fb = []) { try { return JSON.parse(s); } catch { return fb; } }

async function mapWithConcurrency(list, limit, fn) {
  const out = new Array(list.length);
  let i = 0;
  async function worker() {
    while (i < list.length) {
      const cur = i++;
      try { out[cur] = await fn(list[cur], cur); }
      catch (e) { out[cur] = { __failed: true, error: String(e) }; }
    }
  }
  await Promise.all(new Array(Math.min(limit, list.length)).fill(0).map(worker));
  return out;
}

function guessTypeFromOembedHtml(html = "") {
  return /video|mp4|ig-video/i.test(html) ? "VIDEO" : "IMAGE";
}
function extractUsernameFromUrl(url = "") {
  // https://www.instagram.com/{username}
  const m = url.match(/instagram\.com\/([^\/?#]+)/i);
  return m ? m[1] : "";
}

// --- Remix loader ---
export async function loader({ request }) {
  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const limit = Number(url.searchParams.get("limit") || 24);
  const offset = Number(url.searchParams.get("offset") || 0);

  if (!token) {
    return json({ error: "Missing PAGE_TOKEN" }, { status: 500 });
  }

  await ensureVisibleHashtagFile();
  const raw = await fs.readFile(VISIBLE_HASHTAG_PATH, "utf-8").catch(() => "[]");
  let all = safeParse(raw, []);

  // 过滤分类
  if (category) all = all.filter(x => x.category === category);

  // 时间降序（如果你的文件已是降序，这行可去掉）
  all.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));

  const total = all.length;
  const pageSlice = limit > 0 ? all.slice(offset, offset + limit) : all;

  const fields = "id,caption,media_type,media_url,permalink,timestamp,thumbnail_url,username";
  const concurrency = 5;

  const failed = [];
  const media = [];

  const rows = await mapWithConcurrency(pageSlice, concurrency, async (entry) => {
    // 1) 优先 Graph 详情
    let detail = null;
    try {
      const r = await fetch(
        `https://graph.facebook.com/v23.0/${entry.id}?fields=${fields}&access_token=${token}`
      );
      detail = await r.json();

      if (detail?.error) throw new Error(detail.error?.message || "Graph error");

      // Graph 成功，但有时候 media_url 会因权限为空，先容错
      const murl = detail.media_url || detail.thumbnail_url || entry.thumb || "";
      if (!murl) throw new Error("Graph missing media_url");
      return {
        id: detail.id,
        media_url: murl,
        thumbnail_url: detail.thumbnail_url || entry.thumb || "",
        media_type: detail.media_type || entry.media_type || "IMAGE",
        caption: detail.caption || entry.caption || "",
        permalink: detail.permalink || entry.permalink || "",
        timestamp: detail.timestamp || entry.timestamp || "",
        author: detail.username || entry.username || "", // ✅ 作者
        category: entry.category || null,
        products: entry.products || [],
      };
    } catch (e) {
      // 2) 失败：oEmbed 兜底
      try {
        // 你的代理：/api-ig-oembed?url=...
        const r2 = await fetch(
          `${process.env.PUBLIC_ORIGIN || ""}/api-ig-oembed?url=${encodeURIComponent(entry.permalink)}`
        );
        const o = await r2.json();

        const thumb = o.thumbnail_url || entry.thumb || "";
        const type = guessTypeFromOembedHtml(o.html || "");

        if (!thumb) throw new Error("oEmbed no thumbnail");

        return {
          id: entry.id,
          media_url: thumb,                       // 列表用缩略图
          thumbnail_url: thumb,
          media_type: type || entry.media_type || "IMAGE",
          caption: (o.title || "").trim() || entry.caption || "", // oEmbed.title 通常为 caption
          permalink: entry.permalink || "",
          timestamp: entry.timestamp || "",
          author: o.author_name || extractUsernameFromUrl(o.author_url || "") || "",
          category: entry.category || null,
          products: entry.products || [],
        };
      } catch (e2) {
        failed.push({
          id: entry.id,
          category: entry.category,
          reason: String(e2?.message || e2 || "fallback failed"),
        });
        return null;
      }
    }
  });

  for (const r of rows) if (r) media.push(r);

  return json(
    {
      media,
      failed,
      total,
      page: { limit, offset, returned: media.length },
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=60",
      },
    }
  );
}
