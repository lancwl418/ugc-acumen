// 媒体代理：根据 source 选择正确的刷新路径；统一 302 到可用 URL
import { json as remixJson } from "@remix-run/node";
import { getFreshMediaUrl } from "../lib/resolveFreshMedia.server.js";

export async function loader({ request }) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const type = url.searchParams.get("type") || "thumb"; // thumb|raw
  const source = url.searchParams.get("source") || "hashtag"; // hashtag | tag
  const permalink = url.searchParams.get("permalink") || "";

  if (!id) return remixJson({ error: "missing id" }, { status: 400 });

  try {
    const { url: freshUrl } = await getFreshMediaUrl({ id, type, source, permalink });
    return new Response(null, {
      status: 302,
      headers: { Location: freshUrl, "Cache-Control": "public, max-age=300" },
    });
  } catch (e) {
    return remixJson({ error: String(e) }, { status: 500 });
  }
}
