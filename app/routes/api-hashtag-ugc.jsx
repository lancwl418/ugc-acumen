// app/routes/api-hashtag-ugc.jsx
import { json } from "@remix-run/node";
import fs from "fs/promises";
import {
  VISIBLE_HASHTAG_PATH,
  ensureVisibleHashtagFile,
} from "../lib/persistPaths.js";
import { resolveMany } from "../lib/ugcResolver.server.js";

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

  const all = await readVisible();
  let list = filterCategory ? all.filter(v => v.category === filterCategory) : all.slice();
  const total = list.length;

  if (limit > 0) list = list.slice(offset, offset + limit);

  // 统一兜底：Graph -> oEmbed -> Admin
  const media = await resolveMany(list, 5);

  // 时间降序
  media.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));

  return json(
    {
      media,
      total,
      page: { limit, offset, returned: media.length },
    },
    { headers: { ...CORS, "Cache-Control": "public, max-age=60" } }
  );
}
