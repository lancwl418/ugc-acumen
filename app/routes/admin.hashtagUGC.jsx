// app/routes/admin.ugc.jsx
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  Checkbox,
  Button,
  Select,
  Tag,
  InlineStack,
  BlockStack,
  Divider,
} from "@shopify/polaris";
import { useMemo, useState } from "react";
import fs from "fs/promises";
import path from "path";

import {
  VISIBLE_HASHTAG_PATH,
  VISIBLE_TAG_PATH,
  ensureVisibleHashtagFile,
  ensureVisibleTagFile,
} from "../lib/persistPaths.js";

import { fetchHashtagUGC } from "../lib/fetchHashtagUGC.js";
import { fetchTagUGC } from "../lib/fetchTagUGC.js";

/* ----------------- 配置：分类选项 ----------------- */
const CATEGORY_OPTIONS = [
  { label: "Camping Life", value: "camping" },
  { label: "Off-Road", value: "off-road" },
  { label: "Electronics & Gadgets", value: "electronic" },
  { label: "Towing & Trailers", value: "travel" },
  { label: "Documentation", value: "documentation" },
  { label: "Events", value: "events" },
];

/* ----------------- 工具：容错读取 JSON ----------------- */
async function readJsonSafe(file, fallback = "[]") {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw || fallback);
  } catch {
    return JSON.parse(fallback);
  }
}

/* ----------------- Loader：两路池子一起准备 ----------------- */
export async function loader() {
  // 拉最新候选（可按需改策略/limit）
  await Promise.all([
    fetchHashtagUGC({ strategy: "top", limit: 120, outfile: "public/hashtag_ugc.json" }),
    fetchTagUGC({ limit: 120, outfile: "public/tag_ugc.json" }),
  ]);

  // 候选池
  const hashtagPool = await readJsonSafe(path.resolve("public/hashtag_ugc.json"));
  const tagPool     = await readJsonSafe(path.resolve("public/tag_ugc.json"));

  // 已选池
  await Promise.all([ensureVisibleHashtagFile(), ensureVisibleTagFile()]);
  const hashtagVisible = await readJsonSafe(VISIBLE_HASHTAG_PATH);
  const tagVisible     = await readJsonSafe(VISIBLE_TAG_PATH);

  // 产品选项（沿用你首页的 products.json）
  const products = await readJsonSafe(path.resolve("public/products.json"), "[]");

  return json({ hashtagPool, tagPool, hashtagVisible, tagVisible, products });
}

/* ----------------- Action：按 source 写入各自 visible ----------------- */
export async function action({ request }) {
  const fd = await request.formData();
  const source = fd.get("source"); // 'hashtag' | 'tag'
  const entries = fd.getAll("ugc_entry").map((s) => JSON.parse(s));

  // 去重 + 只留必要字段（含兜底字段，便于前端）
  const map = new Map();
  for (const e of entries) {
    map.set(String(e.id), {
      id: String(e.id),
      category: e.category || "camping",
      products: Array.isArray(e.products) ? e.products : [],
      username: e.username || "",
      timestamp: e.timestamp || "",
      media_type: e.media_type || "IMAGE",
      media_url: e.media_url || "",
      caption: e.caption || "",
      permalink: e.permalink || "",
      thumbnail_url: e.thumbnail_url || "",
    });
  }
  const list = Array.from(map.values());

  if (source === "tag") {
    await ensureVisibleTagFile();
    await fs.writeFile(VISIBLE_TAG_PATH, JSON.stringify(list, null, 2), "utf-8");
  } else {
    await ensureVisibleHashtagFile();
    await fs.writeFile(VISIBLE_HASHTAG_PATH, JSON.stringify(list, null, 2), "utf-8");
  }

  return redirect("/admin/ugc");
}

/* ----------------- 页面组件 ----------------- */
export default function AdminUGC() {
  const { hashtagPool, tagPool, hashtagVisible, tagVisible, products } = useLoaderData();
  const fetcher = useFetcher();

  return (
    <Page title="UGC 管理（#Hashtag & @Mentions）">
      <BlockStack gap="400">
        <SectionBlock
          title="🏷️ Hashtag（#）"
          source="hashtag"
          pool={hashtagPool}
          visible={hashtagVisible}
          products={products}
          fetcher={fetcher}
        />
        <Divider />
        <SectionBlock
          title="📣 Mentions（@）"
          source="tag"
          pool={tagPool}
          visible={tagVisible}
          products={products}
          fetcher={fetcher}
        />
      </BlockStack>
    </Page>
  );
}

/* ----------------- 可复用区块 ----------------- */
function SectionBlock({ title, source, pool, visible, products, fetcher }) {
  // Map<id, entry> 用于“是否勾选/默认分类/产品”
  const initialSelected = useMemo(() => {
    const m = new Map();
    (visible || []).forEach((v) => m.set(v.id, v));
    return m;
  }, [visible]);

  const [selected, setSelected] = useState(initialSelected);

  const toggle = (id, seed) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else
        next.set(id, {
          category: "camping",
          products: [],
          // 默认兜底字段带上，方便提交
          id: seed.id,
          username: seed.username || "",
          timestamp: seed.timestamp || "",
          media_type: seed.media_type || "IMAGE",
          media_url: seed.media_url || "",
          thumbnail_url: seed.thumbnail_url || "",
          caption: seed.caption || "",
          permalink: seed.permalink || "",
        });
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

  const changeProducts = (id, handle) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.get(id).products = handle ? [handle] : [];
      return next;
    });
  };

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="source" value={source} />
      <InlineStack align="space-between" blockAlign="center">
        <Text as="h2" variant="headingLg">{title}</Text>
        <Button submit primary>保存到可见列表（{source}）</Button>
      </InlineStack>

      <div
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 24,
        }}
      >
        {pool
          .slice()
          .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""))
          .map((item) => {
            const isVideo = item.media_type === "VIDEO";
            const picked = selected.get(item.id);
            const isChecked = !!picked;
            const category = picked?.category || "camping";
            const chosenProducts = picked?.products || [];
            const thumb = item.thumbnail_url || item.media_url;

            return (
              <Card key={`${source}-${item.id}`} padding="400">
                <BlockStack gap="200">
                  <InlineStack gap="200" blockAlign="center">
                    {source === "hashtag" ? (
                      <Tag>#{item.hashtag || "hashtag"}</Tag>
                    ) : (
                      <Tag>@mention</Tag>
                    )}
                    <Text as="span" variant="bodySm" tone="subdued">
                      {item.timestamp ? new Date(item.timestamp).toLocaleString() : ""}
                    </Text>
                    {item.username && (
                      <Text as="span" variant="bodySm" tone="subdued">
                        @{item.username}
                      </Text>
                    )}
                  </InlineStack>

                  <a href={item.permalink} target="_blank" rel="noreferrer">
                    {isVideo ? (
                      <video
                        controls
                        muted
                        style={{ width: "100%", height: 200, objectFit: "cover", borderRadius: 8 }}
                      >
                        <source src={item.media_url} type="video/mp4" />
                      </video>
                    ) : (
                      <img
                        src={thumb}
                        alt="UGC"
                        style={{ width: "100%", height: 200, objectFit: "cover", borderRadius: 8 }}
                      />
                    )}
                  </a>

                  <Text variant="bodySm" as="p">
                    {item.caption || "无描述"}
                  </Text>

                  <Checkbox
                    label="展示在前台"
                    checked={isChecked}
                    onChange={() => toggle(item.id, item)}
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
                        options={products.map((p) => ({ label: p.title, value: p.handle }))}
                        value={chosenProducts[0] || ""}
                        onChange={(value) => changeProducts(item.id, value)}
                      />

                      <input
                        type="hidden"
                        name="ugc_entry"
                        value={JSON.stringify({
                          id: item.id,
                          category,
                          products: chosenProducts,
                          username: item.username,
                          timestamp: item.timestamp,
                          media_type: item.media_type,
                          media_url: item.media_url,
                          thumbnail_url: item.thumbnail_url,
                          caption: item.caption,
                          permalink: item.permalink,
                        })}
                      />
                    </>
                  )}
                </BlockStack>
              </Card>
            );
          })}
      </div>

      <div style={{ marginTop: 16 }}>
        <Button submit primary>保存到可见列表（{source}）</Button>
        {fetcher.state === "idle" && fetcher.data?.ok && (
          <Text variant="bodyMd" tone="success" style={{ marginLeft: 12 }}>
            ✅ 保存成功！
          </Text>
        )}
      </div>
    </fetcher.Form>
  );
}
