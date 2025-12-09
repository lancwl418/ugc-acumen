import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, BlockStack, Text, Card } from "@shopify/polaris";
import fs from "fs/promises";
import { VISIBLE_TAG_PATH } from "../lib/persistPaths.js";

export async function loader({ params }) {
  const username = params.username;
  let visible = [];

  try {
    const raw = await fs.readFile(VISIBLE_TAG_PATH, "utf8");
    visible = JSON.parse(raw || "[]");
  } catch {
    visible = [];
  }

  const posts = visible.filter((p) => p.username === username);

  return json({ username, posts });
}

export default function CreatorDetail() {
  const { username, posts } = useLoaderData();

  return (
    <Page title={`@${username} — ${posts.length} posts`}>
      <BlockStack gap="400">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {posts.map((p) => (
            <Card key={p.id} padding="300">
              <img
                src={p.thumbnail_url || p.media_url}
                alt=""
                style={{ width: "100%", borderRadius: 8, objectFit: "cover" }}
              />
              <Text as="p" tone="subdued" variant="bodySm" style={{ marginTop: 8 }}>
                {p.caption?.slice(0, 140)}
              </Text>
            </Card>
          ))}
        </div>
      </BlockStack>
    </Page>
  );
}
