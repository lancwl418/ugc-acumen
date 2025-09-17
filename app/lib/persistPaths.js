// app/lib/persistPaths.js
import fs from "fs/promises";
import path from "path";
import os from "os";

// 优先用环境变量，否则走 /data（Render 挂载点）
export const DATA_DIR = process.env.DATA_DIR || "/data";

export const VISIBLE_PATH          = path.join(DATA_DIR, "visible.json");

// ✅ Hashtag 可见配置
export const VISIBLE_HASHTAG_PATH  = path.join(DATA_DIR, "visible_hashtag.json");

// ✅ Tag / Mentions 可见配置
export const VISIBLE_TAG_PATH      = path.join(DATA_DIR, "visible_tag_ugc.json");

// 如果你还想要缓存文件，也可以一起放到盘上：
// export const CACHE_PATH = path.join(DATA_DIR, "cache_ugc.json");

/* ------------------------------------------------------------------ */
/* 初始化（若不存在则创建）：                                           */
/* ------------------------------------------------------------------ */

// 首次启动时，/data/visible.json 不存在 -> 用仓库里的 public/visible.json 初始化
export async function ensureVisibleFile() {
  try {
    await fs.access(VISIBLE_PATH);
  } catch {
    const fallback = path.resolve("public/visible.json"); // 仓库里的默认文件
    const raw = await fs.readFile(fallback, "utf-8");
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(VISIBLE_PATH, raw, "utf-8");
  }
}

// ✅ 新增：初始化 /data/visible_hashtag.json
export async function ensureVisibleHashtagFile() {
  try {
    await fs.access(VISIBLE_HASHTAG_PATH);
  } catch {
    // 若仓库里有默认文件，就读它；没有就写一个空数组
    const fallback = path.resolve("public/visible_hashtag.json");
    let raw = "[]";
    try {
      raw = await fs.readFile(fallback, "utf-8");
    } catch {}
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(VISIBLE_HASHTAG_PATH, raw, "utf-8");
  }
}

// ✅ 新增：初始化 /data/visible_tag_ugc.json
export async function ensureVisibleTagFile() {
  try {
    await fs.access(VISIBLE_TAG_PATH);
  } catch {
    const fallback = path.resolve("public/visible_tag_ugc.json");
    let raw = "[]";
    try {
      raw = await fs.readFile(fallback, "utf-8");
    } catch {}
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(VISIBLE_TAG_PATH, raw, "utf-8");
  }
}

/* ------------------------------------------------------------------ */
/* 读取工具：                                                          */
/* ------------------------------------------------------------------ */

export async function readVisibleHashtag() {
  await ensureVisibleHashtagFile();
  try {
    const raw = await fs.readFile(VISIBLE_HASHTAG_PATH, "utf-8");
    return JSON.parse(raw || "[]");
  } catch {
    return [];
  }
}

export async function readVisibleTag() {
  await ensureVisibleTagFile();
  try {
    const raw = await fs.readFile(VISIBLE_TAG_PATH, "utf-8");
    return JSON.parse(raw || "[]");
  } catch {
    return [];
  }
}

export async function readVisible() {
  await ensureVisibleFile();
  try {
    const raw = await fs.readFile(VISIBLE_PATH, "utf-8");
    return JSON.parse(raw || "[]");
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* 原子写入（tmp 写入 + rename，避免并发/中断导致文件损坏）：          */
/* ------------------------------------------------------------------ */

async function atomicWrite(targetPath, list) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tmp = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${Date.now()}.${process.pid}.tmp`
  );
  const data = JSON.stringify(list ?? [], null, 2) + os.EOL;
  await fs.writeFile(tmp, data, "utf-8");
  await fs.rename(tmp, targetPath);
}

export async function writeVisibleHashtagAtomic(list) {
  await ensureVisibleHashtagFile();
  await atomicWrite(VISIBLE_HASHTAG_PATH, list);
}

export async function writeVisibleTagAtomic(list) {
  await ensureVisibleTagFile();
  await atomicWrite(VISIBLE_TAG_PATH, list);
}

export async function writeVisibleAtomic(list) {
  await ensureVisibleFile();
  await atomicWrite(VISIBLE_PATH, list);
}
