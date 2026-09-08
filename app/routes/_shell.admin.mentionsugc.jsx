// app/routes/_shell.admin.mentionsugc.jsx
import { defer, json } from "@remix-run/node";
import {
  useLoaderData, useFetcher, useNavigate, useLocation, useNavigation, Await,
} from "@remix-run/react";
import {
  Page, Card, Text, Checkbox, Button, Select, Tag, InlineStack,
  BlockStack, SkeletonBodyText, Banner, Badge, TextField,
} from "@shopify/polaris";
import { Suspense, useMemo, useState, useEffect, useRef } from "react";
import {
  getAllVisible, upsertManyVisible, replaceAllVisible, getProducts,
} from "../lib/visibleMentions.js";
import { parseEntry, ensureOnCDN, saveVisibleOne } from "../lib/visibleSave.server.js";
import { CATEGORY_OPTIONS, TINY, ProductMultiSelect } from "../components/UgcFields.jsx";
import {
  fetchTagUGCPage, refreshMediaUrlByTag, scanTagsUntil,
  fetchPostByShortcode, shortcodeFromPermalink,
} from "../lib/instagramAPI.js";
import { syncProducts, describeError, PRODUCT_CATEGORY } from "../lib/shopifyProducts.server.js";
import { authenticate } from "../shopify.server.js";


// readJsonSafe removed — now using Prisma DB
function readStackSS(key){ try { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) : []; } catch { return []; } }
function writeStackSS(key, arr){ try { sessionStorage.setItem(key, JSON.stringify(arr)); } catch {} }

function sortFeaturedThenTime(list = []) {
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
  // 用嵌入式 token exchange 拿 Admin client（同时会把离线 session 写进 Session 表），
  // 产品同步直接用它，不再依赖 Session 表里已有的离线 token。
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const tSize = Math.min(40, Math.max(6, Number(url.searchParams.get("tSize") || 12)));
  const tAfter = url.searchParams.get("tAfter") || "";

  // mentions 现在走 FlashAPI（RapidAPI flashapi1），不再依赖 Graph。
  const envMissing = [];
  if (!process.env.RAPIDAPI_KEY) envMissing.push("RAPIDAPI_KEY");
  if (!process.env.INSTAGRAM_USERNAME) envMissing.push("INSTAGRAM_USERNAME");

  // Linked Products 选项：从 Shopify 同步指定分类（PRODUCT_CATEGORY）的产品到
  // Product 表（带 TTL）。同步失败则退回读表，并把错误显示在页面上。
  let productsError = "";
  const [tagVisible, products] = await Promise.all([
    getAllVisible(),
    syncProducts({ admin })
      .then((r) => r.products)
      .catch(async (err) => {
        console.error("[products] sync failed:", err);
        productsError = describeError(err);
        return getProducts();
      }),
  ]);

  // No fetch timeout — let the FlashAPI mentions fetch run to completion so the
  // page shows data on first load. flashGet has its own per-request timeout +
  // retries underneath, and entry.server's streamTimeout is the final safety net.
  const tagPromise = (async () => {
    try {
      const page = await fetchTagUGCPage({ limit: tSize, after: tAfter });
      return { items: page.items || [], nextAfter: page.nextAfter || "", pageSize: tSize };
    } catch {
      return { items: [], nextAfter: "", pageSize: tSize };
    }
  })();

  return defer(
    { tag: tagPromise, visible: tagVisible, products, productsError, productCategory: PRODUCT_CATEGORY, envMissing },
    { headers: { "Cache-Control": "private, max-age=30" } }
  );
}

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const fd = await request.formData();
  const op = fd.get("op");

  // 手动输入 IG 链接 → 按 shortcode 抓单帖，返回归一化后的 item（不写库，
  // 由前端选好 category 后走常规 saveVisible 流程保存）。
  if (op === "fetchByLink") {
    const link = String(fd.get("link") || "").trim();
    const code = shortcodeFromPermalink(link);
    if (!code) {
      return json({ ok: false, op: "fetchByLink", error: "Could not read the link — paste an Instagram post / Reel URL" }, { status: 400 });
    }
    try {
      const item = await fetchPostByShortcode(code);
      if (!item) return json({ ok: false, op: "fetchByLink", error: "Post not found (it may be private or deleted)" });
      return json({ ok: true, op: "fetchByLink", item });
    } catch (err) {
      return json({ ok: false, op: "fetchByLink", error: err?.message || "Fetch failed, please try again" });
    }
  }

  if (op === "syncProducts") {
    try {
      const r = await syncProducts({ force: true, admin });
      return json({ ok: true, op: "syncProducts", count: r.products.length });
    } catch (err) {
      return json({ ok: false, op: "syncProducts", error: describeError(err) });
    }
  }

  if (op === "refreshVisibleAll") {
    const visible = await getAllVisible();

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

    await upsertManyVisible(merged);
    const updatedCount = merged.reduce((n, m, i) => {
      const old = visible[i] || {};
      return n + ((m.media_url !== old.media_url) || (m.thumbnail_url !== old.thumbnail_url) ? 1 : 0);
    }, 0);

    return json({ ok: true, op: "refreshVisibleAll", total: merged.length, updated: updatedCount, scanned, pages, done });
  }

  if (op === "refreshVisible") {
    const picked = fd.getAll("ugc_entry").map((s) => JSON.parse(s));
    const idSet = new Set(picked.map((e) => String(e.id)));

    const visible = await getAllVisible();

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

    await upsertManyVisible(updated);
    return json({ ok: true, op: "refreshVisible", refreshed: idSet.size, total: updated.length });
  }

  // 单卡片保存：只写这一条。visible=0 → 从 VisibleMention 删除；
  // visible=1 → 上传 R2 后 upsert（与整页 merge 保存同样的逻辑）。
  if (op === "saveOne") {
    const raw = fd.get("ugc_entry");
    if (!raw) return json({ ok: false, op: "saveOne", error: "Missing entry" }, { status: 400 });
    const visible = String(fd.get("visible") || "1") !== "0";
    return json(await saveVisibleOne({ entry: raw, visible }));
  }

  // ⬇️ 保存可见列表（含 featured）前：上传到 R2
  const mode = String(fd.get("mode") || "merge").toLowerCase();
  const entries = fd.getAll("ugc_entry").map(parseEntry);

  const uploaded = [];
  for (const it of entries) {
    try { uploaded.push(await ensureOnCDN(it)); }
    catch (err) {
      uploaded.push(it);
      console.error("R2 upload failed:", it.id, err?.message || err);
    }
  }

  if (mode === "replace") {
    const nowISO = new Date().toISOString();
    const replaced = uploaded.map((e) => ({
      ...e, ...(e.featured ? { featuredAt: e.featuredAt || nowISO } : {}),
    }));
    await replaceAllVisible(replaced);
    return json({ ok: true, mode: "replace", count: replaced.length, r2: true });
  }

  const existing = await getAllVisible();
  const nowISO = new Date().toISOString();
  const byId = new Map(existing.map((x) => [String(x.id), x]));
  for (const e of uploaded) {
    const prev = byId.get(e.id) || {};
    const becameFeatured = (!prev.featured && e.featured);
    byId.set(e.id, { ...prev, ...e, ...(becameFeatured ? { featuredAt: nowISO } : {}) });
  }

  const toWrite = Array.from(byId.values());
  await upsertManyVisible(toWrite);
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
        <Text as="span" tone="subdued">Storefront reads the VisibleMention table only</Text>
      </InlineStack>

      {(data?.envMissing?.length > 0) && (
        <div style={{ marginTop: 12 }}>
          <Banner tone="critical" title="Missing Instagram credentials">
            <p>Missing env: {data.envMissing.join(", ")}.</p>
          </Banner>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <ProductsStatus
          products={data.products}
          error={data.productsError}
          category={data.productCategory}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <ManualAdd visible={data.visible} products={data.products} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 120px)", marginTop: 16 }}>
        <div style={{ flex: "1 1 auto" }}>
          <Suspense fallback={<GridSkeleton />}>
            <Await resolve={data.tag}>
              {(t) => (
                <>
                  {Array.isArray(t.items) && t.items.length === 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <Banner tone="info" title="No items returned">
                        <p>No results from /tags. Check API credentials or try again later.</p>
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

function ManualAdd({ visible, products }) {
  const linkFetcher = useFetcher();
  const saver = useFetcher();
  const [link, setLink] = useState("");
  const [items, setItems] = useState([]);

  const fetching = linkFetcher.state !== "idle";
  const result = linkFetcher.state === "idle" ? linkFetcher.data : null;

  // 每次抓取只显示当前这一条，之前抓过的清掉。
  useEffect(() => {
    if (result?.ok && result.op === "fetchByLink" && result.item) {
      setItems([result.item]);
      setLink("");
    }
  }, [result]);

  const submit = () => {
    const v = link.trim();
    if (!v || fetching) return;
    linkFetcher.submit({ op: "fetchByLink", link: v }, { method: "post" });
  };

  return (
    <Card padding="400">
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">Add manually (paste an Instagram link)</Text>
        <TextField
          label="Instagram post / Reel URL"
          value={link}
          onChange={setLink}
          placeholder="https://www.instagram.com/p/XXXXXXXXX/"
          autoComplete="off"
          disabled={fetching}
          connectedRight={
            <Button onClick={submit} loading={fetching} disabled={fetching || !link.trim()}>
              Fetch
            </Button>
          }
        />
        {result && !result.ok && result.op === "fetchByLink" && (
          <Banner tone="critical"><p>{result.error}</p></Banner>
        )}
        {items.length === 0 && (
          <Text as="p" tone="subdued" variant="bodySm">
            Paste any Instagram post/Reel URL to fetch it, then tick “Show on site”, pick a Category, and save.
          </Text>
        )}
      </BlockStack>

      {items.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Section
            title="Fetched by link"
            source="manual"
            pool={items}
            visible={visible}
            products={products}
            saver={saver}
          />
        </div>
      )}
    </Card>
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

  const isSaving = saver.state !== "idle";
  const saveResult = saver.state === "idle" ? saver.data : null;

  // ── 单卡片保存 ──
  // baseline：每个 id 上次保存成功时的快照（未勾选 = 无记录），用来判断卡片是否有未保存改动。
  const snap = (p) => (p ? JSON.stringify({
    category: p.category || "driving",
    products: Array.isArray(p.products) ? p.products : [],
    featured: !!p.featured,
  }) : "");
  const [baseline, setBaseline] = useState(() => {
    const m = new Map();
    initialSelected.forEach((v, k) => m.set(k, snap(v)));
    return m;
  });
  const cardSaver = useFetcher();
  const pendingRef = useRef(null); // { id, snap }
  const [lastSaved, setLastSaved] = useState(null); // { id, ok, error }
  const cardSaving = cardSaver.state !== "idle";

  useEffect(() => {
    if (cardSaver.state !== "idle" || !cardSaver.data || cardSaver.data.op !== "saveOne") return;
    const d = cardSaver.data;
    const pending = pendingRef.current;
    if (d.ok && pending && pending.id === d.id) {
      setBaseline((prev) => {
        const n = new Map(prev);
        if (d.visible) n.set(d.id, pending.snap); else n.delete(d.id);
        return n;
      });
    }
    setLastSaved({ id: d.id, ok: !!d.ok, error: d.error || "" });
    pendingRef.current = null;
  }, [cardSaver.state, cardSaver.data]);

  // 整页保存成功后，所有勾选项都视为已保存。
  useEffect(() => {
    if (!saveResult?.ok || saveResult.op) return;
    setBaseline(() => {
      const m = new Map();
      selected.forEach((v, k) => m.set(k, snap(v)));
      return m;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveResult]);

  const saveOne = (item, picked) => {
    const id = String(item.id);
    const entry = picked ? {
      id: item.id,
      category: picked.category || "driving",
      products: picked.products || [],
      username: item.username,
      timestamp: item.timestamp,
      media_type: item.media_type,
      media_url: item.media_url,
      thumbnail_url: item.thumbnail_url,
      caption: item.caption,
      permalink: item.permalink,
      featured: !!picked.featured,
    } : { id: item.id, username: item.username };
    pendingRef.current = { id, snap: snap(picked) };
    setLastSaved(null);
    cardSaver.submit(
      { op: "saveOne", visible: picked ? "1" : "0", ugc_entry: JSON.stringify(entry) },
      { method: "post" },
    );
  };

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

  const changeProducts = (id, handles) =>
    setSelected((prev) => {
      const n = new Map(prev);
      const it = n.get(String(id));
      if (it) it.products = Array.isArray(handles) ? handles : [];
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
        <InlineStack gap="300" blockAlign="center">
          {isSaving && <Text as="span" tone="subdued">Saving… (uploading media to CDN, may take a few seconds)</Text>}
          {saveResult?.ok && (
            <Text as="span" tone="success">
              ✓ Saved {saveResult.count ?? saveResult.total ?? 0} item(s)
            </Text>
          )}
          <Button
            submit
            onClick={() => { if (opRef.current) opRef.current.value = "saveVisible"; }}
            primary
            loading={isSaving}
            disabled={isSaving}
          >
            {isSaving ? "Saving…" : "Save visible list (mentions)"}
          </Button>
        </InlineStack>
      </InlineStack>

      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 24 }}>
        {pool.map((item) => {
          const isVideo = item.media_type === "VIDEO";
          const picked = selected.get(String(item.id));
          const isChecked = !!picked;
          const category = picked?.category || "driving";
          const chosenProducts = picked?.products || [];
          const isFeatured = !!picked?.featured;
          const thumb = item.thumbnail_url || item.media_url || TINY;
          const idStr = String(item.id);
          const dirty = snap(picked) !== (baseline.get(idStr) || "");
          const thisSaving = cardSaving && pendingRef.current?.id === idStr;
          const thisResult = lastSaved?.id === idStr ? lastSaved : null;

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
                    <Checkbox label="Featured (pinned to top on storefront)" checked={isFeatured} onChange={(v) => changeFeatured(item.id, v)} />
                    <Select label="Category" options={CATEGORY_OPTIONS} value={category} onChange={(v) => changeCategory(item.id, v)} />
                    <ProductMultiSelect
                      products={products}
                      value={chosenProducts}
                      onChange={(handles) => changeProducts(item.id, handles)}
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

                <InlineStack gap="200" blockAlign="center">
                  <Button
                    size="slim"
                    variant={dirty ? "primary" : "secondary"}
                    loading={thisSaving}
                    disabled={!dirty || cardSaving || isSaving}
                    onClick={() => saveOne(item, picked)}
                  >
                    {isChecked ? "Save this post" : "Remove from site"}
                  </Button>
                  {dirty && !thisSaving && (
                    <Text as="span" variant="bodySm" tone="caution">Unsaved changes</Text>
                  )}
                  {!dirty && thisResult?.ok && (
                    <Text as="span" variant="bodySm" tone="success">✓ Saved</Text>
                  )}
                  {thisResult && !thisResult.ok && (
                    <Text as="span" variant="bodySm" tone="critical">{thisResult.error || "Save failed"}</Text>
                  )}
                </InlineStack>
              </BlockStack>
            </Card>
          );
        })}
      </div>
    </saver.Form>
  );
}

/** 页面顶部：产品同步状态 + 手动同步按钮 */
function ProductsStatus({ products, error, category }) {
  const syncer = useFetcher();
  const syncing = syncer.state !== "idle";
  const result = syncer.state === "idle" ? syncer.data : null;
  const count = Array.isArray(products) ? products.length : 0;

  const button = (
    <Button
      size="slim"
      loading={syncing}
      disabled={syncing}
      onClick={() => syncer.submit({ op: "syncProducts" }, { method: "post" })}
    >
      Sync products from Shopify
    </Button>
  );

  if (error || (result && !result.ok)) {
    return (
      <Banner tone="warning" title={`Could not sync products from Shopify category “${category}”`}>
        <BlockStack gap="200">
          <p>{result && !result.ok ? result.error : error}</p>
          <p>Showing {count} previously synced product(s).</p>
          <div>{button}</div>
        </BlockStack>
      </Banner>
    );
  }

  return (
    <InlineStack gap="300" blockAlign="center">
      <Text as="span" tone="subdued" variant="bodySm">
        Linked Products: {count} product(s) from Shopify category “{category}”
        {result?.ok ? ` · synced ${result.count}` : ""}
      </Text>
      {button}
    </InlineStack>
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
    category: prev?.category || "driving",
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
