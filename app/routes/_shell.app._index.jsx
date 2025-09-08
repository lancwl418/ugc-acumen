// app/routes/_shell.app._index.jsx
import { Page, Card, Text, BlockStack } from "@shopify/polaris";

export default function HomeIndex() {
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
          <a href="/admin/hashtagugc" data-prefetch="intent" style={{ textDecoration: "none" }}>
            <Card padding="400">
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">Hashtags (#)</Text>
                <Text as="p" tone="subdued">Manage hashtag pool, pick items, set category & link product.</Text>
              </BlockStack>
            </Card>
          </a>

          <a href="/admin/mentionsugc" data-prefetch="intent" style={{ textDecoration: "none" }}>
            <Card padding="400">
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">Mentions (@)</Text>
                <Text as="p" tone="subdued">Manage mentions pool, pick items, set category & link product.</Text>
              </BlockStack>
            </Card>
          </a>
        </div>
      </BlockStack>
    </Page>
  );
}
