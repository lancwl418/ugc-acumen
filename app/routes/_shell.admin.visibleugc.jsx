import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page, Card, Text, BlockStack, InlineStack, Tag, Badge,
} from "@shopify/polaris";
import { getAllVisible } from "../lib/visibleMentions.js";

const TINY =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";

export async function loader() {
  const items = await getAllVisible();
  return json({ items });
}

export default function VisibleUGCPage() {
  const { items } = useLoaderData();

  return (
    <Page title={`Visible UGC — ${items.length} items`} backAction={{ url: "/" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 24,
          marginTop: 16,
        }}
      >
        {items.map((item) => (
          <VisibleCard key={item.id} item={item} />
        ))}
      </div>
    </Page>
  );
}

function VisibleCard({ item }) {
  const isVideo = item.media_type === "VIDEO";
  const thumb = item.thumbnail_url || item.media_url || TINY;

  return (
    <Card padding="400">
      <BlockStack gap="200">
        <InlineStack gap="200" blockAlign="center">
          <Tag>@{item.username || "author"}</Tag>
          {item.featured && <Badge tone="success">Featured</Badge>}
          {item.category && <Badge>{item.category}</Badge>}
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
          {item.like_count != null && (
            <Text as="span" variant="bodySm" tone="subdued">
              {item.like_count} likes
            </Text>
          )}
          {item.comments_count != null && (
            <Text as="span" variant="bodySm" tone="subdued">
              {item.comments_count} comments
            </Text>
          )}
          {item.linkedProduct && (
            <Badge tone="info">{item.linkedProduct}</Badge>
          )}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
