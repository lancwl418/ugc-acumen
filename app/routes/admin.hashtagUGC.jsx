// app/routes/admin.hashtagugc.jsx
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useFetcher,
  useNavigate,
  useLocation,
  useNavigation,
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
import { useMemo, useState, useEffect, useRef } from "react";
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
function clearStackSS(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {}
}
function b64ToObj(b64) {
  try {
    return JSON.parse(Buffer.from(b64 || "", "base64").toString("utf-8")) || {};
  } catch {
    return {};
  }
}

/* ---------- Loader: unchanged data logic ---------- */
export async function loader({ request }) {
  const url = new URL(request.url);

  // Hashtag pagination state
  const hSize = Math.min(40, Math.max(6, Number(url.searchParams.get("hSize") || 12)));
  const hCursorB64 = url.searchParams.get("hCursor") || "";
  let hCursors = {};
  try {
    if (hCursorB64) {
      hCursors = JSON.parse(Buffer.from(hCursorB64, "base64").toString("utf-8"));
    }
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

  // Fill missing media once (only if needed)
  const hItems = await Promise.all(
    (hPage.items || []).map((it) =>
      it.media_url || it.thumbnail_url ? it : fillMissingMediaOnce(it, { source: "hashtag" })
    )
  );
  const tItems = await Promise.all(
    (tPage.items || []).map((it) =>
      it.media_url || it.thumbnail_url ? it : fillMissingMediaOnce(it, { source: "tag" })
    )
  );

  return json(
    {
      hashtag: {
        items: hItems,
        visible: hashtagVisible,
        nextCursorB64: Buffer.from(
          JSON.stringify(hPage.nextCursors || {}),
          "utf-8"
        ).toString("base64"),
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

/* ---------- Action: unchanged ---------- */
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

/* ---------- Page (tabs with hash; client caches; per-tab stacks in sessionStorage) ---------- */
export default function AdminUGC() {
  const data = useLoaderData();
  const saver = useFetcher();
  const refresher = useFetcher();
  const navigate = useNavigate();
  const location = useLocation();
  const navigation = useNavigation();

  // Ensure there is a hash on first mount
  useEffect(() => {
    if (!location.hash) {
      navigate("#hashtag", { replace: true, preventScrollReset: true });
    }
  }, []); // eslint-disable-line

  // Scroll to current tab container when navigation settles
  useEffect(() => {
    if (navigation.state === "idle") {
      const id = location.hash?.slice(1) || "hashtag";
      const el = document.getElementById(`tab-${id}`);
      if (el) el.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }, [navigation.state, location.hash]);

  // Tabs via hash
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

  // URL params we care about (to detect page change)
  const usp = new URLSearchParams(location.search);
  const hCursorParam = usp.get("hCursor") || "";
  const hSizeParam = usp.get("hSize") || "";
  const tAfterParam = usp.get("tAfter") || "";
  const tSizeParam = usp.get("tSize") || "";

  // Client caches per tab (stable UI when switching tabs)
  const [hashtagView, setHashtagView] = useState({
    items: data.hashtag.items,
    nextCursorB64: data.hashtag.nextCursorB64,
    pageSize: data.hashtag.pageSize,
    visible: data.hashtag.visible,
  });
  const [mentionsView, setMentionsView] = useState({
    items: data.mentions.items,
    nextAfter: data.mentions.nextAfter,
    pageSize: data.mentions.pageSize,
    visible: data.mentions.visible,
  });

  // Update caches only when their own query params changed (i.e., their page changed)
  useEffect(() => {
    setHashtagView({
      items: data.hashtag.items,
      nextCursorB64: data.hashtag.nextCursorB64,
      pageSize: data.hashtag.pageSize,
      visible: data.hashtag.visible,
    });
    // do NOT clear hashtag stack here; stack persists in sessionStorage per tab
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hCursorParam, hSizeParam, data.hashtag.items, data.hashtag.nextCursorB64, data.hashtag.pageSize]);

  useEffect(() => {
    setMentionsView({
      items: data.mentions.items,
      nextAfter: data.mentions.nextAfter,
      pageSize: data.mentions.pageSize,
      visible: data.mentions.visible,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tAfterParam, tSizeParam, data.mentions.items, data.mentions.nextAfter, data.mentions.pageSize]);

  const routeLoading = navigation.state !== "idle";

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
            <TabHashtag
              view={hashtagView}
              products={data.products}
              saver={saver}
              routeLoading={routeLoading}
            />
          )}
          {selectedIndex === 1 && (
            <TabMentions
              view={mentionsView}
              products={data.products}
              saver={saver}
              routeLoading={routeLoading}
            />
          )}
        </Tabs>
      </div>
    </Page>
  );
}

/* ---------- Tab: Hashtag (sessionStorage stack) ---------- */
function TabHashtag({ view, products, saver, routeLoading }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false); // extra debounce to avoid double-clicks

  // compute prev availability from sessionStorage stack
  const stackKey = "ugc:hStack";
  const canPrev = (readStackSS(stackKey).length > 0);

  const goNext = () => {
    if (routeLoading || busy) return;
    setBusy(true);
    const usp = new URLSearchParams(location.search);

    // push current cursor into hashtag stack (may be empty on first page)
    const stack = readStackSS(stackKey);
    stack.push(usp.get("hCursor") || "");
    writeStackSS(stackKey, stack);

    // set next cursor from current view
    usp.set("hCursor", view.nextCursorB64 || "");
    usp.set("hSize", String(view.pageSize || 12));

    navigate(`?${usp.toString()}#hashtag`, { preventScrollReset: true });
  };

  const goPrev = () => {
    if (routeLoading || busy) return;
    const stack = readStackSS(stackKey);
    if (stack.length === 0) return;

    setBusy(true);
    const prevCursor = stack.pop() || "";
    writeStackSS(stackKey, stack);

    const usp = new URLSearchParams(location.search);
    if (prevCursor) usp.set("hCursor", prevCursor);
    else usp.delete("hCursor"); // back to first page
    usp.set("hSize", String(view.pageSize || 12));

    navigate(`?${usp.toString()}#hashtag`, { preventScrollReset: true });
  };

  // when route finishes, clear busy
  const navigation = useNavigation();
  useEffect(() => {
    if (navigation.state === "idle") setBusy(false);
  }, [navigation.state]);

  return (
    <BlockStack gap="400" id="tab-hashtag">
      <Section
        title="🏷️ Hashtag (#)"
        source="hashtag"
        pool={view.items}
        visible={view.visible}
        products={products}
        saver={saver}
      />

      <InlineStack align="end" gap="200">
        <Button onClick={goPrev} disabled={!canPrev || routeLoading || busy} loading={routeLoading || busy}>
          Prev page
        </Button>
        <Button onClick={goNext} primary disabled={routeLoading || busy} loading={routeLoading || busy}>
          Next page
        </Button>
      </InlineStack>
    </BlockStack>
  );
}

/* ---------- Tab: Mentions (sessionStorage stack) ---------- */
function TabMentions({ view, products, saver, routeLoading }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);

  const stackKey = "ugc:tStack";
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

    navigate(`?${usp.toString()}#mentions`, { preventScrollReset: true });
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

    navigate(`?${usp.toString()}#mentions`, { preventScrollReset: true });
  };

  const navigation = useNavigation();
  useEffect(() => {
    if (navigation.state === "idle") setBusy(false);
  }, [navigation.state]);

  return (
    <BlockStack gap="400" id="tab-mentions">
    <Section
        title="📣 Mentions (@)"
        source="tag"
        pool={view.items}
        visible={view.visible}
        products={products}
        saver={saver}
      />

      <InlineStack align="end" gap="200">
        <Button onClick={goPrev} disabled={!canPrev || routeLoading || busy} loading={routeLoading || busy}>
          Prev page
        </Button>
        <Button onClick={goNext} primary disabled={routeLoading || busy} loading={routeLoading || busy}>
          Next page
        </Button>
      </InlineStack>
    </BlockStack>
  );
}

/* ---------- Shared Section ---------- */
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

/* ---------- Helpers ---------- */
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
