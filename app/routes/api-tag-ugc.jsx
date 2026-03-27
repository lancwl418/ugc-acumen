// app/routes/api-tag-ugc.jsx
import { json } from "@remix-run/node";
import { getVisiblePaged } from "../lib/visibleMentions.js";

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
  const category = url.searchParams.get("category") || undefined;
  const limit  = Number(url.searchParams.get("limit") || 0);
  const offset = Number(url.searchParams.get("offset") || 0);

  const { items, total } = await getVisiblePaged({ category, limit, offset });

  return json(
    { media: items, total, page: { limit, offset, returned: items.length } },
    { headers: { ...CORS, "Cache-Control": "public, max-age=60" } }
  );
}
