// app/lib/persistPaths.js  —— 最终版
import path from "path";
import fs from "fs/promises";

// Mentions 可见清单（原来就有）
export const VISIBLE_TAG_PATH = path.resolve("public/visible_tag_ugc.json");
export async function ensureVisibleTagFile() {
  try { await fs.access(VISIBLE_TAG_PATH); }
  catch { await fs.writeFile(VISIBLE_TAG_PATH, "[]", "utf-8"); }
}

// Hashtag 可见清单（这两个是新增的）
export const VISIBLE_HASH_PATH = path.resolve("public/visible_hashtag_ugc.json");
export async function ensureVisibleHashFile() {
  try { await fs.access(VISIBLE_HASH_PATH); }
  catch { await fs.writeFile(VISIBLE_HASH_PATH, "[]", "utf-8"); }
}
