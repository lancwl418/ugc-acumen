// app/routes/admin.hashtagugc.jsx
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate, useLocation } from "@remix-run/react";
import { Page, Card, Text, Checkbox, Button, Select, Tag, InlineStack, BlockStack, Divider } from "@shopify/polaris";
import { useMemo, useState, useEffect } from "react";
import fs from "fs/promises";
import path from "path";
import { VISIBLE_HASHTAG_PATH, VISIBLE_TAG_PATH, ensureVisibleHashtagFile, ensureVisibleTagFile } from "../lib/persistPaths.js";
import { fetchHashtagUGCPage, fetchTagUGCPage } from "../lib/fetchHashtagUGC.js";

const CATEGORY_OPTIONS = [
  { label: "Camping Life", value: "camping" },
  { label: "Off-Road", value: "off-road" },
  { label: "Electronics & Gadgets", value: "electronic" },
  { label: "Towing & Trailers", value: "travel" },
  { label: "Documentation", value: "documentation" },
  { label: "Events", value: "events" },
];

async function readJsonSafe(file, fallback = "[]") {
  try { return JSON.parse(await fs.readFile(file, "utf-8") || fallback); } catch { return JSON.parse(fallback); }
}

export async function loader({ request }) {
  const url = new URL(request.url);

  const hSize = Math.min(40, Math.max(6, Number(url.searchParams.get("hSize") || 10)));
  const hCursorB64 = url.searchParams.get("hCursor") || "";
  let hCursors = {};
  try { if (hCursorB64) hCursors = JSON.parse(Buffer.from(hCursorB64, "base64").toString("utf-8")); } catch {}

  const tSize  = Math.min(40, Math.max(6, Number(url.searchParams.get("tSize") || 10)));
  const tAfter = url.searchParams.get("tAfter") || "";

  await Promise.all([ensureVisibleHashtagFile(), ensureVisibleTagFile()]);
  const [hashtagVisible, tagVisible, products] = await Promise.all([
    readJsonSafe(VISIBLE_HASHTAG_PATH),
    readJsonSafe(VISIBLE_TAG_PATH),
    readJsonSafe(path.resolve("public/products.json"), "[]"),
  ]);

  const [hPage, tPage] = await Promise.all([
    fetchHashtagUGCPage({ limit: hSize, cursors: hCursors }).catch(() => ({ items: [], nextCursors: {} })),
    fetchTagUGCPage({ limit: tSize, after: tAfter }).catch(() => ({ items: [], nextAfter: "" })),
  ]);

  return json({
    hashtag: {
      items: hPage.items,
      visible: hashtagVisible,
      nextCursorB64: Buffer.from(JSON.stringify(hPage.nextCursors || {}), "utf-8").toString("base64"),
      pageSize: hSize,
    },
    mentions: {
      items: tPage.items,
      visible: tagVisible,
      nextAfter: tPage.nextAfter || "",
      pageSize: tSize,
    },
    products,
  });
}

export async function action({ request }) {
  const fd = await request.formData();
  const source = fd.get("source");
  const entries = fd.getAll("ugc_entry").map((s) => JSON.parse(s));

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

  return json({ ok: true });
}

export default function AdminHashtagUGC() {
  const data = useLoaderData();
  const saver = useFetcher();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Page title="UGC 管理（# 与 @ 分开分页）">
      <BlockStack gap="600">
        <div id="hashtag" />
        <Section
          title="🏷️ Hashtag（#）"
          source="hashtag"
          pool={data.hashtag.items}
          visible={data.hashtag.visible}
          products={data.products}
          saver={saver}
        />
        <InlineStack align="end"><Button onClick={() => {
          const usp = new URLSearchParams(location.search);
          usp.set("hCursor", data.hashtag.nextCursorB64 || "");
          usp.set("hSize", String(data.hashtag.pageSize || 10));
          navigate(`?${usp.toString()}#hashtag`, { preventScrollReset: true, replace: true });
        }}>下一页</Button></InlineStack>

        <Divider />

        <div id="mentions" />
        <Section
          title="📣 Mentions（@）"
          source="tag"
          pool={data.mentions.items}
          visible={data.mentions.visible}
          products={data.products}
          saver={saver}
        />
        <InlineStack align="end"><Button onClick={() => {
          const usp = new URLSearchParams(location.search);
          if (data.mentions.nextAfter) usp.set("tAfter", data.mentions.nextAfter);
          usp.set("tSize", String(data.mentions.pageSize || 10));
          navigate(`?${usp.toString()}#mentions`, { preventScrollReset: true, replace: true });
        }}>下一页</Button></InlineStack>
      </BlockStack>
    </Page>
  );
}

function Section({ title, source, pool, visible, products, saver }) {
  const initialSelected = useMemo(() => {
    const m = new Map(); (visible || []).forEach(v => m.set(v.id, v)); return m;
  }, [visible]);
  const [selected, setSelected] = useState(initialSelected);

  const toggle = (id, seed) => setSelected(prev => {
    const n = new Map(prev);
    if (n.has(id)) n.delete(id);
    else n.set(id, seedToVisible(seed));
    return n;
  });

  const changeCategory = (id, category) =>
    setSelected(prev => { const n = new Map(prev); if (n.has(id)) n.get(id).category = category; return n; });

  const changeProducts = (id, handle) =>
    setSelected(prev => { const n = new Map(prev); if (n.has(id)) n.get(id).products = handle ? [handle] : []; return n; });

  return (
    <saver.Form method="post">
      <input type="hidden" name="source" value={source} />
      <InlineStack align="space-between">
        <Text as="h2" variant="headingLg">{title}</Text>
        <Button submit primary>保存到可见列表（{source}）</Button>
      </InlineStack>

      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 24 }}>
        {pool.map((item) => {
          const isVideo = item.media_type === "VIDEO";
          const picked = selected.get(item.id);
          const isChecked = !!picked;
          const category = picked?.category || "camping";
          const chosenProducts = picked?.products || [];

          // # 直链；@ 用代理
          const hashtagThumb = item.thumbnail_url || item.media_url || "";
          const hashtagRaw   = item.media_url || "";
          const tagThumbProxy = `/api/ig/media?id=${encodeURIComponent(item.id)}&type=thumb&source=tag&permalink=${encodeURIComponent(item.permalink || "")}`;
          const tagRawProxy   = `/api/ig/media?id=${encodeURIComponent(item.id)}&type=raw&source=tag&permalink=${encodeURIComponent(item.permalink || "")}`;

          const imgSrc   = source === "hashtag" ? (hashtagThumb || "") : tagThumbProxy;
          const videoSrc = source === "hashtag" ? (hashtagRaw || "")   : tagRawProxy;

          return (
            <Card key={`${source}-${item.id}`} padding="400">
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center">
                  {source === "hashtag" ? <Tag>#{item.hashtag || "hashtag"}</Tag> : <Tag>@mention</Tag>}
                  <Text as="span" variant="bodySm" tone="subdued">{item.timestamp ? new Date(item.timestamp).toLocaleString() : ""}</Text>
                  {item.username && <Text as="span" variant="bodySm" tone="subdued">@{item.username}</Text>}
                </InlineStack>

                <a href={item.permalink} target="_blank" rel="noreferrer">
                  {isVideo ? (
                    <video controls muted preload="metadata" playsInline style={{ width: "100%", height: 200, objectFit: "cover", borderRadius: 8 }}>
                      <source src={videoSrc} type="video/mp4" />
                    </video>
                  ) : (
                    <img
                      src={imgSrc}
                      alt="UGC"
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      style={{ width: "100%", height: 200, objectFit: "cover", borderRadius: 8 }}
                    />
                  )}
                </a>

                <Text variant="bodySm" as="p">{(item.caption || "无描述").slice(0, 160)}{item.caption && item.caption.length > 160 ? "…" : ""}</Text>

                <Checkbox label="展示在前台" checked={isChecked} onChange={() => toggle(item.id, item)} />

                {isChecked && <>
                  <Select label="分类" options={CATEGORY_OPTIONS} value={category} onChange={(v) => changeCategory(item.id, v)} />
                  <Select label="关联产品" options={products.map((p) => ({ label: p.title, value: p.handle }))} value={chosenProducts[0] || ""} onChange={(v) => changeProducts(item.id, v)} />
                  <input type="hidden" name="ugc_entry" value={JSON.stringify({
                    id: item.id, category, products: chosenProducts, username: item.username, timestamp: item.timestamp,
                    media_type: item.media_type, media_url: item.media_url, thumbnail_url: item.thumbnail_url, caption: item.caption, permalink: item.permalink,
                  })} />
                </>}
              </BlockStack>
            </Card>
          );
        })}
      </div>
    </saver.Form>
  );
}

function seedToVisible(seed) {
  return {
    category: "camping",
    products: [],
    id: seed.id,
    username: seed.username || "",
    timestamp: seed.timestamp || "",
    media_type: seed.media_type || "IMAGE",
    media_url: seed.media_url || "",
    thumbnail_url: seed.thumbnail_url || "",
    caption: seed.caption || "",
    permalink: seed.permalink || "",
  };
}
