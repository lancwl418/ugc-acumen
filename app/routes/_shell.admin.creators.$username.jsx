import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page, Card, Text, BlockStack, InlineStack, Tag, Badge, Collapsible, Button,
  Checkbox, TextField, ChoiceList,
} from "@shopify/polaris";
import { useState } from "react";
import { getCreatorLink, linkCreator, unlinkCreator, updateAmbassadorProfile } from "../lib/creatorLinks.server.js";
import { CustomerSearchPopover } from "../components/CustomerSearchPopover.jsx";
import prisma from "../db.server.js";

const SCENARIO_OPTIONS = [
  { label: "Daily Safety", value: "daily" },
  { label: "RV & Overland", value: "rv" },
  { label: "Adventure", value: "adventure" },
  { label: "Event Capture", value: "event" },
  { label: "Installation", value: "install" },
];

const TINY =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";

export async function loader({ params }) {
  const username = params.username;
  const [rows, linked] = await Promise.all([
    prisma.mention.findMany({
      where: { username },
      include: { comments: true },
      orderBy: { timestamp: "desc" },
    }),
    getCreatorLink(username),
  ]);
  const posts = rows.map((m) => ({
    id: m.id,
    username: m.username,
    timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
    media_type: m.mediaType,
    media_url: m.mediaUrl,
    thumbnail_url: m.thumbnailUrl || null,
    caption: m.caption || "",
    permalink: m.permalink,
    like_count: m.likeCount ?? 0,
    comments_count: m.commentsCount ?? 0,
    comments: (m.comments || []).map((c) => ({
      id: c.id,
      text: c.text || "",
      username: c.username || "",
      timestamp: c.timestamp instanceof Date ? c.timestamp.toISOString() : c.timestamp,
    })),
  }));
  return json({ username, posts, linked, profilePicUrl: linked?.profilePicUrl || null });
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

  if (op === "updateAmbassador") {
    let scenarios = [];
    try { scenarios = JSON.parse(fd.get("scenarios") || "[]"); } catch {}
    await updateAmbassadorProfile(fd.get("username"), {
      isAmbassador: fd.get("isAmbassador") === "true",
      role: fd.get("role"),
      quote: fd.get("quote"),
      setup: fd.get("setup"),
      base: fd.get("base"),
      joinedYear: fd.get("joinedYear"),
      scenarios,
    });
    return json({ ok: true });
  }

  return json({ error: "unknown op" }, { status: 400 });
}

export default function CreatorDetail() {
  const { username, posts, linked, profilePicUrl } = useLoaderData();
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
    <Page backAction={{ url: "/admin/creators" }}>
      <BlockStack gap="400">
        <Card padding="400">
          <InlineStack gap="400" blockAlign="center">
            {profilePicUrl ? (
              <img
                src={profilePicUrl}
                alt={username}
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  objectFit: "cover",
                }}
              />
            ) : null}
            <BlockStack gap="100">
              <Text as="h2" variant="headingLg">@{username}</Text>
              <Text as="p" tone="subdued">{posts.length} posts</Text>
            </BlockStack>
          </InlineStack>
        </Card>

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

        <AmbassadorCard username={username} linked={linked} />


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

function AmbassadorCard({ username, linked }) {
  const fetcher = useFetcher();
  const [isAmb, setIsAmb] = useState(!!linked?.isAmbassador);
  const [role, setRole] = useState(linked?.role || "");
  const [quote, setQuote] = useState(linked?.quote || "");
  const [setup, setSetup] = useState(linked?.setup || "");
  const [base, setBase] = useState(linked?.base || "");
  const [joinedYear, setJoinedYear] = useState(linked?.joinedYear ? String(linked.joinedYear) : "");
  const [scenarios, setScenarios] = useState(linked?.scenarios || []);

  const saving = fetcher.state !== "idle";

  function save() {
    fetcher.submit(
      {
        op: "updateAmbassador",
        username,
        isAmbassador: String(isAmb),
        role, quote, setup, base, joinedYear,
        scenarios: JSON.stringify(scenarios),
      },
      { method: "post" },
    );
  }

  return (
    <Card padding="400">
      <BlockStack gap="300">
        <InlineStack gap="200" blockAlign="center">
          <Text as="h3" variant="headingSm">Community Ambassador</Text>
          {isAmb && <Badge tone="info">Ambassador</Badge>}
        </InlineStack>

        <Checkbox
          label="Show this creator as a Community Ambassador on the storefront"
          checked={isAmb}
          onChange={setIsAmb}
        />

        {isAmb && (
          <BlockStack gap="300">
            <TextField
              label="Role"
              value={role}
              onChange={setRole}
              placeholder="e.g. RV Correspondent · Install Editor · Overland Lead"
              autoComplete="off"
            />
            <TextField
              label="Pull quote"
              value={quote}
              onChange={setQuote}
              multiline={3}
              placeholder="A single line they'd say about why they shoot."
              autoComplete="off"
            />
            <InlineStack gap="300" wrap>
              <div style={{ flex: 1, minWidth: 220 }}>
                <TextField
                  label="Setup"
                  value={setup}
                  onChange={setSetup}
                  placeholder="'22 Ram ProMaster · A7 Pro 4-channel"
                  autoComplete="off"
                />
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <TextField
                  label="Based in"
                  value={base}
                  onChange={setBase}
                  placeholder="Bend, OR"
                  autoComplete="off"
                />
              </div>
              <div style={{ width: 140 }}>
                <TextField
                  label="Joined year"
                  type="number"
                  value={joinedYear}
                  onChange={setJoinedYear}
                  placeholder="2024"
                  autoComplete="off"
                />
              </div>
            </InlineStack>
            <ChoiceList
              title="Scenarios they cover"
              choices={SCENARIO_OPTIONS}
              selected={scenarios}
              onChange={setScenarios}
              allowMultiple
            />
          </BlockStack>
        )}

        <InlineStack gap="200">
          <Button variant="primary" onClick={save} loading={saving}>
            Save ambassador profile
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
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
