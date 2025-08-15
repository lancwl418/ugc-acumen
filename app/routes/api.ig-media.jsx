// app/routes/api.ig-media.jsx
import { json } from "@remix-run/node";

export async function loader({ request }) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return new Response("Missing id", { status: 400 });

  const token = process.env.INSTAGRAM_ACCESS_TOKEN;

  const r = await fetch(
    `https://graph.facebook.com/v23.0/${id}?fields=media_url,thumbnail_url,media_type&access_token=${token}`,
    { cache: "no-store" }
  );
  const data = await r.json();
  if (!data.media_url && !data.thumbnail_url) {
    return json({ error: true, upstream: data }, { status: 502 });
  }

  const target = data.media_url || data.thumbnail_url;

  // 方案一：302 跳转（最简单、带宽友好）
  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
      "Cache-Control": "no-store",
    },
  });

  // 方案二：流式转发（如需隐藏真实 URL）
  // const upstream = await fetch(target);
  // return new Response(upstream.body, {
  //   headers: {
  //     "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
  //     "Cache-Control": "no-store",
  //   },
  // });
}
