// app/routes/_shell.admin.linkimport.jsx
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useFetcher,
} from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  Button,
  Select,
  Checkbox,
  Tag,
  InlineStack,
  BlockStack,
  TextField,
  SkeletonBodyText,
} from "@shopify/polaris";
import { useEffect, useMemo, useState } from "react";
import fs from "fs/promises";
import path from "path";

import {
  VISIBLE_HASHTAG_PATH,
  ensureVisibleHashtagFile,
} from "../lib/persistPaths.js";
import { fetchInstagramByPermalink } from "../lib/fetchHashtagUGC.js";

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

/* ---------------- Loader ---------------- */
export async function loader() {
  await ensureVisibleHashtagFile();
  const [visible, products] = await Promise.all([
    fs
      .readFile(VISIBLE_HASHTAG_PATH, "utf-8")
      .then((s) => JSON.parse(s || "[]"))
      .catch(() => []),
    fs
      .readFile(path.resolve("public/products.json"), "utf-8")
      .then((s) => JSON.parse(s || "[]"))
      .catch(() => []),
  ]);

  return json(
    {
      visibleIds: new Set(visible.map((v) => String(v.id))),
      products,
    },
    { headers: { "Cache-Control": "private, max-age=10" } }
  );
}

/* ---------------- Action ---------------- */
export async function action({ request }) {
  const fd = await request.formData();
  const op = fd.get("op");

  if (op === "lookup") {
    const permalink = String(fd.get("permalink") || "").trim();
    if (!permalink) return json({ ok: false, error: "Empty permalink" }, { status: 400 });

    try {
      const item = await fetchInstagramByPermalink(permalink);
      return json({ ok: true, item });
    } catch (e) {
      return json({ ok: false, error: e?.message || "Lookup failed" }, { status: 500 });
    }
  }

  if (op === "add-visible") {
    const raw = fd.get("ugc_entry");
    if (!raw) return json({ ok: false, error: "Missing entry" }, { status: 400 });

    const entry = JSON.parse(raw);
    await ensureVisibleHashtagFile();

    let list = [];
    try {
      list = JSON.parse(await fs.readFile(VISIBLE_HASHTAG_PATH, "utf-8")) || [];
    } catch {}
    const idx = list.findIndex((x) => String(x.id) === String(entry.id));
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);

    await fs.writeFile(VISIBLE_HASHTAG_PATH, JSON.stringify(list, null, 2), "utf-8");
    return json({ ok: true });
  }

  return json({ ok: false, error: "Unknown op" }, { status: 400 });
}

/* ---------------- Page ---------------- */
export default function AdminImportByLink() {
  const { products, visibleIds } = useLoaderData();
  const searcher = useFetcher();
  const saver = useFetcher();

  const [link, setLink] = useState("");
  const [item, setItem] = useState(null);
  const [checked, setChecked] = useState(true);
  const [category, setCategory] = useState("camping");
  const [product, setProduct] = useState("");

  // when search returns
  useEffect(() => {
    if (searcher.data?.ok && searcher.data.item) {
      const it = searcher.data.item;
      setItem(it);
      setChecked(true);
      setCategory("camping");
      setProduct("");
    }
  }, [searcher.data]);

  const onSearch = () => {
    const fd = new FormData();
    fd.set("op", "lookup");
    fd.set("permalink", link);
    searcher.submit(fd, { method: "post" });
  };

  const onAddVisible = () => {
    if (!item) return;
    const entry = seedToVisible(item, { category, product });
    const fd = new FormData();
    fd.set("op", "add-visible");
    fd.set("ugc_entry", JSON.stringify(entry));
    saver.submit(fd, { method: "post" });
  };

  const alreadyIn = item ? visibleIds.has(String(item.id)) : false;

  return (
    <Page title="Import Instagram by Link">
      <Card padding="400">
        <InlineStack gap="200" blockAlign="center" align="space-between">
          <TextField
            label="Instagram link (post/reel)"
            value={link}
            onChange={setLink}
            placeholder="https://www.instagram.com/p/XXXXXXXXX/ or /reel/XXXXXXXX/"
            autoComplete="off"
            disabled={searcher.state !== "idle"}
          />
          <Button onClick={onSearch} loading={searcher.state !== "idle"} primary>
            Search
          </Button>
        </InlineStack>

        {searcher.data && !searcher.data.ok && (
          <Text tone="critical" as="p" variant="bodySm" style={{ marginTop: 12 }}>
            {searcher.data.error || "Search failed"}
          </Text>
        )}
      </Card>

      <div style={{ marginTop: 16 }}>
        {!item && searcher.state !== "idle" && <MasonrySkeleton />}
        {item && (
          <Card padding="400">
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center">
                <Tag>#{item.hashtag || "hashtag"}</Tag>
                <Text as="span" variant="bodySm" tone="subdued">
                  {item.timestamp ? new Date(item.timestamp).toLocaleString() : ""}
                </Text>
                {item.username && (
                  <Text as="span" variant="bodySm" tone="subdued">
                    @{item.username}
                  </Text>
                )}
                {alreadyIn && (
                  <Tag tone="success">Already in visible</Tag>
                )}
              </InlineStack>

              <a href={item.permalink} target="_blank" rel="noreferrer">
                {item.media_type === "VIDEO" ? (
                  <video
                    controls
                    muted
                    preload="metadata"
                    playsInline
                    style={{ width: "100%", height: 320, objectFit: "cover", borderRadius: 8 }}
                  >
                    <source src={item.media_url || ""} type="video/mp4" />
                  </video>
                ) : (
                  <img
                    src={item.thumbnail_url || item.media_url || TINY}
                    alt="UGC"
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    style={{ width: "100%", height: 320, objectFit: "cover", borderRadius: 8 }}
                    onError={(e) => { e.currentTarget.src = TINY; }}
                  />
                )}
              </a>

              <Text variant="bodySm" as="p">
                {(item.caption || "No description").slice(0, 200)}
                {item.caption && item.caption.length > 200 ? "…" : ""}
              </Text>

              <Checkbox label="Show on site" checked={checked} onChange={setChecked} />

              {checked && (
                <>
                  <Select
                    label="Category"
                    options={CATEGORY_OPTIONS}
                    value={category}
                    onChange={setCategory}
                  />
                  <Select
                    label="Linked Product"
                    options={products.map((p) => ({ label: p.title, value: p.handle }))}
                    value={product}
                    onChange={setProduct}
                  />
                </>
              )}

              <InlineStack align="end">
                <Button
                  primary
                  onClick={onAddVisible}
                  loading={saver.state !== "idle"}
                  disabled={!checked || saver.state !== "idle"}
                >
                  Add to Visible
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        )}
      </div>
    </Page>
  );
}

/* ----------------- helpers ----------------- */
function seedToVisible(seed, { category, product }) {
  return {
    id: String(seed.id),
    category: category || "camping",
    products: product ? [product] : [],
    username: seed.username || "",
    timestamp: seed.timestamp || "",
    media_type: seed.media_type || "IMAGE",
    media_url: seed.media_url || "",
    thumbnail_url: seed.thumbnail_url || "",
    caption: seed.caption || "",
    permalink: seed.permalink || "",
  };
}

function MasonrySkeleton() {
  return (
    <div
      style={{
        marginTop: 16,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
        gap: 24,
      }}
    >
      {Array.from({ length: 1 }).map((_, i) => (
        <Card key={i} padding="400">
          <div style={{ width: "100%", height: 320, background: "var(--p-color-bg-surface-tertiary, #F1F2F4)", borderRadius: 8 }} />
          <div style={{ marginTop: 12 }}><SkeletonBodyText lines={2} /></div>
        </Card>
      ))}
    </div>
  );
}
