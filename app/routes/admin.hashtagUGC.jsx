import { json } from "@remix-run/node";
import {
  useLoaderData,
  useFetcher,
  useNavigate,
  useLocation,
  useRevalidator,
} from "@remix-run/react";
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
  Spinner,
} from "@shopify/polaris";
import { useEffect, useMemo, useState } from "react";
import fs from "fs/promises";
import path from "path";

import {
  VISIBLE_HASHTAG_PATH,
  VISIBLE_TAG_PATH,
  ensureVisibleHashtagFile,
  ensureVisibleTagFile,
} from "../lib/persistPaths.js";

import {
  fetchHashtagUGCPage,
  fetchTagUGCPage,
} from "../lib/fetchHashtagUGC.js";

/* ----------------- 分类选项 ----------------- */
const CATEGORY_OPTIONS = [
  { label: "Camping Life", value: "camping" },
  { label: "Off-Road", value: "off-road" },
  { label: "Electronics & Gadgets", value: "electronic" },
  { label: "Towing & Trailers", value: "travel" },
  { label: "Documentation", value: "documentation" },
  { label: "Events", value: "events" },
];

async function readJsonSafe(file, fallback = "[]") {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw || fallback);
  } catch {
    return JSON.parse(fallback);
  }
}

/* ----------------- Loader：进入页面/分页 → 直接抓分页数据 ----------------- */
export async function loader({ request }) {
  const url = new URL(request.url);

  // Hashtag：页大小 & 多标签游标（Base64 JSON：{ "<tag>": {topAfter, recentAfter} }）
  const hSize = Math.min(60, Math.max(12, Number(url.searchParams.get("hSize") || 24)));
  const hCursorB64 = url.searchParams.get("hCursor") || "";
  let hCursors = {};
  try { if (hCursorB64) hCursors = JSON.parse(Buffer.from(hCursorB64, "base64").toString("utf-8")); } catch {}

  const strategy = (url.searchParams.get("hStrategy") || "top"); // top|recent|both
  const tagsCsv = url.searchParams.get("hTags") || "";            // 为空则 fallback 到 env

  // Mentions：页大小 & 游标
  const tSize = Math.min(60, Math.max(12, Number(url.searchParams.get("tSize") || 24)));
  const tAfter = url.searchParams.get("tAfter") || "";

  await Promise.all([ensureVisibleHashtagFile(), ensureVisibleTagFile()]);
  const [hashtagVisible, tagVisible, products] = await Promise.all([
    readJsonSafe(VISIBLE_HASHTAG_PATH),
    readJsonSafe(VISIBLE_TAG_PATH),
    readJsonSafe(path.resolve("public/products.json"), "[]"),
  ]);

  // 1) Hashtag：按游标抓一页（多标签合并 + 时间归并）
  const hPage = await fetchHashtagUGCPage({
    tags: tagsCsv || undefined,
    strategy,
    limit: hSize,
    cursors: hCursors,
  }).catch(() => ({ items: [], nextCursors: {} }));

  // 2) Mentions：按游标抓一页
  const tPage = await fetchTagUGCPage({ limit: tSize, after: tAfter }).catch(() => ({
    items: [],
    nextAfter: "",
  }));

  return json(
    {
      hashtag: {
        items: hPage.items,
        visible: hashtagVisible,
        nextCursorB64:
          Buffer.from(JSON.stringify(hPage.nextCursors || {}), "utf-8").toString("base64"),
        strategy,
        tagsCsv,
        pageSize: hSize,
      },
      mentions: {
        items: tPage.items,
        visible: tagVisible,
        nextAfter: tPage.nextAfter || "",
        pageSize: tSize,
        currentAfter: tAfter,
      },
      products,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/* ----------------- Action：保存 & 手动刷新（就地重载，不跳页） ----------------- */
export async function action({ request }) {
  const fd = await request.formData();
  const op = fd.get("op");

  if (op === "refresh") {
    // 轻量预热：抓 hashtag & mentions 首页（失败不抛）
    try {
      await Promise.all([
        fetchHashtagUGCPage({ limit: 24, strategy: "top" }),
        fetchTagUGCPage({ limit: 24 }),
      ]);
    } catch {}
    return json({ ok: true });
  }

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

/* ----------------- 页面组件 ----------------- */
export default function AdminHashtagUGC() {
  const serverData = useLoaderData();
  const [data, setData] = useState(serverData);

  const pager = useFetcher();
  const refresher = useFetcher();
  const saver = useFetcher();
  const navigate = useNavigate();
  const location = useLocation();
  const { revalidate } = useRevalidator();

  useEffect(() => { if (pager.data) setData(pager.data); }, [pager.data]);

  useEffect(() => {
    if (refresher.state === "idle" && refresher.data?.ok) {
      pager.load(`${location.pathname}${location.search}`);
      revalidate();
    }
  }, [refresher.state, refresher.data, pager, location, revalidate]);

  const { hashtag, mentions, products } = data;

  const reloadCurrent = () => pager.load(`${location.pathname}${location.search}`);

  return (
    <Page title="UGC 管理（# Hashtag & @ Mentions 游标分页）">
      <InlineStack align="space-between" blockAlign="center">
        <Text as="h1" variant="headingLg">UGC 管理（# 与 @ 分开分页）</Text>
        <refresher.Form method="post">
          <input type="hidden" name="op" value="refresh" />
          <Button submit loading={refresher.state !== "idle"}>手动刷新池子</Button>
        </refresher.Form>
      </InlineStack>

      {(pager.state !== "idle") && (
        <InlineStack align="center" blockAlign="center" style={{ margin: "12px 0" }}>
          <Spinner accessibilityLabel="加载中" size="small" />
          <Text variant="bodySm" tone="subdued" as="span" style={{ marginLeft: 8 }}>
            加载数据…
          </Text>
        </InlineStack>
      )}

      <BlockStack gap="600">
        {/* Hashtag —— 游标分页（多标签合并） */}
        <div id="hashtag" />
        <SectionHashtag
          title="🏷️ Hashtag（#）"
          source="hashtag"
          data={hashtag}
          products={products}
          saver={saver}
          onNext={() => {
            const usp = new URLSearchParams(window.location.search);
            usp.set("hCursor", hashtag.nextCursorB64 || "");
            usp.set("hSize", String(hashtag.pageSize || 24));
            if (hashtag.strategy) usp.set("hStrategy", hashtag.strategy);
            if (hashtag.tagsCsv) usp.set("hTags", hashtag.tagsCsv);
            navigate(`?${usp.toString()}#hashtag`, { preventScrollReset: true, replace: true });
            reloadCurrent();
          }}
        />

        <Divider />

        {/* Mentions —— 游标分页 */}
        <div id="mentions" />
        <SectionMentions
          title="📣 Mentions（@）"
          source="tag"
          data={mentions}
          products={products}
          saver={saver}
          onNext={() => {
            const usp = new URLSearchParams(window.location.search);
            if (mentions.nextAfter) usp.set("tAfter", mentions.nextAfter);
            usp.set("tSize", String(mentions.pageSize || 24));
            navigate(`?${usp.toString()}#mentions`, { preventScrollReset: true, replace: true });
            reloadCurrent();
          }}
        />
      </BlockStack>
    </Page>
  );
}

/* ----------------- Hashtag 区块 ----------------- */
function SectionHashtag({ title, source, data, products, saver, onNext }) {
  const { items, visible } = data;
  const initialSelected = useMemo(() => {
    const m = new Map(); (visible || []).forEach(v => m.set(v.id, v)); return m;
  }, [visible]);
  const [selected, setSelected] = useState(initialSelected);

  const toggle = (id, seed) => {
    setSelected(prev => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, seedToVisible(seed));
      return next;
    });
  };
  const changeCategory = (id, category) => setSelected(prev => {
    const n = new Map(prev); if (n.has(id)) n.get(id).category = category; return n;
  });
  const changeProducts = (id, handle) => setSelected(prev => {
    const n = new Map(prev); if (n.has(id)) n.get(id).products = handle ? [handle] : []; return n;
  });

  return (
    <saver.Form method="post">
      <input type="hidden" name="source" value={source} />
      <InlineStack align="space-between" blockAlign="center">
        <Text as="h2" variant="headingLg">{title}</Text>
        <Button submit primary>保存到可见列表（{source}）</Button>
      </InlineStack>

      <UGCGrid source={source} pool={items} products={products} selected={selected}
               onToggle={toggle} onChangeCategory={changeCategory} onChangeProducts={changeProducts} />

      <InlineStack align="end" gap="200" style={{ marginTop: 16 }}>
        <Button onClick={onNext}>下一页</Button>
      </InlineStack>
    </saver.Form>
  );
}

/* ----------------- Mentions 区块 ----------------- */
function SectionMentions({ title, source, data, products, saver, onNext }) {
  const { items, visible } = data;
  const initialSelected = useMemo(() => {
    const m = new Map(); (visible || []).forEach(v => m.set(v.id, v)); return m;
  }, [visible]);
  const [selected, setSelected] = useState(initialSelected);

  const toggle = (id, seed) => {
    setSelected(prev => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, seedToVisible(seed));
      return next;
    });
  };
  const changeCategory = (id, category) => setSelected(prev => {
    const n = new Map(prev); if (n.has(id)) n.get(id).category = category; return n;
  });
  const changeProducts = (id, handle) => setSelected(prev => {
    const n = new Map(prev); if (n.has(id)) n.get(id).products = handle ? [handle] : []; return n;
  });

  return (
    <saver.Form method="post">
      <input type="hidden" name="source" value={source} />
      <InlineStack align="space-between" blockAlign="center">
        <Text as="h2" variant="headingLg">{title}</Text>
        <Button submit primary>保存到可见列表（{source}）</Button>
      </InlineStack>

      <UGCGrid source={source} pool={items} products={products} selected={selected}
               onToggle={toggle} onChangeCategory={changeCategory} onChangeProducts={changeProducts} />

      <InlineStack align="end" gap="200" style={{ marginTop: 16 }}>
        <Button onClick={onNext}>下一页</Button>
      </InlineStack>
    </saver.Form>
  );
}

/* ----------------- 共享网格 ----------------- */
function UGCGrid({ source, pool, products, selected, onToggle, onChangeCategory, onChangeProducts }) {
  return (
    <div
      style={{
        marginTop: 16,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
        gap: 24,
      }}
    >
      {pool.map((item) => {
        const isVideo = item.media_type === "VIDEO";
        const picked = selected.get(item.id);
        const isChecked = !!picked;
        const category = picked?.category || "camping";
        const chosenProducts = picked?.products || [];

        const thumbProxy = `/api/ig/media?id=${encodeURIComponent(item.id)}&type=thumb&source=${source}&permalink=${encodeURIComponent(item.permalink || "")}`;
        const rawProxy   = `/api/ig/media?id=${encodeURIComponent(item.id)}&type=raw&source=${source}&permalink=${encodeURIComponent(item.permalink || "")}`;

        return (
          <Card key={`${source}-${item.id}`} padding="400">
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center">
                {source === "hashtag" ? <Tag>#{item.hashtag || "hashtag"}</Tag> : <Tag>@mention</Tag>}
                <Text as="span" variant="bodySm" tone="subdued">
                  {item.timestamp ? new Date(item.timestamp).toLocaleString() : ""}
                </Text>
                {item.username && (
                  <Text as="span" variant="bodySm" tone="subdued">@{item.username}</Text>
                )}
              </InlineStack>

              <a href={item.permalink} target="_blank" rel="noreferrer">
                {isVideo ? (
                  <video
                    controls
                    muted
                    preload="metadata"
                    style={{ width: "100%", height: 200, objectFit: "cover", borderRadius: 8 }}
                  >
                    <source src={rawProxy} type="video/mp4" />
                  </video>
                ) : (
                  <img
                    src={thumbProxy}
                    alt="UGC"
                    loading="lazy"
                    width={640}
                    height={200}
                    style={{ width: "100%", height: 200, objectFit: "cover", borderRadius: 8 }}
                    onError={(e) => { e.currentTarget.src = "/static/ugc-fallback.png"; }}
                  />
                )}
              </a>

              <Text variant="bodySm" as="p">
                {(item.caption || "无描述").slice(0, 160)}
                {item.caption && item.caption.length > 160 ? "…" : ""}
              </Text>

              <Checkbox label="展示在前台" checked={isChecked} onChange={() => onToggle(item.id, item)} />

              {isChecked && (
                <>
                  <Select
                    label="分类"
                    options={CATEGORY_OPTIONS}
                    value={category}
                    onChange={(value) => onChangeCategory(item.id, value)}
                  />
                  <Select
                    label="关联产品"
                    options={products.map((p) => ({ label: p.title, value: p.handle }))}
                    value={chosenProducts[0] || ""}
                    onChange={(value) => onChangeProducts(item.id, value)}
                  />
                  <input
                    type="hidden"
                    name="ugc_entry"
                    value={JSON.stringify(seedToVisible(item, { category, products: chosenProducts }))}
                  />
                </>
              )}
            </BlockStack>
          </Card>
        );
      })}
    </div>
  );
}

function seedToVisible(seed, overrides = {}) {
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
    ...overrides,
  };
}
