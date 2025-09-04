// app/routes/api.ig.media.jsx
// 媒体代理：根据 source 选择正确的刷新路径；
// ✅ http(s) 用 302；✅ data URI 直接 200 输出（兼容性更好）

import { json as remixJson } from "@remix-run/node";
import { getFreshMediaUrl } from "../lib/resolveFreshMedia.server.js";

export async function loader({ request }) {
  const url = new URL(request.url);
  const id         = url.searchParams.get("id");
  const type       = url.searchParams.get("type") || "thumb";   // thumb|raw
  const source     = url.searchParams.get("source") || "hashtag"; // hashtag|tag
  const permalink  = url.searchParams.get("permalink") || "";

  if (!id) return remixJson({ error: "missing id" }, { status: 400 });

  try {
    const { url: freshUrl } = await getFreshMediaUrl({ id, type, source, permalink });

    // 如果是 data URI，就直接输出 200，避免 302->data: 的兼容问题
    if (freshUrl.startsWith("data:")) {
      const m = /^data:([^;,]+)?;base64,(.*)$/i.exec(freshUrl);
      const mime = m?.[1] || "image/png";
      const b64  = m?.[2] || "";
      const body = Buffer.from(b64, "base64");
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": mime, "Cache-Control": "public, max-age=300" },
      });
    }

    // 其余 http(s) 直链走 302（保留你原先的行为）
    return new Response(null, {
      status: 302,
      headers: { Location: freshUrl, "Cache-Control": "public, max-age=300" },
    });
  } catch (e) {
    return remixJson({ error: String(e) }, { status: 500 });
  }
}
