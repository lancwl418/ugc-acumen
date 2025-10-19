// app/routes/_shell.admin.hashtagugc.jsx
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
import { Suspense, useMemo, useState, useEffect, useRef } from "react";
import fs from "fs/promises";
import path from "path";

import {
  VISIBLE_HASHTAG_PATH,
  ensureVisibleHashtagFile,
} from "../lib/persistPaths.js";

import {
  fetchHashtagUGCPage,
  refreshMediaUrlByHashtag,
  scanHashtagUntil,
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

/* ---------- utils ---------- */
async function readJsonSafe(file, fallback = "[]") {
  try { return JSON.parse((await fs.readFile(file, "utf-8")) || fallback); }
  catch { return JSON.parse(fallback); }
}
function safeParseJSON(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}
function readStackSS(key) {
  try { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) : []; }
  catch { return []; }
}
function writeStackSS(key, arr) {
  try { sessionStorage.setItem(key, JSON.stringify(arr)); } catch {}
}

/* ---------- loader ---------- */
export async function loader({ request }) {
  const url = new URL(request.url);
  const hSize = Math.min(40, Math.max(6, Number(url.searchParams.get("hSize") || 12)));
  const hTags = String(url.searchParams.get("hTags") || "").trim();
  const hCursorsStr = url.searchParams.get("hCursors") || "{}";
  const hCursors = safeParseJSON(hCursorsStr, {});

  await ensureVisibleHashtagFile();
  const [visible, products] = await Promise.all([
    readJsonSafe(VISIBLE_HASHTAG_PATH),
    readJsonSafe(path.resolve("public/products.json"), "[]"),
  ]);

  const hashPromise = (async () => {
    try {
      const page = await fetchHashtagUGCPage({
        tags: hTags || undefined,
        limit: hSize,
        cursors: hCursors,
      });
      return { items: page.items || [], nextCursors: page.nextCursors || {}, pageSize: hSize, tags: hTags };
    } catch {
      return { items: [], nextCursors: {}, pageSize: hSize, tags: hTags };
    }
  })();

  return defer(
    { hashtag: hashPromise, visible, products },
    { headers: { "Cache-Control": "private, max-age=30" } }
  );
}

/* ---------- action ---------- */
export async function action({ request }) {
  const fd = await request.formData();
  const op = fd.get("op");

  // ✅ 一键刷新：按 hashtag 聚合，逐个 hashtag 扫到命中完
  if (op === "refreshVisibleAllHashtag") {
    await ensureVisibleHashtagFile();
    let visible = [];
    try { visible = JSON.parse(await fs.readFile(VISIBLE_HASHTAG_PATH, "utf-8")) || []; } catch {}

    // tag => Set(ids)
    const byTag = new Map();
    for (const v of visible) {
      const tag = String(v.hashtag || "").replace(/^#/, "");
      if (!tag) continue;
      if (!byTag.has(tag)) byTag.set(tag, new Set());
      byTag.get(tag).add(String(v.id));
    }

    const nowISO = new Date().toISOString();
    const merged = [...visible];
    let totalScanned = 0;
    let totalPages = 0;

    for (const [tag, ids] of byTag.entries()) {
      const { hits, scanned, pages } = await scanHashtagUntil({
        tag, targetIds: ids, per: 30, maxScan: 10000, hardPageCap: 300,
      });
      totalScanned += scanned; totalPages += pages;

      for (let i = 0; i < merged.length; i++) {
        const v = merged[i];
        const vt = String(v.hashtag || "").replace(/^#/, "");
        if (vt !== tag) continue;
        const hit = hits.get(String(v.id));
        if (!hit) continue;

        const changed =
          (hit.media_url && hit.media_url !== v.media_url) ||
          (hit.media_type && hit.media_type !== v.media_type);

        merged[i] = {
          ...v,
          media_type: hit.media_type || v.media_type,
          media_url: hit.media_url || v.media_url,
          caption: hit.caption ?? v.caption,
          permalink: hit.permalink || v.permalink,
          timestamp: hit.timestamp || v.timestamp,
          username: v.username || "", // hashtag 不提供，保留旧值
          lastRefreshedAt: nowISO,
          ...(changed ? { lastFoundAt: nowISO } : {}),
          lastRefreshError: null,
        };
      }
    }

    await fs.writeFile(VISIBLE_HASHTAG_PATH, JSON.stringify(merged, null, 2), "utf-8");

    const updatedCount = merged.reduce((n, m, i) => {
      const old = visible[i] || {};
      return n + ((m.media_url !== old.media_url) || (m.thumbnail_url !== old.thumbnail_url) ? 1 : 0);
    }, 0);

    return json({
      ok: true,
      op: "refreshVisibleAllHashtag",
      total: merged.length,
      updated: updatedCount,
      scanned: totalScanned,
      pages: totalPages,
    });
  }

  // ✅ 刷新“勾选的” visible（逐条：各自扫到命中为止）
  if (op === "refreshVisibleHashtagChecked") {
    const picked = fd.getAll("ugc_entry").map((s) => JSON.parse(s));
    const idSet = new Set(picked.map((e) => String(e.id)));

    await ensureVisibleHashtagFile();
    let visible = [];
    try { visible = JSON.parse(await fs.readFile(VISIBLE_HASHTAG_PATH, "utf-8")) || []; } catch {}

    const nowISO = new Date().toISOString();
    const updated = [];
    for (const v of visible) {
      if (!idSet.has(String(v.id))) { updated.push(v); continue; }
      try {
        const fresh = await refreshMediaUrlByHashtag(v, { per: 30, maxScan: 6000, hardPageCap: 200 });
        const found = (fresh.media_url && fresh.media_url !== v.media_url);
        updated.push({ ...fresh, lastRefreshedAt: nowISO, ...(found ? { lastFoundAt: nowISO } : {}) });
      } catch {
        updated.push({ ...v, lastRefreshedAt: nowISO, lastRefreshError: "fetch_failed" });
      }
    }

    await fs.writeFile(VISIBLE_HASHTAG_PATH, JSON.stringify(updated, null, 2), "utf-8");
    return json({ ok: true, op: "refreshVisibleHashtagChecked", refreshed: idSet.size, total: updated.length });
  }

  // 保存可见列表（merge | replace）
  const mode = String(fd.get("mode") || "merge").toLowerCase();

  const entries = fd.getAll("ugc_entry").map((s) => {
    const e = JSON.parse(s);
    return {
      id: String(e.id),
      hashtag: String(e.hashtag || "").replace(/^#/, ""),
      category: e.category || "camping",
      products: Array.isArray(e.products) ? e.products : [],
      username: e.username || "",
      timestamp: e.timestamp || "",
      media_type: e.media_type || "IMAGE",
      media_url: e.media_url || "",
      thumbnail_url: e.thumbnail_url || "",
      caption: e.caption || "",
      permalink: e.permalink || "",
    };
  });

  await ensureVisibleHashtagFile();

  if (mode === "replace") {
    await fs.writeFile(VISIBLE_HASHTAG_PATH, JSON.stringify(entries, null, 2), "utf-8");
    return json({ ok: true, mode: "replace", count: entries.length });
  }

  // merge（upsert by id）
  let existing = [];
  try { existing = JSON.parse(await fs.readFile(VISIBLE_HASHTAG_PATH, "utf-8")) || []; } catch {}

  const merged = new Map(existing.map((x) => [String(x.id), x]));
  for (const e of entries) {
    const prev = merged.get(String(e.id)) || {};
    merged.set(String(e.id), { ...prev, ...e });
  }

  const toWrite = Array.from(merged.values());
  await fs.writeFile(VISIBLE_HASHTAG_PATH, JSON.stringify(toWrite, null, 2), "utf-8");
  return json({ ok: true, mode: "merge", count: entries.length, total: toWrite.length });
}

/* ---------- page ---------- */
export default function AdminHashtagUGC() {
  const data = useLoaderData(); // { hashtag: Promise, visible, products }
  const saver = useFetcher();
  const navigation = useNavigation();

  return (
    <Page>
      <InlineStack align="space-between" blockAlign="center">
        <Text as="h1" variant="headingLg">UGC Admin — Hashtags</Text>
        <Text as="span" tone="subdued">前端只读 visible_hashtag_ugc.json</Text>
      </InlineStack>

      <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 120px)", marginTop: 16 }}>
        <div style={{ flex: "1 1 auto" }}>
          <Suspense fallback={<GridSkeleton />}>
            <Await resolve={data.hashtag}>
              {(h) => (
                <>
                  <BlockStack gap="400" id="tab-hashtag">
                    <Section
                      title={`Hashtags ${h.tags ? `(${h.tags})` : ""}`}
                      source="hashtag"
                      pool={h.items}
                      visible={data.visible}
                      products={data.products}
                      saver={saver}
                    />
                  </BlockStack>

                  <Pager
                    view={h}
                    routeLoading={navigation.state !== "idle"}
                    hash="#hashtags"
                    stackKey="ugc:hStack"
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

/* ---------- Pager：用 nextCursors 做前进/后退 ---------- */
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
    stack.push(usp.get("hCursors") || "{}");
    writeStackSS(stackKey, stack);

    usp.set("hCursors", JSON.stringify(view.nextCursors || {}));
    usp.set("hSize", String(view.pageSize || 12));
    navigate(`?${usp.toString()}${hash}`, { preventScrollReset: true });
  };

  const goPrev = () => {
    if (routeLoading || busy) return;
    const stack = readStackSS(stackKey);
    if (stack.length === 0) return;
    setBusy(true);
    const prevCursors = stack.pop() || "{}";
    writeStackSS(stackKey, stack);
    const usp = new URLSearchParams(location.search);
    usp.set("hCursors", prevCursors);
    usp.set("hSize", String(view.pageSize || 12));
    navigate(`?${usp.toString()}${hash}`, { preventScrollReset: true });
  };

  useEffect(() => { if (navigation.state === "idle") setBusy(false); }, [navigation.state]);

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

/* ---------- Section ---------- */
function Section({ title, source, pool, visible, products, saver }) {
  const initialSelected = useMemo(() => {
    const m = new Map();
    (visible || []).forEach((v) => m.set(v.id, v));
    return m;
  }, [visible]);

  const [selected, setSelected] = useState(initialSelected);
  const opRef = useRef(null);

  const toggle = (seed) =>
    setSelected((prev) => {
      const n = new Map(prev);
      if (n.has(seed.id)) n.delete(seed.id);
      else n.set(seed.id, seedToVisible(seed));
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
      <input ref={opRef} type="hidden" name="op" value="saveVisible" />

      <InlineStack align="space-between" blockAlign="center">
        <Text as="h2" variant="headingLg">{title}</Text>
        <InlineStack gap="200">
          <Button submit onClick={() => { if (opRef.current) opRef.current.value = "saveVisible"; }} primary>
            Save visible list (hashtags)
          </Button>
          <Button submit onClick={() => { if (opRef.current) opRef.current.value = "refreshVisibleHashtagChecked"; }}>
            Refresh media URL (checked)
          </Button>
          <Button submit onClick={() => { if (opRef.current) opRef.current.value = "refreshVisibleAllHashtag"; }}>
            Refresh ALL visible (hashtag)
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
          const thumb = item.thumbnail_url || item.media_url || TINY;

          return (
            <Card key={`ht-${item.id}`} padding="400">
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center">
                  {item.hashtag ? <Tag>#{item.hashtag}</Tag> : null}
                  <Text as="span" variant="bodySm" tone="subdued">
                    {item.timestamp ? new Date(item.timestamp).toLocaleString() : ""}
                  </Text>
                </InlineStack>

                <a href={item.permalink} target="_blank" rel="noreferrer">
                  {isVideo ? (
                    <video
                      controls muted preload="metadata" playsInline
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

                <Checkbox label="Show on site" checked={isChecked} onChange={() => toggle(item)} />

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
                      options={products.map((p) => ({ label: p.title, value: p.handle }))}
                      value={chosenProducts[0] || ""}
                      onChange={(v) => changeProducts(item.id, v)}
                    />
                    <input
                      type="hidden"
                      name="ugc_entry"
                      value={JSON.stringify({
                        id: item.id,
                        hashtag: item.hashtag || "",
                        category,
                        products: chosenProducts,
                        username: item.username || "",
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

/* ---------- Skeleton ---------- */
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

/* ---------- helpers ---------- */
function seedToVisible(seed) {
  return {
    category: "camping",
    products: [],
    id: seed.id,
    hashtag: String(seed.hashtag || "").replace(/^#/, ""),
    username: seed.username || "",
    timestamp: seed.timestamp || "",
    media_type: seed.media_type || "IMAGE",
    media_url: seed.media_url || "",
    thumbnail_url: seed.thumbnail_url || "",
    caption: seed.caption || "",
    permalink: seed.permalink || "",
  };
}
