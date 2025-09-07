// app/routes/admin.hashtagugc.jsx
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useFetcher,
  useNavigate,
  useLocation,
  useNavigation, // 👈 for loading state
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
  Tabs,
} from "@shopify/polaris";
import { useMemo, useState, useEffect } from "react";
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
  fillMissingMediaOnce,
} from "../lib/fetchHashtagUGC.js";

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

async function readJsonSafe(file, fallback = "[]") {
  try {
    return JSON.parse((await fs.readFile(file, "utf-8")) || fallback);
  } catch {
    return JSON.parse(fallback);
  }
}

/* ---------------- Loader: unchanged data logic ---------------- */
export async function loader({ request }) {
  const url = new URL(request.url);

  // Hashtag pagination state
  const hSize = Math.min(40, Math.max(6, Number(url.searchParams.get("hSize") || 12)));
  const hCursorB64 = url.searchParams.get("hCursor") || "";
  let hCursors = {};
  try {
    if (hCursorB64) hCursors = JSON.parse(Buffer.from(hCursorB64, "base64").toString("utf-8"));
  } catch {}

  // Mentions pagination state
  const tSize = Math.min(40, Math.max(6, Number(url.searchParams.get("tSize") || 12)));
  const tAfter = url.searchParams.get("tAfter") || "";

  await Promise.all([ensureVisibleHashtagFile(), ensureVisibleTagFile()]);
  const [hashtagVisible, tagVisible, products] = await Promise.all([
    readJsonSafe(VISIBLE_HASHTAG_PATH),
    readJsonSafe(VISIBLE_TAG_PATH),
    readJsonSafe(path.resolve("public/products.json"), "[]"),
  ]);

  const [hPage, tPage] = await Promise.all([
    fetchHashtagUGCPage({ limit: hSize, cursors: hCursors }).catch(() => ({
      items: [],
      nextCursors: {},
    })),
    fetchTagUGCPage({ limit: tSize, after: tAfter }).catch(() => ({
      items: [],
      nextAfter: "",
    })),
  ]);

  const hItems = await Promise.all(
    hPage.items.map((it) =>
      it.media_url || it.thumbnail_url ? it : fillMissingMediaOnce(it, { source: "hashtag" })
    )
  );
  const tItems = await Promise.all(
    tPage.items.map((it) =>
      it.media_url || it.thumbnail_url ? it : fillMissingMediaOnce(it, { source: "tag" })
    )
  );

  return json(
    {
      hashtag: {
        items: hItems,
        visible: hashtagVisible,
        nextCursorB64: Buffer.from(JSON.stringify(hPage.nextCursors || {}), "utf-8").toString(
          "base64"
        ),
        pageSize: hSize,
      },
      mentions: {
        items: tItems,
        visible: tagVisible,
        nextAfter: tPage.nextAfter || "",
        pageSize: tSize,
      },
      products,
    },
    { headers: { "Cache-Control": "private, max-age=30" } }
  );
}

/* ---------------- Action: unchanged (save & manual refresh) ---------------- */
export async function action({ request }) {
  const fd = await request.formData();
  const op = fd.get("op");
  if (op === "refresh") {
    try {
      await Promise.all([fetchHashtagUGCPage({ limit: 6 }), fetchTagUGCPage({ limit: 6 })]);
    } catch {}
    return json({ ok: true });
  }

  const source = fd.get("source"); // 'hashtag' | 'tag'
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
      thumbnail_url: e.thumbnail_url || "",
      caption: e.caption || "",
      permalink: e.permalink || "",
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

/* ---------------- Page (tabs with hash; prev/next + loading) ---------------- */
export default function AdminUGC() {
  const data = useLoaderData();
  const saver = useFetcher();
  const refresher = useFetcher();
  const navigate = useNavigate();
  const location = useLocation();
  const navigation = useNavigation(); // global route loading state

  const tabs = [
    { id: "hashtag", content: "Hashtag (#)" },
    { id: "mentions", content: "Mentions (@)" },
  ];

  const initialIndex = location.hash === "#mentions" ? 1 : 0;
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);

  useEffect(() => {
    setSelectedIndex(location.hash === "#mentions" ? 1 : 0);
  }, [location.hash]);

  const onSelectTab = (index) => {
    setSelectedIndex(index);
    navigate(index === 1 ? "#mentions" : "#hashtag", {
      replace: true,
      preventScrollReset: true,
    });
  };

  const isLoading = navigation.state !== "idle";

  return (
    <Page title="UGC Admin (Hashtag & Mentions)">
      <InlineStack align="space-between" blockAlign="center">
        <Text as="h1" variant="headingLg">
          UGC Admin (Hashtag & Mentions)
        </Text>
        <refresher.Form method="post">
          <input type="hidden" name="op" value="refresh" />
          <Button submit loading={refresher.state !== "idle"}>
            Refresh Pools
          </Button>
        </refresher.Form>
      </InlineStack>

      <div style={{ marginTop: 16 }}>
        <Tabs tabs={tabs} selected={selectedIndex} onSelect={onSelectTab}>
          {selectedIndex === 0 && (
            <TabHashtag data={data} saver={saver} routeLoading={isLoading} />
          )}
          {selectedIndex === 1 && (
            <TabMentions data={data} saver={saver} routeLoading={isLoading} />
          )}
        </Tabs>
      </div>
    </Page>
  );
}

/* ---------- Helpers for cursor stacks in query ---------- */
function readStack(paramValue) {
  if (!paramValue) return [];
  try {
    return JSON.parse(Buffer.from(paramValue, "base64").toString("utf-8")) || [];
  } catch {
    return [];
  }
}
function writeStack(arr) {
  try {
    return Buffer.from(JSON.stringify(arr), "utf-8").toString("base64");
  } catch {
    return "";
  }
}

/* ---------------- Tab: Hashtag ---------------- */
function TabHashtag({ data, saver, routeLoading }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Prev availability: presence of hStack
  const uspRead = new URLSearchParams(location.search);
  const hStackArr = readStack(uspRead.get("hStack") || "");
  const canPrev = hStackArr.length > 0;

  const goNext = () => {
    const usp = new URLSearchParams(location.search);
    // push current cursor into stack (could be empty string)
    const stack = readStack(usp.get("hStack") || "");
    stack.push(usp.get("hCursor") || "");
    usp.set("hStack", writeStack(stack));

    // set next cursor and size
    usp.set("hCursor", data.hashtag.nextCursorB64 || "");
    usp.set("hSize", String(data.hashtag.pageSize || 12));
    navigate(`?${usp.toString()}#hashtag`, { preventScrollReset: true, replace: true });
  };

  const goPrev = () => {
    const usp = new URLSearchParams(location.search);
    const stack = readStack(usp.get("hStack") || "");
    const prevCursor = stack.pop() || ""; // may be empty for first page
    usp.set("hStack", writeStack(stack));
    usp.set("hCursor", prevCursor);
    usp.set("hSize", String(data.hashtag.pageSize || 12));
    navigate(`?${usp.toString()}#hashtag`, { preventScrollReset: true, replace: true });
  };

  return (
    <BlockStack gap="400" id="tab-hashtag">
      <Section
        title="🏷️ Hashtag (#)"
        source="hashtag"
        pool={data.hashtag.items}
        visible={data.hashtag.visible}
        products={data.products}
        saver={saver}
      />

      <InlineStack align="end" gap="200">
        <Button onClick={goPrev} disabled={!canPrev || routeLoading} loading={routeLoading}>
          Prev page
        </Button>
        <Button onClick={goNext} primary disabled={routeLoading} loading={routeLoading}>
          Next page
        </Button>
      </InlineStack>
    </BlockStack>
  );
}

/* ---------------- Tab: Mentions ---------------- */
function TabMentions({ data, saver, routeLoading }) {
  const navigate = useNavigate();
  const location = useLocation();

  const uspRead = new URLSearchParams(location.search);
  const tStackArr = readStack(uspRead.get("tStack") || "");
  const canPrev = tStackArr.length > 0;

  const goNext = () => {
    const usp = new URLSearchParams(location.search);
    const stack = readStack(usp.get("tStack") || "");
    stack.push(usp.get("tAfter") || "");
    usp.set("tStack", writeStack(stack));

    if (data.mentions.nextAfter) usp.set("tAfter", data.mentions.nextAfter);
    usp.set("tSize", String(data.mentions.pageSize || 12));
    navigate(`?${usp.toString()}#mentions`, { preventScrollReset: true, replace: true });
  };

  const goPrev = () => {
    const usp = new URLSearchParams(location.search);
    const stack = readStack(usp.get("tStack") || "");
    const prevAfter = stack.pop() || "";
    usp.set("tStack", writeStack(stack));
    if (prevAfter) usp.set("tAfter", prevAfter);
    else usp.delete("tAfter"); // back to first page
    usp.set("tSize", String(data.mentions.pageSize || 12));
    navigate(`?${usp.toString()}#mentions`, { preventScrollReset: true, replace: true });
  };

  return (
    <BlockStack gap="400" id="tab-mentions">
      <Section
        title="📣 Mentions (@)"
        source="tag"
        pool={data.mentions.items}
        visible={data.mentions.visible}
        products={data.products}
        saver={saver}
      />

      <InlineStack align="end" gap="200">
        <Button onClick={goPrev} disabled={!canPrev || routeLoading} loading={routeLoading}>
          Prev page
        </Button>
        <Button onClick={goNext} primary disabled={routeLoading} loading={routeLoading}>
          Next page
        </Button>
      </InlineStack>
    </BlockStack>
  );
}

/* ---------------- Shared Section ---------------- */
function Section({ title, source, pool, visible, products, saver }) {
  const initialSelected = useMemo(() => {
    const m = new Map();
    (visible || []).forEach((v) => m.set(v.id, v));
    return m;
  }, [visible]);
  const [selected, setSelected] = useState(initialSelected);

  const toggle = (id, seed) =>
    setSelected((prev) => {
      const n = new Map(prev);
      if (n.has(id)) n.delete(id);
      else n.set(id, seedToVisible(seed));
      return n;
    });

  const changeCategory = (id, category) =>
    setSelected((prev) => {
      const n = new Map(prev);
      if (n.has(id)) n.get(id).category = category;
      return n;
    });

  const changeProducts = (id, handle) =>
    setSelected((prev) => {
      const n = new Map(prev);
      if (n.has(id)) n.get(id).products = handle ? [handle] : [];
      return n;
    });

  return (
    <saver.Form method="post">
      <input type="hidden" name="source" value={source} />
      <InlineStack align="space-between" blockAlign="center">
        <Text as="h2" variant="headingLg">
          {title}
        </Text>
        <Button submit primary>
          Save visible list ({source})
        </Button>
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
          const thumb = item.thumbnail_url || item.media_url || TINY;

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
                      preload="metadata"
                      playsInline
                      style={{
                        width: "100%",
                        height: 200,
                        objectFit: "cover",
                        borderRadius: 8,
                      }}
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
                      style={{
                        width: "100%",
                        height: 200,
                        objectFit: "cover",
                        borderRadius: 8,
                      }}
                      onError={(e) => {
                        e.currentTarget.src = TINY;
                      }}
                    />
                  )}
                </a>

                <Text variant="bodySm" as="p">
                  {(item.caption || "No description").slice(0, 160)}
                  {item.caption && item.caption.length > 160 ? "…" : ""}
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
                      onChange={(v) => changeCategory(item.id, v)}
                    />
                    <Select
                      label="Linked Product"
                      options={products.map((p) => ({
                        label: p.title,
                        value: p.handle,
                      }))}
                      value={chosenProducts[0] || ""}
                      onChange={(v) => changeProducts(item.id, v)}
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
