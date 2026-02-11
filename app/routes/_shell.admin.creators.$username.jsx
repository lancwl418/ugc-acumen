import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page, Card, Text, BlockStack, InlineStack, Tag, Badge, Collapsible, Button,
} from "@shopify/polaris";
import { useState } from "react";
import { getAllMentions } from "../lib/syncAllMentions.server.js";
import { fetchTagsWithComments } from "../lib/fetchHashtagUGC.js";

const TINY =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";

export async function loader({ params }) {
  const username = params.username;
  const all = await getAllMentions();
  const posts = all.filter((p) => p.username === username);
  const postIds = new Set(posts.map((p) => String(p.id)));

  // 用小 limit 从 /tags 拉带 comments 的数据，匹配该 creator 的帖子
  const commentsMap = new Map();
  let after = "";
  let scanned = 0;
  const MAX_SCAN = 200; // 最多翻多少条

  while (scanned < MAX_SCAN && commentsMap.size < postIds.size) {
    try {
      const page = await fetchTagsWithComments({ limit: 3, after });
      if (!page.items || page.items.length === 0) break;
      for (const item of page.items) {
        if (postIds.has(String(item.id))) {
          commentsMap.set(String(item.id), item.comments || []);
        }
      }
      scanned += page.items.length;
      after = page.nextAfter || "";
      if (!after) break;
    } catch {
      break;
    }
  }

  // 合并 comments 到 posts
  const enriched = posts.map((p) => {
    const comments = commentsMap.get(String(p.id));
    return comments ? { ...p, comments } : p;
  });

  return json({ username, posts: enriched });
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
        {posts.map((item) => (
          <PostCard key={item.id} item={item} />
        ))}
      </div>
    </Page>
  );
}

function PostCard({ item }) {
  const [commentsOpen, setCommentsOpen] = useState(false);
  const isVideo = item.media_type === "VIDEO";
  const thumb = item.thumbnail_url || item.media_url || TINY;
  const comments = item.comments || [];

  return (
    <Card padding="400">
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

        <InlineStack gap="300" blockAlign="center">
          <Text as="span" variant="bodySm" tone="subdued">
            {item.like_count ?? 0} likes
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            {item.comments_count ?? 0} comments
          </Text>
        </InlineStack>

        {comments.length > 0 && (
          <>
            <Button
              variant="plain"
              onClick={() => setCommentsOpen((o) => !o)}
            >
              {commentsOpen ? "Hide comments" : `View ${comments.length} comments`}
            </Button>
            <Collapsible open={commentsOpen}>
              <BlockStack gap="100">
                {comments.map((c) => (
                  <div key={c.id} style={{ paddingLeft: 8, borderLeft: "2px solid #e1e3e5" }}>
                    <Text variant="bodySm" as="p">
                      <Text as="span" fontWeight="semibold">@{c.username}</Text>{" "}
                      {c.text}
                    </Text>
                    <Text variant="bodySm" as="span" tone="subdued">
                      {c.timestamp ? new Date(c.timestamp).toLocaleString() : ""}
                    </Text>
                  </div>
                ))}
              </BlockStack>
            </Collapsible>
          </>
        )}
      </BlockStack>
    </Card>
  );
}
