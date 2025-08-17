// app/routes/api-ig-oembed.jsx
import { json } from "@remix-run/node";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function action({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  return new Response(null, { status: 405, headers: CORS });
}

export async function loader({ request }) {
  try {
    const url = new URL(request.url);
    const permalink = url.searchParams.get("url");
    if (!permalink) {
      return new Response("Missing url", { status: 400, headers: CORS });
    }

    const appId = process.env.FB_APP_ID;
    const appSecret = process.env.FB_APP_SECRET;
    if (!appId || !appSecret) {
      return json({ error: "Missing FB_APP_ID/FB_APP_SECRET" }, { status: 500, headers: CORS });
    }

    const o = new URL("https://graph.facebook.com/v13.0/instagram_oembed");
    o.searchParams.set("url", permalink);
    o.searchParams.set("omitscript", "1");   // 前端全局引一次 embed.js
    o.searchParams.set("maxwidth", "640");   // 需要更宽就调
    o.searchParams.set("access_token", `${appId}|${appSecret}`);

    const r = await fetch(o.toString(), { cache: "no-store" });
    const data = await r.json();

    // 只透出常用字段，返回带 CORS + 缓存头
    const { html, thumbnail_url, author_name, author_url, title, width, height } = data;
    return json(
      { html, thumbnail_url, author_name, author_url, title, width, height },
      {
        headers: {
          ...CORS,
          "Cache-Control": "public, max-age=3600",
        },
      }
    );
  } catch (e) {
    return json({ error: e?.message || "oembed_failed" }, { status: 502, headers: CORS });
  }
}
