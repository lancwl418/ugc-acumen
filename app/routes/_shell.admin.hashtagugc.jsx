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
  Banner,
} from "@shopify/polaris";
import { Suspense, useMemo, useState, useEffect, useRef } from "react";
import fs from "fs/promises";
import path from "path";

// 不改 persistPaths
import {
  VISIBLE_HASH_PATH,
  ensureVisibleHashFile,
} from "../lib/persistPaths.js";

import {
  fetchHashtagUGCPage,
  refreshMediaUrlByHashtag,
  scanHashtagsUntil,
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

/* ---------- utils（浏览器端安全 base64） ---------- */
function b64e(obj){
  try { return window.btoa(unescape(encodeURIComponent(JSON.stringify(obj||{})))); }
  catch { return ""; }
}
function b64d(s){
  try { return JSON.parse(decodeURIComponent(escape(window.atob(String(s||"")))) || "{}"); }
  catch { return {}; }
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

  // 统一计算 tags：URL 覆盖 env
  const envTags = (process.env.HASHTAGS || process.env.HASHTAG || "").trim();
  const effectiveTags = (url.searchParams.get("tags") || envTags || "").trim();

  const hSize = Math.min(40, Math.max(6, Number(url.searchParams.get("hSize") || 12)));
  const c = url.searchParams.get("c") || ""; // base64 的 per-tag cursors

  // 缺失 env 提示
  const envMissing = [];
  if (!process.env.INSTAGRAM_IG_ID) envMissing.push("INSTAGRAM_IG_ID");
  if (!process.env.PAGE_TOKEN)      envMissing.push("PAGE_TOKEN");

  await ensureVisibleHashFile();
  const [hashVisible, products] = await Promise.all([
    (async ()=>{ try { return JSON.parse(await fs.readFile(VISIBLE_HASH_PATH, "utf-8")||"[]"); } catch { return []; } })(),
    (async ()=>{ try { return JSON.parse(await fs.readFile(path.resolve("public/products.json"), "utf-8")||"[]"); } catch { return []; } })(),
  ]);

  const cursors = c ? JSON.parse(Buffer.from(c, "base64").toString("utf-8")) : {}; // 服务端可用 Buffer
  const hashtagPromise = (async () => {
    try {
      const page = await fetchHashtagUGCPage({ tags: effectiveTags, limit: hSize, cursors });
      return { items: page.items || [], nextCursors: page.nextCursors || {}, pageSize: hSize, tags: effectiveTags };
    } catch {
      return { items: [], nextCursors: {}, pageSize: hSize, tags: effectiveTags };
    }
  })();

  return defer(
    { hashtag: hashtagPromise, visible: hashVisible, products, envMissing, effectiveTags },
    { headers: { "Cache-Control": "private, max-age=10" } }
  );
}

/* ---------- action（与你现有相同，未动） ---------- */
export async function action({ request }) {
  const fd = await request.formData();
  const op = fd.get("op");

  if (op === "refreshVisibleAll") {
    await ensureVisibleHashFile();
    let visible = [];
    try { visible = JSON.parse(await fs.readFile(VISIBLE_HASH_PATH, "utf-8")) || []; } catch {}

    const targetIds = visible.map(v => String(v.id));
    const tagSet = new Set(
      visible.map(v => String(v.hashtag || "").replace(/^#/, "")).filter(Boolean)
    );
    const tags = Array.from(tagSet).join(",");

    const nowISO = new Date().toISOString();
    const { hits, scanned, pages, done } = await scanHashtagsUntil({
      tags,
      targetIds,
      per: 50,
      maxScanPerTagPerEdge: 6000,
      hardPageCapPerTagPerEdge: 200,
    });

    const merged = visible.map(v => {
      const hit = hits.get(String(v.id));
      if (!hit) {
        return { ...v, lastRefreshedAt: nowISO, lastRefreshError: v.lastRefreshError ?? null };
      }
      const nextMedia  = hit.media_url  || v.media_url  || "";
      const nextThumb  = (hit.thumbnail_url ?? v.thumbnail_url) ?? null;
      const changed =
        (nextMedia && nextMedia !== v.media_url) ||
        (nextThumb && nextThumb !== v.thumbnail_url) ||
        (hit.media_type && hit.media_type !== v.media_type);

      return {
        ...v,
        media_type:    hit.media_type || v.media_type,
        media_url:     nextMedia,
        thumbnail_url: nextThumb,
        caption:       hit.caption ?? v.caption,
        permalink:     hit.permalink || v.permalink,
        timestamp:     hit.timestamp || v.timestamp,
        username:      hit.username  || v.username,
        lastRefreshedAt: nowISO,
        ...(changed ? { lastFoundAt: nowISO } : {}),
        lastRefreshError: null,
      };
    });

    await fs.writeFile(VISIBLE_HASH_PATH, JSON.stringify(merged, null, 2), "utf-8");

    const updatedCount = merged.reduce((n, m, i) => {
      const old = visible[i] || {};
      return n + ((m.media_url !== old.media_url) || (m.thumbnail_url !== old.thumbnail_url) ? 1 : 0);
    }, 0);

    return json({
      ok: true,
      op: "refreshVisibleAll",
      total: merged.length,
      updated: updatedCount,
      scanned,
      pages,
      done,
      tagsUsed: tags,
    });
  }

  if (op === "refreshVisible") {
    const picked = fd.getAll("ugc_entry").map((s) => JSON.parse(s));
    const idSet = new Set(picked.map((e) => String(e.id)));

    await ensureVisibleHashFile();
    let visible = [];
    try { visible = JSON.parse(await fs.readFile(VISIBLE_HASH_PATH, "utf-8")) || []; } catch {}

    const nowISO = new Date().toISOString();
    const updated = [];
    for (const v of visible) {
      if (!idSet.has(String(v.id))) { updated.push(v); continue; }
      try {
        const fresh = await refreshMediaUrlByHashtag(v, { per: 50, maxScan: 6000, hardPageCap: 200 });
        const nextMedia = fresh.media_url || v.media_url || "";
        const nextThumb = (fresh.thumbnail_url ?? v.thumbnail_url) ?? null;
        const found = (nextMedia && nextMedia !== v.media_url) ||
                      (nextThumb && nextThumb !== v.thumbnail_url);
        updated.push({
          ...v,
          ...fresh,
          media_url: nextMedia,
          thumbnail_url: nextThumb,
          lastRefreshedAt: nowISO,
          ...(found ? { lastFoundAt: nowISO } : {}),
          lastRefreshError: null,
        });
      } catch {
        updated.push({ ...v, lastRefreshedAt: nowISO, lastRefreshError: "fetch_failed" });
      }
    }

    await fs.writeFile(VISIBLE_HASH_PATH, JSON.stringify(updated, null, 2), "utf-8");
    return json({ ok: true, op: "refreshVisible", refreshed: idSet.size, total: updated.length });
  }

  // 保存（merge/replace）——与原来一致
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
      hashtag: String(e.hashtag || "").replace(/^#/, ""),
    };
  });

  await ensureVisibleHashFile();

  if (mode === "replace") {
    await fs.writeFile(VISIBLE_HASH_PATH, JSON.stringify(entries, null, 2), "utf-8");
    return json({ ok: true, mode: "replace", count: entries.length });
  }

  let existing = [];
  try { existing = JSON.parse(await fs.readFile(VISIBLE_HASH_PATH, "utf-8")) || []; } catch {}

  const merged = new Map(existing.map((x) => [String(x.id), x]));
  for (const e of entries) {
    const prev = merged.get(String(e.id)) || {};
    merged.set(String(e.id), { ...prev, ...e });
  }

  const toWrite = Array.from(merged.values());
  await fs.writeFile(VISIBLE_HASH_PATH, JSON.stringify(toWrite, null, 2), "utf-8");
  return json({ ok: true, mode: "merge", count: entries.length, total: toWrite.length });
}

/* ---------- Page ---------- */
export default function AdminHashtagUGC() {
  const data = useLoaderData();
  const saver = useFetcher();
  const navigation = useNavigation();

  return (
    <Page>
      <InlineStack align="space-between" blockAlign="center">
        <Text as="h1" variant="headingLg">UGC Admin — Hashtags</Text>
        <Text as="span" tone="subdued">前端只读 visible_hashtag.json</Text>
      </InlineStack>

      {(data?.envMissing?.length > 0) && (
        <div style={{ marginTop: 12 }}>
          <Banner tone="critical" title="Missing Instagram credentials">
            <p>Missing env: {data.envMissing.join(", ")}。</p>
          </Banner>
        </div>
      )}
      {(!data?.effectiveTags || !String(data.effectiveTags).trim()) && (
        <div style={{ marginTop: 12 }}>
          <Banner tone="warning" title="No hashtags configured">
            <p>请在 URL 添加 <code>?tags=yourtag</code> 或设置环境变量 <code>HASHTAGS</code>。</p>
          </Banner>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 120px)", marginTop: 16 }}>
        <div style={{ flex: "1 1 auto" }}>
          <Suspense fallback={<GridSkeleton />}>
            <Await resolve={data.hashtag}>
              {(h) => (
                <>
                  {Array.isArray(h.items) && h.items.length === 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <Banner tone="info" title="No items returned">
                        <p>当前标签：{h.tags || "(未设置)"}。</p>
                      </Banner>
                    </div>
                  )}

                  <BlockStack gap="400" id="tab-hashtags">
                    <Section
                      title={`Hashtags (${h.tags || ""})`}
                      source="hashtags"
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

/* ---------- Pager（支持 nextUrl & after，禁用态更准确） ---------- */
function Pager({ view, routeLoading, hash, stackKey }) {
  const navigate = useNavigate();
  const location = useLocation();
  const navigation = useNavigation();
  const [busy, setBusy] = useState(false);

  const canPrev = (readStackSS(stackKey).length > 0);

  const hasNext = (() => {
    const nc = view?.nextCursors || {};
    return Object.values(nc).some(v =>
      (v && (v.topNext || v.recentNext || v.topAfter || v.recentAfter))
    );
  })();

  const goNext = () => {
    if (routeLoading || busy || !hasNext) return;
    setBusy(true);
    const usp = new URLSearchParams(location.search);
    const stack = readStackSS(stackKey);
    stack.push(usp.get("c") || "");
    writeStackSS(stackKey, stack);
    usp.set("c", b64e(view.nextCursors || {}));
    usp.set("hSize", String(view.pageSize || 12));
    navigate(`?${usp.toString()}${hash}`, { preventScrollReset: true });
  };

  const goPrev = () => {
    if (routeLoading || busy) return;
    const stack = readStackSS(stackKey);
    if (stack.length === 0) return;
    setBusy(true);
    const prevC = stack.pop() || "";
    writeStackSS(stackKey, stack);
    const usp = new URLSearchParams(location.search);
    if (prevC) usp.set("c", prevC);
    else usp.delete("c");
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
        <Button primary onClick={goNext} disabled={!hasNext || routeLoading || busy} loading={routeLoading || busy}>
          Next page
        </Button>
      </InlineStack>
    </div>
  );
}

/* ---------- Section（与之前一致） ---------- */
function Section({ title, source, pool, visible, products, saver }) {
  const initialSelected = useMemo(() => {
    const m = new Map();
    (visible || []).forEach((v) => m.set(v.id, v));
    return m;
  }, [visible]);

  const [selected, setSelected] = useState(initialSelected);
  const opRef = useRef(null);

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
      <input ref={opRef} type="hidden" name="op" value="saveVisible" />

      <InlineStack align="space-between" blockAlign="center">
        <Text as="h2" variant="headingLg">{title}</Text>
        <InlineStack gap="200">
          <Button submit onClick={() => { if (opRef.current) opRef.current.value = "saveVisible"; }} primary>
            Save visible list (hashtags)
          </Button>
          <Button submit onClick={() => { if (opRef.current) opRef.current.value = "refreshVisible"; }}>
            Refresh media URL (checked)
          </Button>
          <Button submit onClick={() => { if (opRef.current) opRef.current.value = "refreshVisibleAll"; }}>
            Refresh ALL visible
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
            <Card key={`hash-${item.id}`} padding="400">
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center">
                  <Tag>#{item.hashtag || "tag"}</Tag>
                  <Tag>@{item.username || "author"}</Tag>
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

                <Checkbox label="Show on site" checked={isChecked} onChange={() => toggle(item.id, item)} />

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
                      options={Array.isArray(products) ? products.map((p) => ({ label: p.title, value: p.handle })) : []}
                      value={chosenProducts[0] || ""}
                      onChange={(v) => changeProducts(item.id, v)}
                    />
                    <input
                      type="hidden"
                      name="ugc_entry"
                      value={JSON.stringify({
                        id: item.id,
                        hashtag: item.hashtag,
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

function seedToVisible(seed) {
  return {
    category: "camping",
    products: [],
    id: seed.id,
    hashtag: (seed.hashtag || "").replace(/^#/, ""),
    username: seed.username || "",
    timestamp: seed.timestamp || "",
    media_type: seed.media_type || "IMAGE",
    media_url: seed.media_url || "",
    thumbnail_url: seed.thumbnail_url || "",
    caption: seed.caption || "",
    permalink: seed.permalink || "",
  };
}
