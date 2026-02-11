import { json } from "@remix-run/node";
import { useLoaderData, Link, useFetcher } from "@remix-run/react";
import { Page, BlockStack, Card, Text, InlineStack, Avatar, Button } from "@shopify/polaris";
import { getAllMentions, forceRefresh } from "../lib/syncAllMentions.server.js";

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

  return json({ creators, total: all.length });
}

export async function action() {
  const all = await forceRefresh();
  return json({ ok: true, count: all.length });
}

export default function CreatorsPage() {
  const { creators, total } = useLoaderData();
  const fetcher = useFetcher();
  const isRefreshing = fetcher.state !== "idle";

  return (
    <Page title="Creators (Mentions)">
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="p" tone="subdued">
            {total} mentions from {creators.length} creators. Updated daily.
          </Text>
          <fetcher.Form method="post">
            <Button submit loading={isRefreshing}>
              {isRefreshing ? "Refreshing..." : "Force Refresh"}
            </Button>
          </fetcher.Form>
        </InlineStack>

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
