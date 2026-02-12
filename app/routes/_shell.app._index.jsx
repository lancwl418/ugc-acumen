// app/routes/_shell.app._index.jsx
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Card, Text, BlockStack, InlineStack } from "@shopify/polaris";
import fs from "fs/promises";
import { VISIBLE_TAG_PATH, ensureVisibleTagFile } from "../lib/persistPaths.js";
import { getAllMentions } from "../lib/syncAllMentions.server.js";

async function readJsonSafe(file) {
  try { return JSON.parse((await fs.readFile(file, "utf-8")) || "[]"); }
  catch { return []; }
}

export async function loader() {
  await ensureVisibleTagFile();
  const [visible, allMentions] = await Promise.all([
    readJsonSafe(VISIBLE_TAG_PATH),
    getAllMentions(),
  ]);
  const creatorCount = new Set(allMentions.map((m) => m.username).filter(Boolean)).size;
  return json({ visibleCount: visible.length, creatorCount });
}

export default function HomeIndex() {
  const { visibleCount, creatorCount } = useLoaderData();

  return (
    <Page title="UGC Console">
      <BlockStack gap="400">
        <Text as="p" variant="bodyMd" tone="subdued">
          Pick a module to manage. Links use prefetch to open faster.
        </Text>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 16,
          }}
        >
          {/* Visible UGC */}
          <a href="/admin/visibleugc" data-prefetch="intent" style={{ textDecoration: "none" }}>
            <Card padding="400">
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingMd">Visible UGC</Text>
                  <Text as="span" variant="headingLg">{visibleCount}</Text>
                </InlineStack>
                <Text as="p" tone="subdued">
                  Curated UGC items visible on the storefront.
                </Text>
              </BlockStack>
            </Card>
          </a>

          {/* Creators */}
          <a href="/admin/creators" data-prefetch="intent" style={{ textDecoration: "none" }}>
            <Card padding="400">
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingMd">Creators</Text>
                  <Text as="span" variant="headingLg">{creatorCount}</Text>
                </InlineStack>
                <Text as="p" tone="subdued">
                  Instagram creators who mentioned your brand.
                </Text>
              </BlockStack>
            </Card>
          </a>

          {/* Mentions */}
          <a href="/admin/mentionsugc" data-prefetch="intent" style={{ textDecoration: "none" }}>
            <Card padding="400">
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">Mentions (@)</Text>
                <Text as="p" tone="subdued">
                  Manage mentions pool, pick items, set category & link product.
                </Text>
              </BlockStack>
            </Card>
          </a>

          {/* My Posts */}
          <a href="/admin/ugc" data-prefetch="intent" style={{ textDecoration: "none" }}>
            <Card padding="400">
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">My Posts</Text>
                <Text as="p" tone="subdued">
                  View and manage posts you've uploaded manually via link import.
                </Text>
              </BlockStack>
            </Card>
          </a>
        </div>
      </BlockStack>
    </Page>
  );
}
