// app/routes/_shell.admin.mentionsugc.jsx
import { defer, json } from "@remix-run/node";
import {
  useLoaderData,
  useFetcher,
  useNavigate,
  useLocation,
  useNavigation,
  Await,
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
  SkeletonBodyText,
} from "@shopify/polaris";
import { Suspense, useMemo, useState, useEffect } from "react";
import fs from "fs/promises";
import path from "path";

import {
  VISIBLE_TAG_PATH,
  ensureVisibleTagFile,
} from "../lib/persistPaths.js";
import {
  fetchTagUGCPage,
  fillMissingMediaOnce,
} from "../lib/fetchHashtagUGC.js";
import { memo } from "../lib/memo.js";

/* ---------- Constants ---------- */
const CATEGORY_OPTIONS = [
  { label: "Camping Life", value: "camping" },
  { label: "Off-Road", value: "off-road" },
  { label: "Electronics & Gadgets", value: "electronic" },
  { label: "Towing & Trailers", value: "travel" },
  { label: "Documentation", value: "documentation" },
  { label: "Events", value: "events" },
];
const TINY =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";

/* ---------- Utils ---------- */
async function readJsonSafe(file, fallback = "[]") {
  try {
    return JSON.parse((await fs.readFile(file, "utf-8")) || fallback);
  } catch {
    return JSON.parse(fallback);
  }
}
function readStackSS(key) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function writeStackSS(key, arr) {
  try {
    sessionStorage.setItem(key, JSON.stringify(arr));
  } catch {}
}

/* ---------- Loader with defer ---------- */
export async function loader({ request }) {
  const url = new URL(request.url);

  const tSize = Math.min(40, Math.max(6, Number(url.searchParams.get("tSize") || 12)));
  const tAfter = url.searchParams.get("tAfter") || "";

  await ensureVisibleTagFile();
  const [tagVisible, products] = await Promise.all([
    readJsonSafe(VISIBLE_TAG_PATH),
    readJsonSafe(path.resolve("public/products.json"), "[]"),
  ]);

  const mentionsPromise = (async () => {
    const tPage = await memo(
      `t:${tSize}:${tAfter || "-"}`,
      30_000,
      () => fetchTagUGCPage({ limit: tSize, after: tAfter })
    ).catch(() => ({ items: [], nextAfter: "" }));

    const items = await Promise.all(
      (tPage.items || []).map((it) =>
        it.media_url || it.thumbnail_url ? it : fillMissingMediaOnce(it, { source: "tag" })
      )
    );

    return {
      items,
      nextAfter: tPage.nextAfter || "",
      pageSize: tSize,
    };
  })();

  return defer(
    {
      mentions: mentionsPromise, // Promise
      visible: tagVisible,       // small data first
      products,
    },
    { headers: { "Cache-Control": "private, max-age=30" } }
  );
}

/* ---------- Action（改为合并写入 / 支持 replace） ---------- */
export async function action({ request }) {
  const fd = await request.formData();
  const op = fd.get("op");
  if (op === "refresh") {
    try { await fetchTagUGCPage({ limit: 6 }); } catch {}
    return json({ ok: true });
  }

  // 默认合并写入；传 mode=replace 可全量覆盖
  const mode = String(fd.get("mode") || "merge").toLowerCase();

  const entries = fd.getAll("ugc_entry").map((s) => {
    const e = JSON.parse(s);
    return {
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
      updated_at: new Date().toISOString()
    };
  });

  await ensureVisibleTagFile();

  if (mode === "replace") {
    await fs.writeFile(VISIBLE_TAG_PATH, JSON.stringify(entries, null, 2), "utf-8");
    return json({ ok: true, mode: "replace", count: entries.length });
  }

  //  merge（upsert by id）
  let existing = [];
  try {
    existing = JSON.parse(await fs.readFile(VISIBLE_TAG_PATH, "utf-8")) || [];
  } catch {
    existing = [];
  }
  const merged = new Map(existing.map((x) => [String(x.id), x]));
  for (const e of entries) merged.set(String(e.id), e);

  const toWrite = Array.from(merged.values());
  await fs.writeFile(VISIBLE_TAG_PATH, JSON.stringify(toWrite, null, 2), "utf-8");
  return json({ ok: true, mode: "merge", count: entries.length, total: toWrite.length });
}

/* ---------- Page ---------- */
export default function AdminMentionsUGC() {
  const data = useLoaderData(); // { mentions: Promise, visible, products }
  const saver = useFetcher();
  const refresher = useFetcher();
  const navigation = useNavigation();

  return (
    <Page>
      <InlineStack align="space-between" blockAlign="center">
        <Text as="h1" variant="headingLg">UGC Admin — Mentions (@)</Text>
        <refresher.Form method="post">
          <input type="hidden" name="op" value="refresh" />
          <Button submit loading={refresher.state !== "idle"}>Refresh Mentions Pool</Button>
        </refresher.Form>
      </InlineStack>

      <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 120px)", marginTop: 16 }}>
        <div style={{ flex: "1 1 auto" }}>
          <Suspense fallback={<GridSkeleton />}>
            <Await resolve={data.mentions}>
              {(m) => (
                <>
                  <BlockStack gap="400" id="tab-mentions">
                    <Section
                      title="📣 Mentions (@)"
                      source="tag"
                      pool={m.items}
                      visible={data.visible}
                      products={data.products}
                      saver={saver}
                    />
                  </BlockStack>

                  <Pager
                    view={m}
                    routeLoading={navigation.state !== "idle"}
                    hash="#mentions"
                    stackKey="ugc:tStack"
                  />
                </>
              )}
            </Await>
          </Suspense>
        </div>
      </div>
    </Page>
  );
}

/* ---------- Pager ---------- */
function Pager({ view, routeLoading, hash, stackKey }) {
  const navigate = useNavigate();
  const location = useLocation();
  const navigation = useNavigation();
  const [busy, setBusy] = useState(false);

  const canPrev = (readStackSS(stackKey).length > 0);

  const goNext = () => {
    if (routeLoading || busy) return;
    setBusy(true);
    const usp = new URLSearchParams(location.search);
    const stack = readStackSS(stackKey);
    stack.push(usp.get("tAfter") || "");
    writeStackSS(stackKey, stack);

    if (view.nextAfter) usp.set("tAfter", view.nextAfter);
    else usp.delete("tAfter");
    usp.set("tSize", String(view.pageSize || 12));

    navigate(`?${usp.toString()}${hash}`, { preventScrollReset: true });
  };

  const goPrev = () => {
    if (routeLoading || busy) return;
    const stack = readStackSS(stackKey);
    if (stack.length === 0) return;
    setBusy(true);
    const prevAfter = stack.pop() || "";
    writeStackSS(stackKey, stack);

    const usp = new URLSearchParams(location.search);
    if (prevAfter) usp.set("tAfter", prevAfter);
    else usp.delete("tAfter");
    usp.set("tSize", String(view.pageSize || 12));

    navigate(`?${usp.toString()}${hash}`, { preventScrollReset: true });
  };

  useEffect(() => {
    if (navigation.state === "idle") setBusy(false);
  }, [navigation.state]);

  return (
    <div style={{ borderTop: "1px solid var(--p-color-border, #e1e3e5)", padding: "12px 0", marginTop: 16 }}>
      <InlineStack align="center" gap="200">
        <Button onClick={goPrev} disabled={!canPrev || routeLoading || busy} loading={routeLoading || busy}>
          Prev page
        </Button>
        <Button primary onClick={goNext} disabled={routeLoading || busy} loading={routeLoading || busy}>
          Next page
        </Button>
      </InlineStack>
    </div>
  );
}

/* ---------- Section & Skeleton ---------- */
function Section({ title, source, pool, visible, products, saver }) {
  const initialSelected = useMemo(() => {
    const m = new Map();
    (visible || []).forEach((v) => m.set(String(v.id), v));
    return m;
  }, [visible]);

  const [selected, setSelected] = useState(initialSelected);

  // 🔄 当 visible（文件内容）变化时，同步到 selected，避免“保存后 UI 反显不一致”
  useEffect(() => {
    const m = new Map();
    (visible || []).forEach((v) => m.set(String(v.id), v));
    setSelected(m);
  }, [visible]);

  const toggle = (id, seed) =>
    setSelected((prev) => {
      const key = String(id);
      const n = new Map(prev);
      if (n.has(key)) n.delete(key);
      else n.set(key, seedToVisible(seed));
      return n;
    });

  const changeCategory = (id, category) =>
    setSelected((prev) => {
      const key = String(id);
      const n = new Map(prev);
      if (n.has(key)) n.get(key).category = category;
      return n;
    });

  const changeProducts = (id, handle) =>
    setSelected((prev) => {
      const key = String(id);
      const n = new Map(prev);
      if (n.has(key)) n.get(key).products = handle ? [handle] : [];
      return n;
    });

  return (
    <saver.Form method="post">
      <input type="hidden" name="source" value={source} />
      {/* 默认合并写入，避免覆盖其他页已选择的数据 */}
      <input type="hidden" name="mode" value="merge" />

      <InlineStack align="space-between" blockAlign="center">
        <Text as="h2" variant="headingLg">{title}</Text>
        <Button submit primary>Save visible list (mentions)</Button>
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
          const key = String(item.id);
          const isVideo = item.media_type === "VIDEO";
          const picked = selected.get(key);
          const isChecked = !!picked;
          const category = picked?.category || "camping";
          const chosenProducts = picked?.products || [];
          const thumb = item.thumbnail_url || item.media_url || TINY;

          return (
            <Card key={`tag-${key}`} padding="400">
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center">
                  <Tag>@mention</Tag>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {item.timestamp ? new Date(item.timestamp).toLocaleString() : ""}
                  </Text>
                  {item.username && <Text as="span" variant="bodySm" tone="subdued">@{item.username}</Text>}
                </InlineStack>

                <a href={item.permalink} target="_blank" rel="noreferrer">
                  {isVideo ? (
                    <video
                      controls
                      muted
                      preload="metadata"
                      playsInline
                      style={{ width: "100%", height: 200, objectFit: "cover", borderRadius: 8 }}
                    >
                      <source src={item.media_url || ""} type="video/mp4" />
                    </video>
                  ) : (
                    <img
                      src={thumb}
                      alt="UGC"
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      style={{ width: "100%", height: 200, objectFit: "cover", borderRadius: 8 }}
                      onError={(e) => { e.currentTarget.src = TINY; }}
                    />
                  )}
                </a>

                <Text variant="bodySm" as="p">
                  {(item.caption || "No description").slice(0, 160)}
                  {item.caption && item.caption.length > 160 ? "…" : ""}
                </Text>

                <Checkbox label="Show on site" checked={isChecked} onChange={() => toggle(key, item)} />

                {isChecked && (
                  <>
                    <Select
                      label="Category"
                      options={CATEGORY_OPTIONS}
                      value={category}
                      onChange={(v) => changeCategory(key, v)}
                    />
                    <Select
                      label="Linked Product"
                      options={products.map((p) => ({ label: p.title, value: p.handle }))}
                      value={chosenProducts[0] || ""}
                      onChange={(v) => changeProducts(key, v)}
                    />
                    <input
                      type="hidden"
                      name="ugc_entry"
                      value={JSON.stringify({
                        id: key,
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
    </saver.Form>
  );
}

function GridSkeleton() {
  return (
    <div
      style={{
        marginTop: 16,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
        gap: 24,
      }}
    >
      {Array.from({ length: 12 }).map((_, i) => (
        <Card key={i} padding="400">
          <div style={{ width: "100%", height: 200, background: "var(--p-color-bg-surface-tertiary, #F1F2F4)", borderRadius: 8 }} />
          <div style={{ marginTop: 12 }}>
            <SkeletonBodyText lines={2} />
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ---------- Helpers ---------- */
function seedToVisible(seed) {
  return {
    category: "camping",
    products: [],
    id: String(seed.id),
    username: seed.username || "",
    timestamp: seed.timestamp || "",
    media_type: seed.media_type || "IMAGE",
    media_url: seed.media_url || "",
    thumbnail_url: seed.thumbnail_url || "",
    caption: seed.caption || "",
    permalink: seed.permalink || "",
  };
}
