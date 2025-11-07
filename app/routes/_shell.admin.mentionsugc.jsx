// app/routes/_shell.admin.mentionsugc.jsx
import { defer, json } from "@remix-run/node";
import {
  useLoaderData, useFetcher, useNavigate, useLocation, useNavigation, Await,
} from "@remix-run/react";
import {
  Page, Card, Text, Checkbox, Button, Select, Tag, InlineStack,
  BlockStack, SkeletonBodyText, Banner, Badge,
} from "@shopify/polaris";
import { Suspense, useMemo, useState, useEffect, useRef } from "react";
import fs from "fs/promises";
import path from "path";
import { VISIBLE_TAG_PATH, ensureVisibleTagFile } from "../lib/persistPaths.js";
import { fetchTagUGCPage, refreshMediaUrlByTag, scanTagsUntil } from "../lib/fetchHashtagUGC.js";
// ⬇️ 新增
import { r2PutObject } from "../lib/r2Client.server.js";

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
  try { return JSON.parse((await fs.readFile(file, "utf-8")) || fallback); }
  catch { return JSON.parse(fallback); }
}
function readStackSS(key){ try { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) : []; } catch { return []; } }
function writeStackSS(key, arr){ try { sessionStorage.setItem(key, JSON.stringify(arr)); } catch {} }

export function sortFeaturedThenTime(list = []) {
  return [...list].sort((a, b) => {
    const fa = a?.featured ? 1 : 0;
    const fb = b?.featured ? 1 : 0;
    if (fb !== fa) return fb - fa;
    const ta = a?.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b?.timestamp ? new Date(b.timestamp).getTime() : 0;
    return tb - ta;
  });
}

export async function loader({ request }) {
  const url = new URL(request.url);
  const tSize = Math.min(40, Math.max(6, Number(url.searchParams.get("tSize") || 12)));
  const tAfter = url.searchParams.get("tAfter") || "";

  const envMissing = [];
  if (!process.env.INSTAGRAM_IG_ID) envMissing.push("INSTAGRAM_IG_ID");
  if (!process.env.INSTAGRAM_ACCESS_TOKEN) envMissing.push("INSTAGRAM_ACCESS_TOKEN");

  await ensureVisibleTagFile();
  const [tagVisible, products] = await Promise.all([
    readJsonSafe(VISIBLE_TAG_PATH),
    readJsonSafe(path.resolve("public/products.json"), "[]"),
  ]);

  const tagPromise = (async () => {
    try {
      const page = await fetchTagUGCPage({ limit: tSize, after: tAfter });
      return { items: page.items || [], nextAfter: page.nextAfter || "", pageSize: tSize };
    } catch {
      return { items: [], nextAfter: "", pageSize: tSize };
    }
  })();

  return defer(
    { tag: tagPromise, visible: tagVisible, products, envMissing },
    { headers: { "Cache-Control": "private, max-age=30" } }
  );
}

export async function action({ request }) {
  const fd = await request.formData();
  const op = fd.get("op");

  if (op === "refreshVisibleAll") {
    await ensureVisibleTagFile();
    let visible = [];
    try { visible = JSON.parse(await fs.readFile(VISIBLE_TAG_PATH, "utf-8")) || []; } catch {}

    const targetIds = visible.map((v) => String(v.id));
    const safeScan = async () => {
      try {
        return await scanTagsUntil({ targetIds, per: 50, maxScan: 10000, hardPageCap: 300 });
      } catch (e) {
        console.error("scanTagsUntil failed:", e);
        return { hits: new Map(), scanned: 0, pages: 0, done: false, error: String(e?.message || e) };
      }
    };

    const nowISO = new Date().toISOString();
    const { hits = new Map(), scanned = 0, pages = 0, done = false } = (await safeScan()) || {};

    const merged = visible.map((v) => {
      const hit = hits.get(String(v.id));
      if (!hit) {
        return { ...v, lastRefreshedAt: nowISO, lastRefreshError: v.lastRefreshError ?? null };
      }
      const nextMedia = hit.media_url || v.media_url || "";
      const nextThumb = (hit.thumbnail_url ?? v.thumbnail_url) ?? null;
      const changed = (nextMedia && nextMedia !== v.media_url) ||
                      (nextThumb && nextThumb !== v.thumbnail_url) ||
                      (hit.media_type && hit.media_type !== v.media_type);

      return {
        ...v,
        media_type: hit.media_type || v.media_type,
        media_url: nextMedia,
        thumbnail_url: nextThumb,
        caption: hit.caption ?? v.caption,
        permalink: hit.permalink || v.permalink,
        timestamp: hit.timestamp || v.timestamp,
        username: hit.username || v.username,
        lastRefreshedAt: nowISO,
        ...(changed ? { lastFoundAt: nowISO } : {}),
        lastRefreshError: null,
      };
    });

    await fs.writeFile(VISIBLE_TAG_PATH, JSON.stringify(merged, null, 2), "utf-8");
    const updatedCount = merged.reduce((n, m, i) => {
      const old = visible[i] || {};
      return n + ((m.media_url !== old.media_url) || (m.thumbnail_url !== old.thumbnail_url) ? 1 : 0);
    }, 0);

    return json({ ok: true, op: "refreshVisibleAll", total: merged.length, updated: updatedCount, scanned, pages, done });
  }

  if (op === "refreshVisible") {
    const picked = fd.getAll("ugc_entry").map((s) => JSON.parse(s));
    const idSet = new Set(picked.map((e) => String(e.id)));

    await ensureVisibleTagFile();
    let visible = [];
    try { visible = JSON.parse(await fs.readFile(VISIBLE_TAG_PATH, "utf-8")) || []; } catch {}

    const nowISO = new Date().toISOString();
    const updated = [];
    for (const v of visible) {
      if (!idSet.has(String(v.id))) { updated.push(v); continue; }
      try {
        const fresh = await refreshMediaUrlByTag(v, { per: 50, maxScan: 5000, hardPageCap: 200 });
        const nextMedia = fresh.media_url || v.media_url || "";
        const nextThumb = (fresh.thumbnail_url ?? v.thumbnail_url) ?? null;
        const found = (nextMedia && nextMedia !== v.media_url) || (nextThumb && nextThumb !== v.thumbnail_url);

        updated.push({
          ...v, ...fresh, media_url: nextMedia, thumbnail_url: nextThumb,
          lastRefreshedAt: nowISO, ...(found ? { lastFoundAt: nowISO } : {}), lastRefreshError: null,
        });
      } catch {
        updated.push({ ...v, lastRefreshedAt: nowISO, lastRefreshError: "fetch_failed" });
      }
    }

    await fs.writeFile(VISIBLE_TAG_PATH, JSON.stringify(updated, null, 2), "utf-8");
    return json({ ok: true, op: "refreshVisible", refreshed: idSet.size, total: updated.length });
  }

  // ⬇️ 保存可见列表（含 featured）前：上传到 R2
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
      featured: !!e.featured,
    };
  });

  async function ensureOnCDN(e) {
    const base = (process.env.CF_R2_PUBLIC_BASE || "").replace(/\/+$/, "");
    if (base && e.media_url && e.media_url.startsWith(base + "/")) return e;

    const res = await fetch(e.media_url, { redirect: "follow" });
    if (!res.ok) throw new Error(`fetch media ${e.id} failed: ${res.status}`);
    const ct = res.headers.get("content-type") || "application/octet-stream";
    const buf = Buffer.from(await res.arrayBuffer());

    const ext = (() => {
      if (ct.includes("jpeg")) return "jpg";
      if (ct.includes("png")) return "png";
      if (ct.includes("webp")) return "webp";
      if (ct.includes("gif")) return "gif";
      if (ct.includes("mp4")) return "mp4";
      return e.media_type === "VIDEO" ? "mp4" : "bin";
    })();

    const key = `mentions/${e.username || "author"}/${e.id}.${ext}`;
    const cdnUrl = await r2PutObject(key, buf, ct);
    return { ...e, media_url: cdnUrl, thumbnail_url: e.thumbnail_url || cdnUrl };
  }

  const uploaded = [];
  for (const it of entries) {
    try { uploaded.push(await ensureOnCDN(it)); }
    catch (err) {
      uploaded.push(it);
      console.error("R2 upload failed:", it.id, err?.message || err);
    }
  }

  await ensureVisibleTagFile();

  if (mode === "replace") {
    const nowISO = new Date().toISOString();
    const replaced = uploaded.map((e) => ({
      ...e, ...(e.featured ? { featuredAt: e.featuredAt || nowISO } : {}),
    }));
    await fs.writeFile(VISIBLE_TAG_PATH, JSON.stringify(replaced, null, 2), "utf-8");
    return json({ ok: true, mode: "replace", count: replaced.length, r2: true });
  }

  let existing = [];
  try { existing = JSON.parse(await fs.readFile(VISIBLE_TAG_PATH, "utf-8")) || []; } catch {}

  const nowISO = new Date().toISOString();
  const byId = new Map(existing.map((x) => [String(x.id), x]));
  for (const e of uploaded) {
    const prev = byId.get(e.id) || {};
    const becameFeatured = (!prev.featured && e.featured);
    byId.set(e.id, { ...prev, ...e, ...(becameFeatured ? { featuredAt: nowISO } : {}) });
  }

  const toWrite = Array.from(byId.values());
  await fs.writeFile(VISIBLE_TAG_PATH, JSON.stringify(toWrite, null, 2), "utf-8");
  return json({ ok: true, mode: "merge", count: uploaded.length, total: toWrite.length, r2: true });
}

export default function AdminMentionsUGC() {
  const data = useLoaderData();
  const saver = useFetcher();
  const navigation = useNavigation();

  return (
    <Page>
      <InlineStack align="space-between" blockAlign="center">
        <Text as="h1" variant="headingLg">UGC Admin — Mentions (tags)</Text>
        <Text as="span" tone="subdued">前端只读 visible_tag.json</Text>
      </InlineStack>

      {(data?.envMissing?.length > 0) && (
        <div style={{ marginTop: 12 }}>
          <Banner tone="critical" title="Missing Instagram credentials">
            <p>Missing env: {data.envMissing.join(", ")}。</p>
          </Banner>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 120px)", marginTop: 16 }}>
        <div style={{ flex: "1 1 auto" }}>
          <Suspense fallback={<GridSkeleton />}>
            <Await resolve={data.tag}>
              {(t) => (
                <>
                  {Array.isArray(t.items) && t.items.length === 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <Banner tone="info" title="No items returned">
                        <p>/tags 暂无结果，检查 token 权限或稍后重试。</p>
                      </Banner>
                    </div>
                  )}

                  <BlockStack gap="400" id="tab-mentions">
                    <Section
                      title="Mentions (tags)"
                      source="tags"
                      pool={t.items}
                      visible={data.visible}
                      products={data.products}
                      saver={saver}
                    />
                  </BlockStack>

                  <Pager view={t} routeLoading={navigation.state !== "idle"} hash="#tags" stackKey="ugc:tStack" />
                </>
              )}
            </Await>
          </Suspense>
        </div>
      </div>
    </Page>
  );
}

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
    if (view.nextAfter) usp.set("tAfter", view.nextAfter); else usp.delete("tAfter");
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
    if (prevAfter) usp.set("tAfter", prevAfter); else usp.delete("tAfter");
    usp.set("tSize", String(view.pageSize || 12));
    navigate(`?${usp.toString()}${hash}`, { preventScrollReset: true });
  };

  useEffect(() => { if (navigation.state === "idle") setBusy(false); }, [navigation.state]);

  return (
    <div style={{ borderTop: "1px solid var(--p-color-border, #e1e3e5)", padding: "12px 0", marginTop: 16 }}>
      <InlineStack align="center" gap="200">
        <Button onClick={goPrev} disabled={!canPrev || routeLoading || busy} loading={routeLoading || busy}>Prev page</Button>
        <Button primary onClick={goNext} disabled={routeLoading || busy || !view.nextAfter} loading={routeLoading || busy}>Next page</Button>
      </InlineStack>
    </div>
  );
}

function Section({ title, source, pool, visible, products, saver }) {
  const initialSelected = useMemo(() => {
    const m = new Map();
    (visible || []).forEach((v) => m.set(String(v.id), v));
    return m;
  }, [visible]);

  const [selected, setSelected] = useState(initialSelected);
  const opRef = useRef(null);

  const toggle = (id, seed) =>
    setSelected((prev) => {
      const n = new Map(prev);
      const k = String(id);
      if (n.has(k)) n.delete(k);
      else n.set(k, seedToVisible(seed, n.get(k)));
      return n;
    });

  const changeCategory = (id, category) =>
    setSelected((prev) => {
      const n = new Map(prev);
      const it = n.get(String(id));
      if (it) it.category = category;
      return n;
    });

  const changeProducts = (id, handle) =>
    setSelected((prev) => {
      const n = new Map(prev);
      const it = n.get(String(id));
      if (it) it.products = handle ? [handle] : [];
      return n;
    });

  const changeFeatured = (id, v) =>
    setSelected((prev) => {
      const n = new Map(prev);
      const it = n.get(String(id));
      if (it) it.featured = !!v;
      return n;
    });

  return (
    <saver.Form method="post">
      <input type="hidden" name="source" value={source} />
      <input ref={opRef} type="hidden" name="op" value="saveVisible" />

      <InlineStack align="space-between" blockAlign="center">
        <Text as="h2" variant="headingLg">{title}</Text>
        <InlineStack gap="200">
          <Button submit onClick={() => { if (opRef.current) opRef.current.value = "saveVisible"; }} primary>Save visible list (mentions)</Button>
          <Button submit onClick={() => { if (opRef.current) opRef.current.value = "refreshVisible"; }}>Refresh media URL (checked)</Button>
          <Button submit onClick={() => { if (opRef.current) opRef.current.value = "refreshVisibleAll"; }}>Refresh ALL visible</Button>
        </InlineStack>
      </InlineStack>

      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 24 }}>
        {pool.map((item) => {
          const isVideo = item.media_type === "VIDEO";
          const picked = selected.get(String(item.id));
          const isChecked = !!picked;
          const category = picked?.category || "camping";
          const chosenProducts = picked?.products || [];
          const isFeatured = !!picked?.featured;
          const thumb = item.thumbnail_url || item.media_url || TINY;

          return (
            <Card key={`tag-${item.id}`} padding="400">
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center">
                  <Tag>@{item.username || "author"}</Tag>
                  {isFeatured && <Badge tone="success">Featured</Badge>}
                  <Text as="span" variant="bodySm" tone="subdued">
                    {item.timestamp ? new Date(item.timestamp).toLocaleString() : ""}
                  </Text>
                </InlineStack>

                <a href={item.permalink} target="_blank" rel="noreferrer">
                  {isVideo ? (
                    <video controls muted preload="metadata" playsInline style={{ width: "100%", height: 200, objectFit: "cover", borderRadius: 8 }}>
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
                    <Checkbox label="Featured（精选，前台置顶显示）" checked={isFeatured} onChange={(v) => changeFeatured(item.id, v)} />
                    <Select label="Category" options={CATEGORY_OPTIONS} value={category} onChange={(v) => changeCategory(item.id, v)} />
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
                        category,
                        products: chosenProducts,
                        username: item.username,
                        timestamp: item.timestamp,
                        media_type: item.media_type,
                        media_url: item.media_url,
                        thumbnail_url: item.thumbnail_url,
                        caption: item.caption,
                        permalink: item.permalink,
                        featured: isFeatured,
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
    <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 24 }}>
      {Array.from({ length: 12 }).map((_, i) => (
        <Card key={i} padding="400">
          <div style={{ width: "100%", height: 200, background: "var(--p-color-bg-surface-tertiary, #F1F2F4)", borderRadius: 8 }} />
          <div style={{ marginTop: 12 }}><SkeletonBodyText lines={2} /></div>
        </Card>
      ))}
    </div>
  );
}

function seedToVisible(seed, prev) {
  return {
    category: prev?.category || "camping",
    products: prev?.products || [],
    id: seed.id,
    username: seed.username || "",
    timestamp: seed.timestamp || "",
    media_type: seed.media_type || "IMAGE",
    media_url: seed.media_url || "",
    thumbnail_url: seed.thumbnail_url || "",
    caption: seed.caption || "",
    permalink: seed.permalink || "",
    featured: !!prev?.featured,
    featuredAt: prev?.featuredAt || undefined,
  };
}
