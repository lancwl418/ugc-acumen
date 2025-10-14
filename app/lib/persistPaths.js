// app/lib/persistPaths.js —— 热修复最终版：兼容旧路径 + 永不误清空
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";

/* ========== 工具：路径候选优先选择已存在的那个 ========== */
function pickExisting(cands) {
  for (const p of cands) {
    try { if (existsSync(p)) return p; } catch {}
  }
  return cands[0]; // 都不存在则返回首选
}

/* ========== Mentions 可见清单 ========== */
/** 允许通过环境变量强制指定旧路径（优先级最高） */
const TAG_ENV = process.env.VISIBLE_TAG_PATH && process.env.VISIBLE_TAG_PATH.trim();
const TAG_CANDIDATES = [
  TAG_ENV ? path.resolve(TAG_ENV) : null,
  // 旧项目常用的老路径（public/data/...）
  path.resolve("public/data/visible_tag_ugc.json"),
  // 新示例里的默认路径（public/...）
  path.resolve("public/visible_tag_ugc.json"),
].filter(Boolean);

export const VISIBLE_TAG_PATH = pickExisting(TAG_CANDIDATES);

export async function ensureVisibleTagFile() {
  // 只在文件不存在时创建；若已存在，绝不覆盖
  try {
    await fs.access(VISIBLE_TAG_PATH);
  } catch {
    await fs.mkdir(path.dirname(VISIBLE_TAG_PATH), { recursive: true });
    await fs.writeFile(VISIBLE_TAG_PATH, "[]", "utf-8");
  }
}

/* ========== Hashtags 可见清单 ========== */
const HASH_ENV = process.env.VISIBLE_HASH_PATH && process.env.VISIBLE_HASH_PATH.trim();
const HASH_CANDIDATES = [
  HASH_ENV ? path.resolve(HASH_ENV) : null,
  path.resolve("public/data/visible_hashtag_ugc.json"),
  path.resolve("public/visible_hashtag_ugc.json"),
].filter(Boolean);

export const VISIBLE_HASH_PATH = pickExisting(HASH_CANDIDATES);

export async function ensureVisibleHashFile() {
  try {
    await fs.access(VISIBLE_HASH_PATH);
  } catch {
    await fs.mkdir(path.dirname(VISIBLE_HASH_PATH), { recursive: true });
    await fs.writeFile(VISIBLE_HASH_PATH, "[]", "utf-8");
  }
}

/* ========== 兼容旧命名（不要删） ========== */
/* 老代码里可能还在用这些名字： */
export const VISIBLE_PATH = VISIBLE_TAG_PATH;
export async function ensureVisibleFile() { return ensureVisibleTagFile(); }

export const VISIBLE_HASHTAG_PATH = VISIBLE_HASH_PATH;
export async function ensureVisibleHashtagFile() { return ensureVisibleHashFile(); }
