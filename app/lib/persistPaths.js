// app/lib/persistPaths.js
// ✅ 统一兼容版：同时支持 /data 与 public/data；同时导出两套命名（HASH vs HASHTAG）
//    绝不主动清空已有文件；若不存在才创建空数组。

import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";

/* 选择第一个已存在的路径；都不存在则选第一个候选 */
function pickExisting(cands) {
  for (const p of cands) {
    try { if (p && existsSync(p)) return p; } catch {}
  }
  return cands.find(Boolean);
}

/* -------------------- TAG / Mentions 可见清单 -------------------- */
const TAG_ENV = process.env.VISIBLE_TAG_PATH && process.env.VISIBLE_TAG_PATH.trim();
const TAG_CANDIDATES = [
  TAG_ENV ? path.resolve(TAG_ENV) : null,                          // 环境变量优先
  path.resolve("/data/visible_tag_ugc.json"),                      // 你之前的 /data 版本
  path.resolve("public/data/visible_tag_ugc.json"),                // 你最先喂我的 public/data 版本
  path.resolve("public/visible_tag_ugc.json"),                     // 旧兼容
].filter(Boolean);

export const VISIBLE_TAG_PATH = pickExisting(TAG_CANDIDATES);

export async function ensureVisibleTagFile() {
  try { await fs.access(VISIBLE_TAG_PATH); }
  catch {
    await fs.mkdir(path.dirname(VISIBLE_TAG_PATH), { recursive: true });
    await fs.writeFile(VISIBLE_TAG_PATH, "[]", "utf-8");
  }
}

/* -------------------- HASHTAG 可见清单 -------------------- */
const HASH_ENV = process.env.VISIBLE_HASH_PATH && process.env.VISIBLE_HASH_PATH.trim();
const HASH_CANDIDATES = [
  HASH_ENV ? path.resolve(HASH_ENV) : null,                        // 环境变量优先（名字：HASH）
  path.resolve("/data/visible_hashtag.json"),                      // 你之前的 /data 文件名
  path.resolve("/data/visible_hashtag_ugc.json"),                  // 可能的 /data 新名
  path.resolve("public/data/visible_hashtag_ugc.json"),            // 你最先喂我的 public/data 版本（首选）
  path.resolve("public/visible_hashtag_ugc.json"),                 // 旧兼容
].filter(Boolean);

export const VISIBLE_HASH_PATH = pickExisting(HASH_CANDIDATES);

// 别名导出（为已有代码保驾护航）
export const VISIBLE_HASHTAG_PATH = VISIBLE_HASH_PATH;

export async function ensureVisibleHashFile() {
  try { await fs.access(VISIBLE_HASH_PATH); }
  catch {
    await fs.mkdir(path.dirname(VISIBLE_HASH_PATH), { recursive: true });
    await fs.writeFile(VISIBLE_HASH_PATH, "[]", "utf-8");
  }
}

// 别名（已有代码可能用的是 ensureVisibleHashtagFile）
export async function ensureVisibleHashtagFile() { return ensureVisibleHashFile(); }

/* -------------------- 老接口别名（不要删） -------------------- */
// 某些地方把 tag 的文件当作 VISIBLE_PATH
export const VISIBLE_PATH = VISIBLE_TAG_PATH;
export async function ensureVisibleFile() { return ensureVisibleTagFile(); }
