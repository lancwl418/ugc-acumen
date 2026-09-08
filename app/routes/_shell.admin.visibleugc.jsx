// app/routes/_shell.admin.visibleugc.jsx
// Visible UGC — everything currently shown on the storefront (VisibleMention).
// Grouped by scenario category; each card can change category / linked
// products / featured and save on its own, or be removed from the site.
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useSearchParams } from "@remix-run/react";
import {
  Page, Card, Text, BlockStack, InlineStack, Tag, Badge, Button, Select,
  Checkbox, Tabs, Banner,
} from "@shopify/polaris";
import { useEffect, useMemo, useState } from "react";
import { getAllVisible, getProducts } from "../lib/visibleMentions.js";
import { saveVisibleOne } from "../lib/visibleSave.server.js";
import { syncProducts } from "../lib/shopifyProducts.server.js";
import { authenticate } from "../shopify.server.js";
import { CATEGORY_OPTIONS, categoryLabel, TINY, ProductMultiSelect } from "../components/UgcFields.jsx";

export async function loader({ request }) {
  // Keep the Product table fresh (TTL inside syncProducts); fall back to the
  // stored table if Shopify is unreachable so the page still renders.
  const { admin } = await authenticate.admin(request);
  const [items, products] = await Promise.all([
    getAllVisible(),
    syncProducts({ admin }).then((r) => r.products).catch(() => getProducts()),
  ]);
  return json({ items, products });
}

export async function action({ request }) {
  await authenticate.admin(request);
  const fd = await request.formData();
  if (fd.get("op") !== "saveOne") {
    return json({ ok: false, error: "Unknown op" }, { status: 400 });
  }
  const raw = fd.get("ugc_entry");
  if (!raw) return json({ ok: false, op: "saveOne", error: "Missing entry" }, { status: 400 });
  const visible = String(fd.get("visible") || "1") !== "0";
  return json(await saveVisibleOne({ entry: raw, visible }));
}

const ALL = "all";
const OTHER = "other";

export default function VisibleUGCPage() {
  const { items, products } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();

  // Group by category; anything outside the known set lands in "Other".
  const knownIds = useMemo(() => new Set(CATEGORY_OPTIONS.map((c) => c.value)), []);
  const groups = useMemo(() => {
    const g = {};
    for (const c of CATEGORY_OPTIONS) g[c.value] = [];
    g[OTHER] = [];
    for (const it of items) {
      const k = knownIds.has(it.category) ? it.category : OTHER;
      g[k].push(it);
    }
    return g;
  }, [items, knownIds]);

  const tabs = useMemo(() => {
    const list = [{ id: ALL, content: `All (${items.length})` }];
    for (const c of CATEGORY_OPTIONS) {
      list.push({ id: c.value, content: `${c.label} (${groups[c.value].length})` });
    }
    if (groups[OTHER].length) list.push({ id: OTHER, content: `Other (${groups[OTHER].length})` });
    return list;
  }, [items.length, groups]);

  const wanted = searchParams.get("cat") || ALL;
  const selectedIndex = Math.max(0, tabs.findIndex((t) => t.id === wanted));
  const current = tabs[selectedIndex].id;

  const onTab = (idx) => {
    const id = tabs[idx].id;
    const next = new URLSearchParams(searchParams);
    if (id === ALL) next.delete("cat"); else next.set("cat", id);
    setSearchParams(next, { replace: true, preventScrollReset: true });
  };

  const sectionsToShow = current === ALL
    ? Object.keys(groups).filter((k) => groups[k].length)
    : [current];

  return (
    <Page title={`Visible UGC — ${items.length} items`} backAction={{ url: "/" }}>
      <BlockStack gap="400">
        <Text as="p" tone="subdued">
          Everything here is live on the storefront. Change a card and press its Save button,
          or remove it from the site. Newly curated posts come from UGC — Mentions.
        </Text>

        <Tabs tabs={tabs} selected={selectedIndex} onSelect={onTab} />

        {items.length === 0 && (
          <Banner tone="info"><p>Nothing is visible yet. Pick posts in UGC — Mentions and tick “Show on site”.</p></Banner>
        )}

        {sectionsToShow.map((k) => {
          const list = groups[k] || [];
          return (
            <BlockStack key={k} gap="300">
              {current === ALL && (
                <InlineStack gap="200" blockAlign="baseline">
                  <Text as="h2" variant="headingLg">{k === OTHER ? "Other" : categoryLabel(k)}</Text>
                  <Text as="span" tone="subdued">{list.length} item{list.length === 1 ? "" : "s"}</Text>
                </InlineStack>
              )}
              {list.length === 0 ? (
                <Text as="p" tone="subdued">No posts in this category.</Text>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                    gap: 24,
                  }}
                >
                  {list.map((item) => (
                    <VisibleCard key={item.id} item={item} products={products} />
                  ))}
                </div>
              )}
            </BlockStack>
          );
        })}
      </BlockStack>
    </Page>
  );
}

const draftOf = (item) => ({
  category: item.category || "driving",
  products: Array.isArray(item.products) ? item.products : [],
  featured: !!item.featured,
});
const snap = (d) => JSON.stringify(d);

function VisibleCard({ item, products }) {
  const fetcher = useFetcher();
  const [draft, setDraft] = useState(() => draftOf(item));
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Loader revalidates after a save; resync the draft from the stored row.
  const stored = snap(draftOf(item));
  useEffect(() => { setDraft(draftOf(item)); }, [stored]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = snap(draft) !== stored;
  const busy = fetcher.state !== "idle";
  const result = fetcher.state === "idle" ? fetcher.data : null;
  const isVideo = item.media_type === "VIDEO";
  const thumb = item.thumbnail_url || item.media_url || TINY;

  const submit = (visible) => {
    fetcher.submit(
      {
        op: "saveOne",
        visible: visible ? "1" : "0",
        ugc_entry: JSON.stringify({
          id: item.id,
          category: draft.category,
          products: draft.products,
          featured: draft.featured,
          username: item.username,
          timestamp: item.timestamp,
          media_type: item.media_type,
          media_url: item.media_url,
          thumbnail_url: item.thumbnail_url,
          caption: item.caption,
          permalink: item.permalink,
        }),
      },
      { method: "post" },
    );
    setConfirmRemove(false);
  };

  return (
    <Card padding="400">
      <BlockStack gap="200">
        <InlineStack gap="200" blockAlign="center">
          <Tag>@{item.username || "author"}</Tag>
          {item.featured && <Badge tone="success">Featured</Badge>}
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

        <InlineStack gap="300" blockAlign="center">
          <Text as="span" variant="bodySm" tone="subdued">{item.like_count ?? 0} likes</Text>
          <Text as="span" variant="bodySm" tone="subdued">{item.comments_count ?? 0} comments</Text>
        </InlineStack>

        <Checkbox
          label="Featured (pinned to top on storefront)"
          checked={draft.featured}
          onChange={(v) => setDraft((d) => ({ ...d, featured: !!v }))}
        />
        <Select
          label="Category"
          options={CATEGORY_OPTIONS}
          value={draft.category}
          onChange={(v) => setDraft((d) => ({ ...d, category: v }))}
        />
        <ProductMultiSelect
          products={products}
          value={draft.products}
          onChange={(handles) => setDraft((d) => ({ ...d, products: handles }))}
        />

        <InlineStack gap="200" blockAlign="center" wrap>
          <Button
            size="slim"
            variant={dirty ? "primary" : "secondary"}
            loading={busy}
            disabled={!dirty || busy}
            onClick={() => submit(true)}
          >
            Save
          </Button>
          {confirmRemove ? (
            <>
              <Button size="slim" tone="critical" variant="primary" disabled={busy} onClick={() => submit(false)}>
                Confirm remove
              </Button>
              <Button size="slim" variant="plain" disabled={busy} onClick={() => setConfirmRemove(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="slim" tone="critical" disabled={busy} onClick={() => setConfirmRemove(true)}>
              Remove from site
            </Button>
          )}
          {dirty && !busy && (
            <Text as="span" variant="bodySm" tone="caution">Unsaved changes</Text>
          )}
          {!dirty && result?.ok && result.visible && (
            <Text as="span" variant="bodySm" tone="success">✓ Saved</Text>
          )}
          {result && !result.ok && (
            <Text as="span" variant="bodySm" tone="critical">{result.error || "Save failed"}</Text>
          )}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
