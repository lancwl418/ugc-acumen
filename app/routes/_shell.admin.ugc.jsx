import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page, Card, Text, Checkbox, Button, Select, Tag,
} from "@shopify/polaris";
import { useState } from "react";
import { fetchInstagramUGC } from "../lib/fetchInstagram.js";
import { getAllVisible, upsertManyVisible, getProducts } from "../lib/visibleMentions.js";

const CATEGORY_OPTIONS = [
  { label: "Camping", value: "camping" },
  { label: "Off-Road", value: "off-road" },
  { label: "Travel", value: "travel" },
];

export async function loader() {
  const [all, visible, products] = await Promise.all([
    fetchInstagramUGC(),
    getAllVisible(),
    getProducts(),
  ]);
  return json({ all, visible, products });
}

export async function action({ request }) {
  const form = await request.formData();
  const entries = form.getAll("ugc_entry").map((entry) => JSON.parse(entry));

  const visibleEntries = entries.map((e) => ({
    id: String(e.id),
    category: e.category || "camping",
    products: Array.isArray(e.products) ? e.products : [],
    username: e.username || "",
    timestamp: e.timestamp || "",
    media_type: e.media_type || "IMAGE",
    media_url: e.media_url || "",
    thumbnail_url: e.thumbnail_url || "",
    caption: e.caption || "",
    permalink: e.permalink || "",
  }));

  await upsertManyVisible(visibleEntries);
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

  const toggle = (id, item) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, {
        category: "camping",
        products: [],
        username: item.username || "",
        timestamp: item.timestamp || "",
        media_type: item.media_type || "IMAGE",
        media_url: item.media_url || "",
        thumbnail_url: item.thumbnail_url || "",
        caption: item.caption || "",
        permalink: item.permalink || "",
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

  const changeProducts = (id, value) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.get(id).products = [value];
      return next;
    });
  };

  return (
    <Page title="Self Account Content Management">
      <fetcher.Form method="post">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: "24px",
          }}
        >
          {all
            .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""))
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
                          controls muted
                          style={{ width: "100%", height: "200px", objectFit: "cover", borderRadius: "8px" }}
                        >
                          <source src={item.media_url} type="video/mp4" />
                        </video>
                      ) : (
                        <img
                          src={item.media_url}
                          alt="UGC"
                          style={{ width: "100%", height: "200px", objectFit: "cover", borderRadius: "8px" }}
                        />
                      )}
                    </a>
                    <Text variant="bodySm" as="p">
                      {item.caption || "No description"}
                    </Text>
                    <Checkbox
                      label="Show on site"
                      checked={isChecked}
                      onChange={() => toggle(item.id, item)}
                    />
                    {isChecked && (
                      <>
                        <Select
                          label="Category"
                          options={CATEGORY_OPTIONS}
                          value={category}
                          onChange={(value) => changeCategory(item.id, value)}
                        />
                        <Select
                          label="Linked Product"
                          options={products.map((p) => ({ label: p.title, value: p.handle }))}
                          value={selectedProducts[0] || ""}
                          onChange={(value) => changeProducts(item.id, value)}
                        />
                        <input
                          type="hidden"
                          name="ugc_entry"
                          value={JSON.stringify({
                            id: item.id,
                            category,
                            products: selectedProducts,
                            username: item.username || "",
                            timestamp: item.timestamp || "",
                            media_type: item.media_type || "IMAGE",
                            media_url: item.media_url || "",
                            thumbnail_url: item.thumbnail_url || "",
                            caption: item.caption || "",
                            permalink: item.permalink || "",
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
            Save visible items
          </Button>
          {fetcher.state === "idle" && fetcher.data?.ok && (
            <Text variant="bodyMd" tone="success">
              Saved successfully!
            </Text>
          )}
        </div>
      </fetcher.Form>
    </Page>
  );
}
