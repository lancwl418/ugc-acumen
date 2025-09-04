// 媒体代理：根据 IG 媒体 ID 返回 302 到最新 CDN URL（thumb/raw），本地缓存 55min
import { json as remixJson } from "@remix-run/node";
import { getFreshMediaUrl } from "../lib/resolveFreshMedia.server.js";

export async function loader({ request }) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const type = url.searchParams.get("type") || "thumb"; // thumb|raw

  if (!id) return remixJson({ error: "missing id" }, { status: 400 });

  try {
    const { url: freshUrl } = await getFreshMediaUrl(id, type);
    return new Response(null, {
      status: 302,
      headers: { Location: freshUrl, "Cache-Control": "public, max-age=300" },
    });
  } catch (e) {
    return remixJson({ error: String(e) }, { status: 500 });
  }
}
