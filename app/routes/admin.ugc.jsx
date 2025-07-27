import { json } from "@remix-run/node";
import { useLoaderData, Form } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  Checkbox,
  Button,
  Select,
  OptionList,
  TextContainer,
} from "@shopify/polaris";
import { useState, useEffect } from "react";
import fs from "fs/promises";
import path from "path";
import { fetchInstagramUGC } from "../lib/fetchInstagram.js";
import { useFetcher } from "@remix-run/react";

const CATEGORY_OPTIONS = [
  { label: "Camping", value: "camping" },
  { label: "Off-Road", value: "off-road" },
  { label: "Travel", value: "travel" },
];

export async function loader() {
  // 拉取最新 Instagram 内容
  await fetchInstagramUGC();

  // 读取最新 UGC 内容
  const ugcRaw = await fs.readFile(path.resolve("public/ugc.json"), "utf-8");
  const visibleRaw = await fs.readFile(
    path.resolve("public/visible.json"),
    "utf-8"
  );
  const productRaw = await fs.readFile(
    path.resolve("public/products.json"),
    "utf-8"
  );

  const all = JSON.parse(ugcRaw);
  const visible = JSON.parse(visibleRaw);
  const products = JSON.parse(productRaw); // 产品列表

  return json({ all, visible, products });
}

export async function action({ request }) {
  const form = await request.formData();
  const entries = form.getAll("ugc_entry");
  const parsed = entries.map((entry) => JSON.parse(entry));

  // 保存 visible.json
  await fs.writeFile(
    path.resolve("public/visible.json"),
    JSON.stringify(parsed, null, 2),
    "utf-8"
  );

  return json({ ok: true });
}

export default function AdminUGC() {
  const fetcher = useFetcher();
  const { all, visible, products } = useLoaderData();

  const [selected, setSelected] = useState(() => {
    const map = new Map();
    visible.forEach((entry) =>
      map.set(entry.id, { category: entry.category, productHandles: entry.products || [] })
    );
    return map;
  });

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, { category: "camping", productHandles: [] });
      return next;
    });
  };

  const changeCategory = (id, category) => {
    setSelected((prev) => {
      const next = new Map(prev);
      const current = next.get(id) || {};
      next.set(id, { ...current, category });
      return next;
    });
  };

  const changeProducts = (id, productHandles) => {
    setSelected((prev) => {
      const next = new Map(prev);
      const current = next.get(id) || {};
      next.set(id, { ...current, productHandles });
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
              const isChecked = selected.has(item.id);
              const entry = selected.get(item.id) || {
                category: "camping",
                productHandles: [],
              };

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
                          value={entry.category}
                          onChange={(value) => changeCategory(item.id, value)}
                        />
                        <OptionList
                          title="关联产品"
                          onChange={(value) => changeProducts(item.id, value)}
                          selected={entry.productHandles}
                          options={products.map((p) => ({
                            value: p.handle,
                            label: p.title,
                          }))}
                        />
                        <input
                          type="hidden"
                          name="ugc_entry"
                          value={JSON.stringify({
                            id: item.id,
                            category: entry.category,
                            products: entry.productHandles,
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
