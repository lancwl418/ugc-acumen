import { json } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { Page, BlockStack, Card, Text, InlineStack, Avatar } from "@shopify/polaris";
import fs from "fs/promises";
import path from "path";

// mentions 可见池路径
import { VISIBLE_TAG_PATH } from "../lib/persistPaths.js";

export async function loader() {
  let visible = [];
  try {
    const raw = await fs.readFile(VISIBLE_TAG_PATH, "utf8");
    visible = JSON.parse(raw || "[]");
  } catch {
    visible = [];
  }

  // 分组：username → posts[]
  const grouped = {};
  for (const item of visible) {
    const user = item.username || "unknown";
    if (!grouped[user]) grouped[user] = [];
    grouped[user].push(item);
  }

  // 按帖子数量倒序
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
          Grouped by username from visible mentions pool.
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
