// app/routes/api.ig.media.jsx
import { json as remixJson } from "@remix-run/node";
import { getFreshMediaUrl } from "../lib/resolveFreshMedia.server.js";

export async function loader({ request }) {
  const url = new URL(request.url);
  const id        = url.searchParams.get("id");
  const type      = url.searchParams.get("type") || "thumb";     // thumb|raw
  const source    = url.searchParams.get("source") || "hashtag"; // hashtag|tag
  const permalink = url.searchParams.get("permalink") || "";

  if (!id) return remixJson({ error: "missing id" }, { status: 400 });

  try {
    const { url: freshUrl } = await getFreshMediaUrl({ id, type, source, permalink });

    if (freshUrl.startsWith("data:")) {
      const m = /^data:([^;,]+)?;base64,(.*)$/i.exec(freshUrl);
      const mime = m?.[1] || "image/png";
      const body = Buffer.from(m?.[2] || "", "base64");
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": mime, "Cache-Control": "public, max-age=300" },
      });
    }

    return new Response(null, {
      status: 302,
      headers: { Location: freshUrl, "Cache-Control": "public, max-age=300" },
    });
  } catch (e) {
    return remixJson({ error: String(e) }, { status: 500 });
  }
}
