// app/lib/persistPaths.js
import fs from "fs/promises";
import path from "path";

// 优先用环境变量，否则走 /data（Render 挂载点）
const DATA_DIR = process.env.DATA_DIR || "/data";

export const VISIBLE_PATH = path.join(DATA_DIR, "visible.json");
// 如果你还想要缓存文件，也可以一起放到盘上：
// export const CACHE_PATH = path.join(DATA_DIR, "cache_ugc.json");

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
