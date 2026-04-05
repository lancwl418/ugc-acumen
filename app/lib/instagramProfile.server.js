// app/lib/instagramProfile.server.js
// Fetch Instagram profile via RapidAPI and upload profile pic to R2
import { r2PutObject } from "./r2Client.server.js";

const RAPIDAPI_HOST = "instagram-looter2.p.rapidapi.com";
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || "bb64496e28msh404e742bb7f1073p1b3d4cjsnaa39242a4d5e";

/**
 * Fetch Instagram profile data from RapidAPI
 */
export async function fetchInstagramProfile(username) {
  const res = await fetch(
    `https://${RAPIDAPI_HOST}/profile2?username=${encodeURIComponent(username)}`,
    {
      headers: {
        "Content-Type": "application/json",
        "x-rapidapi-host": RAPIDAPI_HOST,
        "x-rapidapi-key": RAPIDAPI_KEY,
      },
    },
  );

  if (!res.ok) {
    throw new Error(`RapidAPI profile fetch failed: ${res.status}`);
  }

  const data = await res.json();
  if (!data.status) {
    throw new Error(`RapidAPI returned error for @${username}`);
  }

  return data;
}

/**
 * Fetch profile pic from Instagram and upload to R2 CDN.
 * Returns the public CDN URL.
 */
export async function fetchAndStoreProfilePic(username) {
  const profile = await fetchInstagramProfile(username);

  // Prefer HD pic, fallback to standard
  const picUrl =
    profile.hd_profile_pic_url_info?.url || profile.profile_pic_url;

  if (!picUrl) return null;

  // Download the image
  const imgRes = await fetch(picUrl);
  if (!imgRes.ok) {
    throw new Error(`Failed to download profile pic for @${username}`);
  }

  const contentType = imgRes.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await imgRes.arrayBuffer());

  // Upload to R2 under creators/{username}/profile.jpg
  const key = `creators/${username}/profile.jpg`;
  const cdnUrl = await r2PutObject(key, buffer, contentType);

  return cdnUrl;
}
