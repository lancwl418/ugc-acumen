// app/lib/fetchInstagram.js
import fs from "fs/promises";
import fetch from "node-fetch";

const token = process.env.INSTAGRAM_ACCESS_TOKEN;;
const igId = process.env.INSTAGRAM_IG_ID;
const url = `https://graph.facebook.com/v23.0/${igId}/media?fields=id,media_url,caption,permalink,timestamp,media_type&access_token=${token}`;

export async function fetchInstagramUGC() {
  try {
    const res = await fetch(url);
    const json = await res.json();

    if (!json.data) {
      console.warn("⚠️ Instagram 返回无数据:", json);
      return;
    }

    const items = json.data.map((item) => ({
      id: item.id,
      media_url: item.media_url,
      caption: item.caption || "",
      permalink: item.permalink,
      timestamp: item.timestamp,
      media_type: item.media_type,
    }));

    await fs.writeFile("public/ugc.json", JSON.stringify(items, null, 2), "utf-8");
    console.log(`✅ 已抓取 ${items.length} 条 Instagram UGC`);
  } catch (err) {
    console.error("❌ 抓取 Instagram 内容出错:", err);
  }
}
