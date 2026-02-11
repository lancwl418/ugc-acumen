import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page, Card, Text, BlockStack, InlineStack, Tag, Badge,
} from "@shopify/polaris";
import { getAllMentions } from "../lib/syncAllMentions.server.js";

const TINY =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";

export async function loader({ params }) {
  const username = params.username;
  const all = await getAllMentions();
  const posts = all.filter((p) => p.username === username);
  return json({ username, posts });
}

export default function CreatorDetail() {
  const { username, posts } = useLoaderData();

  return (
    <Page title={`@${username} — ${posts.length} posts`} backAction={{ url: "/admin/creators" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 24,
          marginTop: 16,
        }}
      >
        {posts.map((item) => {
          const isVideo = item.media_type === "VIDEO";
          const thumb = item.thumbnail_url || item.media_url || TINY;

          return (
            <Card key={item.id} padding="400">
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

                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" variant="bodySm" tone="subdued">
                    {item.like_count ?? 0} likes
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {item.comments_count ?? 0} comments
                  </Text>
                </InlineStack>
              </BlockStack>
            </Card>
          );
        })}
      </div>
    </Page>
  );
}
