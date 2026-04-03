// app/routes/_shell.app._index.jsx
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Card, Text, BlockStack, InlineStack } from "@shopify/polaris";
import { getVisibleCount } from "../lib/visibleMentions.js";
import prisma from "../db.server.js";

export async function loader() {
  const [visibleCount, creatorRows] = await Promise.all([
    getVisibleCount(),
    prisma.mention.groupBy({ by: ["username"], where: { username: { not: "" } } }),
  ]);
  return json({ visibleCount, creatorCount: creatorRows.length });
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
                  View and manage your own Instagram account posts.
                </Text>
              </BlockStack>
            </Card>
          </a>
        </div>
      </BlockStack>
    </Page>
  );
}
