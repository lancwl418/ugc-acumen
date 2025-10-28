// app/routes/api-hashtag-ugc.jsx
// 目标：Hashtag 瀑布流接口只读 visible，不访问 Graph / oEmbed；关闭缓存。

import { json } from "@remix-run/node";
import fs from "fs/promises";
import {
  VISIBLE_HASHTAG_PATH,
  ensureVisibleHashtagFile,
} from "../lib/persistPaths.js";
import { buildFromAdmin } from "../lib/ugcResolver.server.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function readVisible() {
  await ensureVisibleHashtagFile();
  try {
    const raw = await fs.readFile(VISIBLE_HASHTAG_PATH, "utf-8");
    return JSON.parse(raw || "[]");
  } catch {
    return [];
  }
}

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const url = new URL(request.url);
  const filterCategory = url.searchParams.get("category");
  const limit  = Number(url.searchParams.get("limit") || 0);
  const offset = Number(url.searchParams.get("offset") || 0);

  // 只读本地 visible 文件
  const all = await readVisible();
  let list = filterCategory ? all.filter(v => v.category === filterCategory) : all.slice();
  const total = list.length;

  if (limit > 0) list = list.slice(offset, offset + limit);

  // 不再调用 Graph / oEmbed，统一用 Admin/visible 中的数据
  // ✅ 把 featured 透传出来（buildFromAdmin 可能不包含该字段）
  const media = list.map(v => ({ ...buildFromAdmin(v), featured: !!v.featured }));

  // ✅ featured 优先，其次按时间降序
  media.sort((a, b) => {
    const fa = a.featured ? 1 : 0;
    const fb = b.featured ? 1 : 0;
    if (fa !== fb) return fb - fa;
    return (b.timestamp || "").localeCompare(a.timestamp || "");
  });

  return json(
    { media, total, page: { limit, offset, returned: media.length } },
    {
      headers: {
        ...CORS,
        // 关闭缓存：后台刷新 visible 后前台立即可见
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}