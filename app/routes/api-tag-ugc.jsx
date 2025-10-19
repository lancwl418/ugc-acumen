// app/routes/api-tag-ugc.jsx
import { json } from "@remix-run/node";
import fs from "fs/promises";
import { VISIBLE_TAG_PATH, ensureVisibleTagFile } from "../lib/persistPaths.js";


const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};


async function readVisible() {
  await ensureVisibleTagFile();
  try {
    const raw = await fs.readFile(VISIBLE_TAG_PATH, "utf-8");
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

  // 时间降序
  list.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));

  return json(
    { media: list, total, page: { limit, offset, returned: list.length } },
    { headers: { ...CORS, "Cache-Control": "public, max-age=60" } }
  );
}
