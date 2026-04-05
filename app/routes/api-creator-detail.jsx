// app/routes/api-creator-detail.jsx
// Public API: Single creator profile + paginated UGC (based on Mention table)
import { json } from "@remix-run/node";
import { getCreatorLink } from "../lib/creatorLinks.server.js";
import prisma from "../db.server.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function mentionToAPI(m) {
  return {
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
  };
}

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const url = new URL(request.url);
  const username = url.searchParams.get("username");
  if (!username) {
    return json({ error: "Missing username parameter" }, { status: 400, headers: CORS });
  }

  const limit = Number(url.searchParams.get("limit") || 20);
  const offset = Number(url.searchParams.get("offset") || 0);

  const where = { username };

  const [rows, total, stats, linked] = await Promise.all([
    prisma.mention.findMany({
      where,
      include: { comments: true },
      orderBy: { timestamp: "desc" },
      skip: offset,
      ...(limit > 0 ? { take: limit } : {}),
    }),
    prisma.mention.count({ where }),
    prisma.mention.aggregate({
      where,
      _sum: { likeCount: true, commentsCount: true },
    }),
    getCreatorLink(username),
  ]);

  const posts = rows.map(mentionToAPI);

  return json(
    {
      creator: {
        username,
        display_name: linked?.displayName || null,
        email: linked?.email || null,
        customer_id: linked?.customerId || null,
        profile_pic_url: linked?.profilePicUrl || null,
        post_count: total,
        total_likes: stats._sum.likeCount || 0,
        total_comments: stats._sum.commentsCount || 0,
      },
      posts,
      total,
      page: { limit, offset, returned: posts.length },
    },
    { headers: { ...CORS, "Cache-Control": "public, max-age=60" } },
  );
}
