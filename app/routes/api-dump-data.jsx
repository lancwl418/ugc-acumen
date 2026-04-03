// 临时 API — 导出 /data 目录下的 JSON 文件，用完后删除此文件
import { json } from "@remix-run/node";
import { readFileSync, readdirSync } from "fs";

export async function loader({ request }) {
  const url = new URL(request.url);
  const file = url.searchParams.get("file");
  const dataDir = "/data";

  try {
    if (!file) {
      const files = readdirSync(dataDir).filter((f) => f.endsWith(".json"));
      return json({ files });
    }

    if (file.includes("..") || file.includes("/")) {
      return json({ error: "invalid file name" }, { status: 400 });
    }

    const content = readFileSync(`${dataDir}/${file}`, "utf-8");
    return new Response(content, {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return json({ error: err.message }, { status: 500 });
  }
}
