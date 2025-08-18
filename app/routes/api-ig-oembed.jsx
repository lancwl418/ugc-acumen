// app/routes/api-ig-oembed.jsx
import { json } from "@remix-run/node";

const token = process.env.PAGE_TOKEN; // 或 APP_ID|CLIENT_TOKEN

export async function loader({ request }) {
  const u = new URL(request.url);
  const igUrl = u.searchParams.get("url");
  const maxwidth = u.searchParams.get("maxwidth") || "540";
  const hidecaption = u.searchParams.get("hidecaption") || "1";
  const omitscript = u.searchParams.get("omitscript") || "true";

  if (!igUrl) return json({ error: "Missing url" }, { status: 400 });
  if (!token) return json({ error: "Missing PAGE_TOKEN" }, { status: 500 });

  const api = new URL("https://graph.facebook.com/v23.0/instagram_oembed");
  api.searchParams.set("url", igUrl);
  api.searchParams.set("access_token", token);
  api.searchParams.set("omitscript", omitscript);
  api.searchParams.set("hidecaption", hidecaption);
  api.searchParams.set("maxwidth", maxwidth);

  try {
    const r = await fetch(api);
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }

    if (!r.ok) {
      return json(
        { error: data?.error?.message || `HTTP ${r.status}`, code: data?.error?.code || r.status },
        { status: r.status }
      );
    }
    return json(data, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (e) {
    return json({ error: String(e?.message || e) }, { status: 500 });
  }
}
