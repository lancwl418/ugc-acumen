import { json } from "@remix-run/node";
import { useLoaderData, Form, useFetcher } from "@remix-run/react";
import {
  Page,
  Card,
  Thumbnail,
  Text,
  Checkbox,
  Button,
  Select,
  Tag,
} from "@shopify/polaris";
import { useState } from "react";
import fs from "fs/promises";
import path from "path";
import { VISIBLE_PATH, ensureVisibleFile } from "../lib/persistPaths";
import { fetchInstagramUGC } from "../lib/fetchInstagram.js";

const CATEGORY_OPTIONS = [
  { label: "Camping", value: "camping" },
  { label: "Off-Road", value: "off-road" },
  { label: "Travel", value: "travel" },
];

export async function loader() {
  // 拉取最新 Instagram 内容
  await fetchInstagramUGC();

  const ugcRaw = await fs.readFile(path.resolve("public/ugc.json"), "utf-8");
  // 确保 /data/visible.json 存在（不存在则用 public/visible.json 初始化）
  await ensureVisibleFile();
  const visibleRaw = await fs.readFile(VISIBLE_PATH, "utf-8");
  const productsRaw = await fs.readFile(path.resolve("public/products.json"), "utf-8");

  const all = JSON.parse(ugcRaw);
  const visible = JSON.parse(visibleRaw);
  const products = JSON.parse(productsRaw);

  return json({ all, visible, products });
}

export async function action({ request }) {
  const form = await request.formData();
  const entries = form.getAll("ugc_entry");
  const parsed = entries.map((entry) => JSON.parse(entry));

  await fs.writeFile(VISIBLE_PATH, JSON.stringify(parsed, null, 2), "utf-8");

  return json({ ok: true });
}

export default function AdminUGC() {
  const fetcher = useFetcher();
  const { all, visible, products } = useLoaderData();

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
    <Page title="📸 UGC 内容管理">
      <fetcher.Form method="post">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: "24px",
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

              return (
                <Card key={item.id} padding="400">
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <a href={item.permalink} target="_blank" rel="noreferrer">
                      {item.media_type === "VIDEO" ? (
                        <video
                          controls
                          muted
                          style={{
                            width: "100%",
                            height: "200px",
                            objectFit: "cover",
                            borderRadius: "8px",
                          }}
                        >
                          <source src={item.media_url} type="video/mp4" />
                        </video>
                      ) : (
                        <img
                          src={item.media_url}
                          alt="UGC 内容"
                          style={{
                            width: "100%",
                            height: "200px",
                            objectFit: "cover",
                            borderRadius: "8px",
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
                          })}
                        />
                      </>
                    )}
                  </div>
                </Card>
              );
            })}
        </div>
        <div style={{ marginTop: "24px" }}>
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
