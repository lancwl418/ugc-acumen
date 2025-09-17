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
  // ✅ 新增：原子写入
  writeVisibleHashtagAtomic,
} from "../lib/persistPaths.js";
import {
  fetchHashtagUGCPage,
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

/* ---------- Loader: use defer so route switches immediately ---------- */
export async function loader({ request }) {
  const url = new URL(request.url);

  const hSize = Math.min(40, Math.max(6, Number(url.searchParams.get("hSize") || 12)));
  const hCursorB64 = url.searchParams.get("hCursor") || "";
  let hCursors = {};
  try {
    if (hCursorB64) {
      hCursors = JSON.parse(Buffer.from(hCursorB64, "base64").toString("utf-8"));
    }
  } catch {}

  await ensureVisibleHashtagFile();
  const [hashtagVisible, products] = await Promise.all([
    readJsonSafe(VISIBLE_HASHTAG_PATH),
    readJsonSafe(path.resolve("public/products.json"), "[]"),
  ]);

  const hashtagPromise = (async () => {
    const hPage = await memo(
      `h:${hSize}:${Buffer.from(JSON.stringify(hCursors), "utf-8").toString("base64")}`,
      30_000,
      () => fetchHashtagUGCPage({ limit: hSize, cursors: hCursors })
    ).catch(() => ({ items: [], nextCursors: {} }));

    const items = await Promise.all(
      (hPage.items || []).map((it) =>
        it.media_url || it.thumbnail_url ? it : fillMissingMediaOnce(it, { source: "hashtag" })
      )
    );

    return {
      items,
      nextCursorB64: Buffer.from(JSON.stringify(hPage.nextCursors || {}), "utf-8").toString("base64"),
      pageSize: hSize,
    };
  })();

  return defer(
    {
      hashtag: hashtagPromise,   // Promise
      visible: hashtagVisible,   // small data first
      products,
    },
    { headers: { "Cache-Control": "private, max-age=30" } }
  );
}

/* ---------- Action: 合并写入（支持 mode=replace 覆盖），刷新打上时间戳 ---------- */
export async function action({ request }) {
  const fd = await request.formData();
  const op = String(fd.get("op") || "").trim(); // "refresh" | "refreshVisible" | "saveVisible"
  const nowISO = new Date().toISOString();

  // 1) 刷新池子：保持原样
  if (op === "refresh") {
    try { await fetchHashtagUGCPage({ limit: 6 }); } catch {}
    return json({ ok: true });
  }

  // 2) 刷新已勾选项：根据 hashtag 扫描，回写最新 media_url + lastRefreshedAt
  if (op === "refreshVisible") {
    const picked = fd.getAll("ugc_entry").map((s) => JSON.parse(s));
    const idSet = new Set(picked.map((e) => String(e.id)));

    await ensureVisibleHashtagFile();
    let visible = [];
    try {
      visible = JSON.parse(await fs.readFile(VISIBLE_HASHTAG_PATH, "utf-8")) || [];
    } catch { visible = []; }

    const per = Number(fd.get("per") || 30);
    const maxPages = Number(fd.get("maxPages") || 3);

    const updated = [];
    for (const v of visible) {
      if (idSet.has(String(v.id))) {
        try {
          // 通过 hashtag edges(top_media→recent_media) 找回“当下最新”直链
          const fresh = await refreshMediaUrlByHashtag(v, { per, maxPages });
          updated.push({
            ...v,
            media_url: fresh?.media_url || v.media_url || "",
            thumbnail_url: fresh?.thumbnail_url ?? v.thumbnail_url ?? null,
            media_type: fresh?.media_type || v.media_type || "IMAGE",
            permalink: fresh?.permalink || v.permalink || "",
            username: fresh?.username || v.username || "",
            timestamp: fresh?.timestamp || v.timestamp || "",
            // ✅ 标记这条被刷新过
            lastRefreshedAt: nowISO,
          });
        } catch {
          // 单条失败不中断，至少更新时间戳，方便你看 visible 是否被触发刷新
          updated.push({
            ...v,
            lastRefreshedAt: nowISO,
          });
        }
      } else {
        updated.push(v);
      }
    }

    // ✅ 原子写入
    await writeVisibleHashtagAtomic(updated);
    return json({
      ok: true,
      op: "refreshVisible",
      refreshed: idSet.size,
      total: updated.length,
      // 也回传一个时间给前端日志用
      lastRefreshedAt: nowISO,
    });
  }

  // 3) 保存可见列表（replace | merge），op 由前端传 "saveVisible"
  const mode = String(fd.get("mode") || "merge").toLowerCase();

  const entries = fd.getAll("ugc_entry").map((s) => {
    const e = JSON.parse(s);
    return {
      id: String(e.id),
      hashtag: e.hashtag || "",            // ✅ 保留 hashtag
      category: e.category || "camping",
      products: Array.isArray(e.products) ? e.products : [],
      username: e.username || "",
      timestamp: e.timestamp || "",
      media_type: e.media_type || "IMAGE",
      media_url: e.media_url || "",
      thumbnail_url: e.thumbnail_url || "",
      caption: e.caption || "",
      permalink: e.permalink || "",
      // 可选：记录这条是何时保存/更新进 visible 的
      savedAt: nowISO,
    };
  });

  await ensureVisibleHashtagFile();

  if (mode === "replace") {
    // ✅ 原子写入
    await writeVisibleHashtagAtomic(entries);
    return json({ ok: true, op: "saveVisible", mode: "replace", count: entries.length });
  }

  // merge（upsert by id）
  let existing = [];
  try {
    existing = JSON.parse(await fs.readFile(VISIBLE_HASHTAG_PATH, "utf-8")) || [];
  } catch { existing = []; }

  const merged = new Map(existing.map((x) => [String(x.id), x]));
  for (const e of entries) {
    const prev = merged.get(String(e.id)) || {};
    // 用新值覆盖旧值，同时保留旧值里可能存在但新值没有的字段（如 lastRefreshedAt）
    merged.set(String(e.id), { ...prev, ...e, id: String(e.id) });
  }

  const toWrite = Array.from(merged.values());
  // ✅ 原子写入
  await writeVisibleHashtagAtomic(toWrite);
  return json({ ok: true, op: "saveVisible", mode: "merge", count: entries.length, total: toWrite.length });
}


/* ---------- Page ---------- */
export default function AdminHashtagUGC() {
  const data = useLoaderData(); // { hashtag: Promise, visible, products }
  const saver = useFetcher();
  const refresher = useFetcher();
  const navigation = useNavigation();

  return (
    <Page>
      <InlineStack align="space-between" blockAlign="center">
        <Text as="h1" variant="headingLg">UGC Admin — Hashtags (#)</Text>
        <refresher.Form method="post">
          <input type="hidden" name="op" value="refresh" />
          <Button submit loading={refresher.state !== "idle"}>Refresh Hashtag Pool</Button>
        </refresher.Form>
      </InlineStack>

      <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 120px)", marginTop: 16 }}>
        <div style={{ flex: "1 1 auto" }}>
          <Suspense fallback={<GridSkeleton />}>
            <Await resolve={data.hashtag}>
              {(h) => (
                <>
                  <BlockStack gap="400" id="tab-hashtag">
                    <Section
                      title="Hashtag (#)"
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
                    hash="#hashtag"
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
    stack.push(usp.get("hCursor") || "");
    writeStackSS(stackKey, stack);
    usp.set("hCursor", view.nextCursorB64 || "");
    usp.set("hSize", String(view.pageSize || 12));
    navigate(`?${usp.toString()}${hash}`, { preventScrollReset: true });
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
    else usp.delete("hCursor");
    usp.set("hSize", String(view.pageSize || 12));
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

/* ---------- Shared Section（同步 visible → selected；默认 merge 保存） ---------- */
function Section({ title, source, pool, visible, products, saver }) {
  const initialSelected = useMemo(() => {
    const m = new Map();
    (visible || []).forEach((v) => m.set(v.id, v));
    return m;
  }, [visible]);

  const [selected, setSelected] = useState(initialSelected);
  const opRef = useRef(null); // 用于切换 op

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
      {/* 默认保存 */}
      <input ref={opRef} type="hidden" name="op" value="saveVisible" />

      <InlineStack align="space-between" blockAlign="center">
        <Text as="h2" variant="headingLg">{title}</Text>

        <InlineStack gap="200">
          <Button
            submit
            onClick={() => { if (opRef.current) opRef.current.value = "saveVisible"; }}
            primary
          >
            Save visible list (hashtags)
          </Button>
          <Button
            submit
            onClick={() => { if (opRef.current) opRef.current.value = "refreshVisible"; }}
          >
            Refresh media URL (checked)
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
            <Card key={`hashtag-${item.id}`} padding="400">
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center">
                  <Tag>#{item.hashtag || "hashtag"}</Tag>
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
                      options={products.map((p) => ({ label: p.title, value: p.handle }))}
                      value={chosenProducts[0] || ""}
                      onChange={(v) => changeProducts(item.id, v)}
                    />
                    {/* 勾选才提交；这里带上 hashtag */}
                    <input
                      type="hidden"
                      name="ugc_entry"
                      value={JSON.stringify({
                        id: item.id,
                        hashtag: item.hashtag || "",
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


/* ---------- Skeleton Grid ---------- */
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
    id: seed.id,
    hashtag: seed.hashtag || "",   // 关键：保存 hashtag，供刷新时定位
    username: seed.username || "",
    timestamp: seed.timestamp || "",
    media_type: seed.media_type || "IMAGE",
    media_url: seed.media_url || "",
    thumbnail_url: seed.thumbnail_url || "",
    caption: seed.caption || "",
    permalink: seed.permalink || "",
  };
}


/* ---------- 通过 media_id 或 hashtag 重新获取“新鲜”的 media_url ---------- */

// 先尝试用 media_id 直接拉详情（更稳、更快）
async function getMediaDetail(mediaId) {
  if (!mediaId) return null;
  const token = USER_TOKEN || PAGE_TOKEN;
  if (!token) return null;

  const fields =
    "id,media_type,media_url,thumbnail_url,caption,username,timestamp,permalink,children{media_type,media_url,thumbnail_url}";
  const u = new URL(`https://graph.facebook.com/v23.0/${encodeURIComponent(mediaId)}`);
  u.searchParams.set("fields", fields);
  u.searchParams.set("access_token", token);

  const r = await withLimit(() => fetch(u));
  const j = await r.json();
  if (!r.ok || j?.error) return null;

  let media_type = j.media_type;
  let media_url = j.media_url || "";
  let thumbnail_url = j.thumbnail_url || "";

  if (j.media_type === "CAROUSEL_ALBUM" && j.children?.data?.length) {
    const first = j.children.data[0];
    media_type = first.media_type || media_type;
    media_url = first.media_url || media_url;
    thumbnail_url = first.thumbnail_url || thumbnail_url || media_url;
  }
  return { media_type, media_url, thumbnail_url };
}

/**
 * 根据 visible 里的条目刷新 media_url：
 * 1) 优先用 media_id 直接查详情；
 * 2) 不行再按 hashtag 的 top_media → recent_media 扫描匹配同 id。
 * @param {object} entry - { id, hashtag, ... }
 * @param {object} opts  - { per=25, maxPages=2 }
 */
export async function refreshMediaUrlByHashtag(entry, { per = 25, maxPages = 2 } = {}) {
  const out = { ...entry };

  // 1) 直接用 media_id 拉详情（通常就够了）
  try {
    const d = await getMediaDetail(entry.id);
    if (d && (d.media_url || d.thumbnail_url)) {
      out.media_type = d.media_type || out.media_type;
      out.media_url = d.media_url || d.thumbnail_url || out.media_url || "";
      out.thumbnail_url = d.thumbnail_url || out.thumbnail_url || null;
      return out;
    }
  } catch {}

  // 2) fallback：按 hashtag 扫描
  const tag = String(entry.hashtag || "").replace(/^#/, "").trim();
  if (!tag) return out;

  try {
    const hId = await getHashtagId(tag);
    if (!hId) return out;

    for (const edge of ["top_media", "recent_media"]) {
      let after = "";
      for (let i = 0; i < maxPages; i++) {
        const page = await edgePage({ hashtagId: hId, edge, limit: per, after });
        const hit = (page.items || []).find((m) => String(m.id) === String(entry.id));
        if (hit) {
          out.media_type = hit.media_type || out.media_type;
          out.media_url = hit.media_url || out.media_url || "";
          // hashtag edges没有 thumbnail_url，这里保持原值
          return out;
        }
        if (!page.nextAfter) break;
        after = page.nextAfter;
      }
    }
  } catch {}

  return out;
}
