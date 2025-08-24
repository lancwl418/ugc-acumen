// app/routes/admin.hashtagUGC.jsx
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  Checkbox,
  Button,
  Select,
  Tag,
} from "@shopify/polaris";
import { useState } from "react";
import fs from "fs/promises";
import path from "path";

import {
  VISIBLE_HASHTAG_PATH,
  ensureVisibleHashtagFile,
} from "../lib/persistPaths.js";
import { fetchHashtagUGC } from "../lib/fetchHashtagUGC.js";

/* ----------------- 配置：分类选项 ----------------- */
const CATEGORY_OPTIONS = [
  { label: "Camping Life", value: "camping" },
  { label: "Off-Road", value: "off-road" },
  { label: "Electronics & Gadgets", value: "electronic" },
  { label: "Towing & Trailers", value: "travel" },
  { label: "Documentation", value: "documentation" },
  { label: "Events", value: "events" }
];

/* ----------------- 工具：容错读取 JSON（带重试/兜底） ----------------- */
async function readJsonSafe(file, fallback = "[]", retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const raw = await fs.readFile(file, "utf-8");
      if (!raw || !raw.trim()) throw new Error("empty json file");
      return JSON.parse(raw);
    } catch (e) {
      if (i === retries - 1) {
        console.warn(`⚠️ 读取 ${file} 失败，使用兜底：`, e.message);
        try {
          return JSON.parse(fallback);
        } catch {
          return [];
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return [];
}

/* ----------------- Loader：抓取并读取数据 ----------------- */
export async function loader() {
  // 1) 抓最新 hashtag 内容（可改成 "both" 或 "recent"）
  await fetchHashtagUGC({ strategy: "top", limit: 120 });

  // 2) 读取抓取结果（容错）
  const all = await readJsonSafe(path.resolve("public/hashtag_ugc.json"));

  // 3) 确保 /data/visible_hashtag.json 存在，并读取（容错）
  await ensureVisibleHashtagFile();
  const visible = await readJsonSafe(VISIBLE_HASHTAG_PATH);

  // 4) 产品列表（与 admin.ugc.jsx 一致）
  const products = await readJsonSafe(
    path.resolve("public/products.json"),
    "[]"
  );

  return json({ all, visible, products });
}

/* ----------------- Action：保存选中可见项 ----------------- */
export async function action({ request }) {
  const form = await request.formData();
  const entries = form.getAll("ugc_entry");
  const parsed = entries.map((entry) => JSON.parse(entry));

  await fs.writeFile(
    VISIBLE_HASHTAG_PATH,
    JSON.stringify(parsed, null, 2),
    "utf-8"
  );

  return json({ ok: true });
}

/* ----------------- 页面组件 ----------------- */
export default function AdminHashtagUGC() {
  const fetcher = useFetcher();
  const { all, visible, products } = useLoaderData();

  // map<media_id, { category, products[] }>
  const [selected, setSelected] = useState(() => {
    const map = new Map();
    visible.forEach((entry) => map.set(entry.id, entry));
    return map;
  });

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, { category: "camping", products: [] });
      return next;
    });
  };

  const changeCategory = (id, category) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.get(id).category = category;
      return next;
    });
  };

  const changeProducts = (id, value) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.get(id).products = value;
      return next;
    });
  };

  return (
    <Page title="🏷️ Hashtag UGC 管理">
      <fetcher.Form method="post">
         <div style={{ marginTop: 24 }}>
          <Button primary submit>
            ✅ 保存展示项
          </Button>
          {fetcher.state === "idle" && fetcher.data?.ok && (
            <Text variant="bodyMd" tone="success">
              ✅ 保存成功！
            </Text>
          )}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 24,
          }}
        >
          {all
            .sort((a, b) =>
              (b.timestamp || "").localeCompare(a.timestamp || "")
            )
            .map((item) => {
              const entry = selected.get(item.id);
              const isChecked = !!entry;
              const category = entry?.category || "camping";
              const selectedProducts = entry?.products || [];
              const isVideo = item.media_type === "VIDEO";

              return (
                <Card key={item.id} padding="400">
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <Tag>#{item.hashtag || process.env.HASHTAG || "hashtag"}</Tag>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {item.timestamp
                          ? new Date(item.timestamp).toLocaleString()
                          : ""}
                      </Text>
                    </div>

                    <a href={item.permalink} target="_blank" rel="noreferrer">
                      {isVideo ? (
                        <video
                          controls
                          muted
                          style={{
                            width: "100%",
                            height: 200,
                            objectFit: "cover",
                            borderRadius: 8,
                          }}
                        >
                          <source src={item.media_url} type="video/mp4" />
                        </video>
                      ) : (
                        <img
                          src={item.media_url}
                          alt="Hashtag UGC"
                          style={{
                            width: "100%",
                            height: 200,
                            objectFit: "cover",
                            borderRadius: 8,
                          }}
                        />
                      )}
                    </a>

                    <Text variant="bodySm" as="p">
                      {item.caption || "无描述"}
                    </Text>

                    <Checkbox
                      label="展示在前台"
                      checked={isChecked}
                      onChange={() => toggle(item.id)}
                    />

                    {isChecked && (
                      <>
                        <Select
                          label="分类"
                          options={CATEGORY_OPTIONS}
                          value={category}
                          onChange={(value) => changeCategory(item.id, value)}
                        />

                        <Select
                          label="关联产品"
                          options={products.map((p) => ({
                            label: p.title,
                            value: p.handle,
                          }))}
                          value={selectedProducts}
                          onChange={(value) => changeProducts(item.id, [value])}
                        />

                        <input
                          type="hidden"
                          name="ugc_entry"
                          value={JSON.stringify({
                            id: item.id,
                            category,
                            products: selectedProducts,
                            username: item.username,
                            timestamp: item.timestamp,
                            media_type: item.media_type,
                            media_url: item.media_url,
                            caption: item.caption,
                            permalink: item.permalink
                          })}
                        />
                      </>
                    )}
                  </div>
                </Card>
              );
            })}
        </div>

        <div style={{ marginTop: 24 }}>
          <Button primary submit>
            ✅ 保存展示项
          </Button>
          {fetcher.state === "idle" && fetcher.data?.ok && (
            <Text variant="bodyMd" tone="success">
              ✅ 保存成功！
            </Text>
          )}
        </div>
      </fetcher.Form>
    </Page>
  );
}
