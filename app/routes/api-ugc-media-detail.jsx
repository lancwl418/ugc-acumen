// app/routes/api-ugc-media-detail.jsx
import { json } from "@remix-run/node";
import { getVisibleById } from "../lib/visibleMentions.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || url.searchParams.get("media_id");
  if (!id) return json({ error: "Missing id" }, { status: 400, headers: CORS });

  const data = await getVisibleById(id);
  if (!data || !data.media_url) {
    return json({ error: "Not found or no media" }, { status: 404, headers: CORS });
  }
  return json(data, { headers: CORS });
}
