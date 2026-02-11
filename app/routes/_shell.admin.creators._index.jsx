import { json } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { Page, BlockStack, Card, Text, InlineStack, Avatar } from "@shopify/polaris";
import { getAllMentions } from "../lib/syncAllMentions.server.js";

export async function loader() {
  const all = await getAllMentions();

  const grouped = {};
  for (const item of all) {
    const user = item.username || "unknown";
    if (!grouped[user]) grouped[user] = [];
    grouped[user].push(item);
  }

  const creators = Object.entries(grouped)
    .map(([username, posts]) => ({ username, count: posts.length }))
    .sort((a, b) => b.count - a.count);

  return json({ creators });
}

export default function CreatorsPage() {
  const { creators } = useLoaderData();

  return (
    <Page title="Creators (Mentions)">
      <BlockStack gap="400">
        <Text as="p" tone="subdued">
          Grouped by username from all mentions. Updated daily.
        </Text>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          {creators.map((c) => (
            <Link
              key={c.username}
              to={`/admin/creators/${encodeURIComponent(c.username)}`}
              style={{ textDecoration: "none" }}
            >
              <Card padding="400">
                <InlineStack gap="300" blockAlign="center">
                  <Avatar name={c.username} />
                  <BlockStack gap="050">
                    <Text as="h3" variant="headingMd">
                      @{c.username}
                    </Text>
                    <Text tone="subdued" as="p">
                      {c.count} posts
                    </Text>
                  </BlockStack>
                </InlineStack>
              </Card>
            </Link>
          ))}
        </div>
      </BlockStack>
    </Page>
  );
}
