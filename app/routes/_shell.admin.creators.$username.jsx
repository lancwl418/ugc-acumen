import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page, Card, Text, BlockStack, InlineStack, Tag, Badge, Collapsible, Button,
} from "@shopify/polaris";
import { useState } from "react";
import { getAllMentions } from "../lib/syncAllMentions.server.js";
import { getCreatorLink, linkCreator, unlinkCreator } from "../lib/creatorLinks.server.js";
import { CustomerSearchPopover } from "../components/CustomerSearchPopover.jsx";

const TINY =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";

export async function loader({ params }) {
  const username = params.username;
  const [all, linked] = await Promise.all([
    getAllMentions(),
    getCreatorLink(username),
  ]);
  const posts = all.filter((p) => p.username === username);
  return json({ username, posts, linked });
}

export async function action({ request }) {
  const fd = await request.formData();
  const op = fd.get("op");

  if (op === "linkCreator") {
    await linkCreator(fd.get("username"), {
      customerId: fd.get("customerId"),
      displayName: fd.get("displayName"),
      email: fd.get("email"),
    });
    return json({ ok: true });
  }

  if (op === "unlinkCreator") {
    await unlinkCreator(fd.get("username"));
    return json({ ok: true });
  }

  return json({ error: "unknown op" }, { status: 400 });
}

export default function CreatorDetail() {
  const { username, posts, linked } = useLoaderData();
  const linkFetcher = useFetcher();

  function handleLink(uname, customer) {
    linkFetcher.submit(
      { op: "linkCreator", username: uname, ...customer },
      { method: "post" },
    );
  }

  function handleUnlink(uname) {
    linkFetcher.submit(
      { op: "unlinkCreator", username: uname },
      { method: "post" },
    );
  }

  return (
    <Page title={`@${username} — ${posts.length} posts`} backAction={{ url: "/admin/creators" }}>
      <BlockStack gap="400">
        <Card padding="400">
          <InlineStack gap="300" blockAlign="center">
            <Text as="h3" variant="headingSm">Shopify Customer</Text>
            {linked ? (
              <>
                <Badge tone="info">{linked.displayName}</Badge>
                <Text tone="subdued" as="span">{linked.email}</Text>
                <Button variant="plain" tone="critical" onClick={() => handleUnlink(username)}>
                  Unlink
                </Button>
              </>
            ) : (
              <CustomerSearchPopover username={username} onLink={handleLink} />
            )}
          </InlineStack>
        </Card>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 24,
          }}
        >
          {posts.map((item) => (
            <PostCard key={item.id} item={item} />
          ))}
        </div>
      </BlockStack>
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
                      <Text as="span" fontWeight="semibold">@{c.username || `user${String(c.id || "0").slice(-4)}`}</Text>{" "}
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
