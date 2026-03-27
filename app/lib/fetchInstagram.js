// app/lib/fetchInstagram.js
// 拉取自有 Instagram 帐号的帖子（/media endpoint）

const token = process.env.INSTAGRAM_ACCESS_TOKEN;
const igId = process.env.INSTAGRAM_IG_ID;

export async function fetchInstagramUGC() {
  if (!igId || !token) {
    console.warn("[fetchInstagram] Missing INSTAGRAM_IG_ID or INSTAGRAM_ACCESS_TOKEN");
    return [];
  }

  const url = `https://graph.facebook.com/v23.0/${igId}/media?fields=id,media_url,caption,permalink,timestamp,media_type,username&access_token=${token}`;

  try {
    const res = await fetch(url);
    const json = await res.json();

    if (!json.data) {
      console.warn("[fetchInstagram] Instagram returned no data:", json);
      return [];
    }

    return json.data.map((item) => ({
      id: item.id,
      media_url: item.media_url || "",
      caption: item.caption || "",
      permalink: item.permalink || "",
      timestamp: item.timestamp || "",
      media_type: item.media_type || "IMAGE",
      username: item.username || "",
    }));
  } catch (err) {
    console.error("[fetchInstagram] Error:", err);
    return [];
  }
}
