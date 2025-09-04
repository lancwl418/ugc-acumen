import { json, redirect } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
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
  TextField,
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

import { fetchHashtagUGC, fetchTagUGC } from "../lib/fetchHashtagUGC.js";

/* ----------------- 分类选项 ----------------- */
const CATEGORY_OPTIONS = [
  { label: "Camping Life", value: "camping" },
  { label: "Off-Road", value: "off-road" },
  { label: "Electronics & Gadgets", value: "electronic" },
  { label: "Towing & Trailers", value: "travel" },
  { label: "Documentation", value: "documentation" },
  { label: "Events", value: "events" },
];

/* ----------------- 工具函数 ----------------- */
async function readJsonSafe(file, fallback = "[]") {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw || fallback);
  } catch {
    return JSON.parse(fallback);
  }
}

/* ----------------- Loader ----------------- */
export async function loader({ request }) {
  const url = new URL(request.url);

  // Hashtag 参数
  const hPage = Math.max(1, Number(url.searchParams.get("hPage") || 1));
  const hSize = Math.min(60, Math.max(12, Number(url.searchParams.get("hSize") || 24)));
  const hQ = (url.searchParams.get("hQ") || "").toLowerCase();

  // Mentions 参数
  const tPage = Math.max(1, Number(url.searchParams.get("tPage") || 1));
  const tSize = Math.min(60, Math.max(12, Number(url.searchParams.get("tSize") || 24)));
  const tQ = (url.searchParams.get("tQ") || "").toLowerCase();

  const HASHTAG_FILE = path.resolve("public/hashtag_ugc.json");
  const TAG_FILE = path.resolve("public/tag_ugc.json");

  // 缓存过期检查
  const statOrNull = async (p) => fs.stat(p).catch(() => null);
  const [hs, ts] = await Promise.all([statOrNull(HASHTAG_FILE), statOrNull(TAG_FILE)]);
  const now = Date.now();
  const staleMs = 10 * 60 * 1000;

  (async () => {
    try {
      if (!hs || now - hs.mtimeMs > staleMs) {
        fetchHashtagUGC({ strategy: "top", limit: 120, outfile: "public/hashtag_ugc.json" });
      }
      if (!ts || now - ts.mtimeMs > staleMs) {
        fetchTagUGC({ limit: 120, outfile: "public/tag_ugc.json" });
      }
    } catch {}
  })();

  const hashtagPool = await readJsonSafe(HASHTAG_FILE);
  const tagPool = await readJsonSafe(TAG_FILE);

  await Promise.all([ensureVisibleHashtagFile(), ensureVisibleTagFile()]);
  const hashtagVisible = await readJsonSafe(VISIBLE_HASHTAG_PATH);
  const tagVisible = await readJsonSafe(VISIBLE_TAG_PATH);

  const products = await readJsonSafe(path.resolve("public/products.json"), "[]");

  // Hashtag 分页
  let hFiltered = hashtagPool.slice();
  if (hQ) {
    hFiltered = hFiltered.filter(
      (i) =>
        (i.caption || "").toLowerCase().includes(hQ) ||
        (i.username || "").toLowerCase().includes(hQ) ||
        (i.hashtag || "").toLowerCase().includes(hQ)
    );
  }
  hFiltered.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
  const hTotal = hFiltered.length;
  const hOffset = (hPage - 1) * hSize;
  const hItems = hFiltered.slice(hOffset, hOffset + hSize);

  // Mentions 分页
  let tFiltered = tagPool.slice();
  if (tQ) {
    tFiltered = tFiltered.filter(
      (i) =>
        (i.caption || "").toLowerCase().includes(tQ) ||
        (i.username || "").toLowerCase().includes(tQ)
    );
  }
  tFiltered.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
  const tTotal = tFiltered.length;
  const tOffset = (tPage - 1) * tSize;
  const tItems = tFiltered.slice(tOffset, tOffset + tSize);

  return json({
    hashtag: { page: hPage, pageSize: hSize, total: hTotal, q: hQ, items: hItems, visible: hashtagVisible },
    mentions: { page: tPage, pageSize: tSize, total: tTotal, q: tQ, items: tItems, visible: tagVisible },
    products,
  });
}

/* ----------------- Action ----------------- */
export async function action({ request }) {
  const fd = await request.formData();
  const op = fd.get("op");
  if (op === "refresh") {
    fetchHashtagUGC({ strategy: "top", limit: 120, outfile: "public/hashtag_ugc.json" }).catch(() => {});
    fetchTagUGC({ limit: 120, outfile: "public/tag_ugc.json" }).catch(() => {});
    return redirect("/admin/ugc");
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

  return redirect("/admin/ugc");
}

/* ----------------- 页面组件 ----------------- */
export default function AdminUGC() {
  const { hashtag, mentions, products } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();

  return (
    <Page title="UGC 管理（# 与 @ 分开分页）">
      <InlineStack align="space-between" blockAlign="center">
        <Text as="h1" variant="headingLg">
          UGC 管理（# 与 @ 分开分页）
        </Text>
        <fetcher.Form method="post">
          <input type="hidden" name="op" value="refresh" />
          <Button submit>手动刷新池子</Button>
        </fetcher.Form>
      </InlineStack>

      <BlockStack gap="600">
        <SectionBlock
          title="🏷️ Hashtag（#）"
          source="hashtag"
          pool={hashtag.items}
          visible={hashtag.visible}
          products={products}
          fetcher={fetcher}
          total={hashtag.total}
          page={hashtag.page}
          pageSize={hashtag.pageSize}
          q={hashtag.q}
          onNavigate={(params) => {
            const usp = new URLSearchParams(window.location.search);
            usp.set("hPage", String(params.page ?? hashtag.page));
            usp.set("hSize", String(params.pageSize ?? hashtag.pageSize));
            if (params.q !== undefined) usp.set("hQ", params.q);
            navigate(`?${usp.toString()}`);
          }}
        />

        <Divider />

        <SectionBlock
          title="📣 Mentions（@）"
          source="tag"
          pool={mentions.items}
          visible={mentions.visible}
          products={products}
          fetcher={fetcher}
          total={mentions.total}
          page={mentions.page}
          pageSize={mentions.pageSize}
          q={mentions.q}
          onNavigate={(params) => {
            const usp = new URLSearchParams(window.location.search);
            usp.set("tPage", String(params.page ?? mentions.page));
            usp.set("tSize", String(params.pageSize ?? mentions.pageSize));
            if (params.q !== undefined) usp.set("tQ", params.q);
            navigate(`?${usp.toString()}`);
          }}
        />
      </BlockStack>
    </Page>
  );
}

/* ----------------- SectionBlock ----------------- */
function SectionBlock({ title, source, pool, visible, products, fetcher, total, page, pageSize, q, onNavigate }) {
  const initialSelected = useMemo(() => {
    const m = new Map();
    (visible || []).forEach((v) => m.set(v.id, v));
    return m;
  }, [visible]);

  const [selected, setSelected] = useState(initialSelected);
  const [search, setSearch] = useState(q || "");

  const toggle = (id, seed) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else
        next.set(id, {
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
        <Text as="h2" variant="headingLg">
          {title}
        </Text>
        <InlineStack gap="200" blockAlign="center">
          <TextField
            placeholder="搜索 caption / 用户 / 标签"
            value={search}
            onChange={(v) => setSearch(v)}
            onBlur={() => onNavigate({ page: 1, q: search })}
          />
          <Button submit primary>
            保存到可见列表（{source}）
          </Button>
        </InlineStack>
      </InlineStack>

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
          const thumbProxy = `/api/ig/media?id=${encodeURIComponent(item.id)}&type=thumb`;
          const rawProxy = `/api/ig/media?id=${encodeURIComponent(item.id)}&type=raw`;

          return (
            <Card key={`${source}-${item.id}`} padding="400">
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center">
                  {source === "hashtag" ? <Tag>#{item.hashtag || "hashtag"}</Tag> : <Tag>@mention</Tag>}
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
                    <video controls muted preload="metadata" style={{ width: "100%", height: 200, objectFit: "cover", borderRadius: 8 }}>
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
                    />
                  )}
                </a>

                <Text variant="bodySm" as="p">
                  {(item.caption || "无描述").slice(0, 160)}
                  {item.caption && item.caption.length > 160 ? "…" : ""}
                </Text>

                <Checkbox label="展示在前台" checked={isChecked} onChange={() => toggle(item.id, item)} />

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

      <InlineStack align="end" gap="200" style={{ marginTop: 16 }}>
        <Text as="span">共 {total} 条</Text>
        <Button disabled={page <= 1} onClick={() => onNavigate({ page: page - 1 })}>
          上一页
        </Button>
        <Button disabled={page * pageSize >= total} onClick={() => onNavigate({ page: page + 1 })}>
          下一页
        </Button>
      </InlineStack>

      <div style={{ marginTop: 16 }}>
        <Button submit primary>
          保存到可见列表（{source}）
        </Button>
      </div>
    </fetcher.Form>
  );
}
