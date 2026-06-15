// app/lib/instagramProfile.server.js
// 通过 FlashAPI 抓取 Instagram 资料并把头像上传到 R2 CDN。
import { r2PutObject } from "./r2Client.server.js";
import { flashGet } from "./flashAPI.server.js";

/**
 * 从 FlashAPI 抓取某用户的资料对象（/ig/info_username/ 返回的 user 节点）。
 */
export async function fetchInstagramProfile(username) {
  const j = await flashGet("/ig/info_username/", { user: username });
  const user = j?.user;
  if (!user) throw new Error(`FlashAPI returned no profile for @${username}`);
  return user;
}

/**
 * 抓取头像并上传到 R2，返回公开 CDN URL。
 */
export async function fetchAndStoreProfilePic(username) {
  const user = await fetchInstagramProfile(username);

  // 优先 HD，回退普通头像
  const picUrl = user.hd_profile_pic_url_info?.url || user.profile_pic_url;
  if (!picUrl) return null;

  const imgRes = await fetch(picUrl);
  if (!imgRes.ok) {
    throw new Error(`Failed to download profile pic for @${username}`);
  }

  const contentType = imgRes.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await imgRes.arrayBuffer());

  const key = `creators/${username}/profile.jpg`;
  return await r2PutObject(key, buffer, contentType);
}
