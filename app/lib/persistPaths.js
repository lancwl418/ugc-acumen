// app/lib/persistPaths.js  —— 兼容最终版
import path from "path";
import fs from "fs/promises";

/* ========= Mentions 可见清单 ========= */
export const VISIBLE_TAG_PATH = path.resolve("public/visible_tag_ugc.json");
export async function ensureVisibleTagFile() {
  try { await fs.access(VISIBLE_TAG_PATH); }
  catch { await fs.writeFile(VISIBLE_TAG_PATH, "[]", "utf-8"); }
}

/* ========= Hashtags 可见清单 ========= */
export const VISIBLE_HASH_PATH = path.resolve("public/visible_hashtag_ugc.json");
export async function ensureVisibleHashFile() {
  try { await fs.access(VISIBLE_HASH_PATH); }
  catch { await fs.writeFile(VISIBLE_HASH_PATH, "[]", "utf-8"); }
}

/* ========= 兼容旧命名（不要删） ========= */
/* 一些老文件可能还在 import 这些名字：VISIBLE_PATH / ensureVisibleFile /
   VISIBLE_HASHTAG_PATH / ensureVisibleHashtagFile
   这里做别名导出，避免 Rollup 的 MISSING_EXPORT 报错。 */

export const VISIBLE_PATH = VISIBLE_TAG_PATH; // 旧：默认走 mentions 文件
export async function ensureVisibleFile() { return ensureVisibleTagFile(); }

export const VISIBLE_HASHTAG_PATH = VISIBLE_HASH_PATH;
export async function ensureVisibleHashtagFile() { return ensureVisibleHashFile(); }
