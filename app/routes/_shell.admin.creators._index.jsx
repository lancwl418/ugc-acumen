import { json } from "@remix-run/node";
import { useLoaderData, Link, useFetcher } from "@remix-run/react";
import { Page, BlockStack, Card, Text, InlineStack, Avatar, Button, Badge } from "@shopify/polaris";
import { useRef } from "react";
import { forceRefresh } from "../lib/syncAllMentions.server.js";
import { getAllCreatorLinks, linkCreator, unlinkCreator } from "../lib/creatorLinks.server.js";
import { CustomerSearchPopover } from "../components/CustomerSearchPopover.jsx";
import prisma from "../db.server.js";

export async function loader() {
  const [grouped, links] = await Promise.all([
    prisma.mention.groupBy({
      by: ["username"],
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    }),
    getAllCreatorLinks(),
  ]);

  const creators = grouped.map((g) => ({
    username: g.username || "unknown",
    count: g._count.id,
    linked: links[g.username] || null,
  }));

  const total = creators.reduce((s, c) => s + c.count, 0);
  return json({ creators, total });
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
    return json({ ok: true, op: "linkCreator" });
  }

  if (op === "unlinkCreator") {
    await unlinkCreator(fd.get("username"));
    return json({ ok: true, op: "unlinkCreator" });
  }

  // Default: force refresh
  const all = await forceRefresh();
  return json({ ok: true, count: all.length });
}

export default function CreatorsPage() {
  const { creators, total } = useLoaderData();
  const fetcher = useFetcher();
  const linkFetcher = useFetcher();
  const formRef = useRef(null);
  const isRefreshing = fetcher.state !== "idle";

  const handleRefresh = () => {
    const confirmed = window.confirm(
      "Are you sure you want to force refresh?\n确认要强制刷新吗？\n\nThis will clear all existing data and re-fetch from Instagram.\n此操作将清空现有数据并重新从 Instagram 拉取覆盖。"
    );
    if (confirmed) fetcher.submit(formRef.current);
  };

  function handleLink(username, customer) {
    linkFetcher.submit(
      { op: "linkCreator", username, ...customer },
      { method: "post" },
    );
  }

  function handleUnlink(username) {
    linkFetcher.submit(
      { op: "unlinkCreator", username },
      { method: "post" },
    );
  }

  return (
    <Page title="Creators (Mentions)">
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="p" tone="subdued">
            {total} mentions from {creators.length} creators. Updated daily.
          </Text>
          <fetcher.Form method="post" ref={formRef}>
            <Button onClick={handleRefresh} loading={isRefreshing}>
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
            <Card key={c.username} padding="400">
              <BlockStack gap="200">
                <Link
                  to={`/admin/creators/${encodeURIComponent(c.username)}`}
                  style={{ textDecoration: "none" }}
                >
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
                </Link>

                {c.linked ? (
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone="info">{c.linked.displayName}</Badge>
                    <Button
                      variant="plain"
                      tone="critical"
                      onClick={() => handleUnlink(c.username)}
                    >
                      Unlink
                    </Button>
                  </InlineStack>
                ) : (
                  <CustomerSearchPopover username={c.username} onLink={handleLink} />
                )}
              </BlockStack>
            </Card>
          ))}
        </div>
      </BlockStack>
    </Page>
  );
}
