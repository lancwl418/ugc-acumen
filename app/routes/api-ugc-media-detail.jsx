// app/routes/api-ugc-media-detail.jsx
import { json } from "@remix-run/node";
import { resolveOne } from "../lib/ugcResolver.server.js";
import fs from "fs/promises";
import { VISIBLE_HASHTAG_PATH, ensureVisibleHashtagFile } from "../lib/persistPaths.js";

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
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "Missing id" }, { status: 400, headers: CORS });

  const visible = await readVisible();
  const data = await resolveOne(id, visible); // 统一兜底
  if (!data) {
    return json({ error: "Not found or no media" }, { status: 404, headers: CORS });
  }
  return json(data, { headers: CORS });
}
