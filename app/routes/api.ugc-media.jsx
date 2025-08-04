import { json } from "@remix-run/node";
import fs from "fs/promises";
import path from "path";

const token = process.env.INSTAGRAM_ACCESS_TOKEN;

export async function loader() {
  const visiblePath = path.resolve("public/visible.json");
  const visibleRaw = await fs.readFile(visiblePath, "utf-8");
  const visible = JSON.parse(visibleRaw);

  // 直接实时拉取 IG 数据
  const results = await Promise.all(
    visible.map(async (entry) => {
      const res = await fetch(
        `https://graph.facebook.com/v23.0/${entry.id}?fields=id,media_url,permalink,caption,media_type,timestamp&access_token=${token}`
      );
      const data = await res.json();
      return {
        ...data,
        category: entry.category || null,
        products: entry.products || [],
      };
    })
  );

  return json({ media: results }, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    }
  });
}
