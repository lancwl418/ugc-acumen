// app/routes/api-creators.jsx
// Public API: Creator list with stats (based on Mention table — all UGC)
import { json } from "@remix-run/node";
import { getAllCreatorLinks } from "../lib/creatorLinks.server.js";
import prisma from "../db.server.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || 0);
  const offset = Number(url.searchParams.get("offset") || 0);

  const [grouped, links] = await Promise.all([
    prisma.mention.groupBy({
      by: ["username"],
      _count: { id: true },
      _sum: { likeCount: true, commentsCount: true },
      orderBy: { _count: { id: "desc" } },
    }),
    getAllCreatorLinks(),
  ]);

  let creators = grouped
    .filter((g) => g.username && g.username !== "unknown")
    .map((g) => {
      const linked = links[g.username] || null;
      return {
        username: g.username,
        post_count: g._count.id,
        total_likes: g._sum.likeCount || 0,
        total_comments: g._sum.commentsCount || 0,
        display_name: linked?.displayName || null,
        email: linked?.email || null,
        customer_id: linked?.customerId || null,
        profile_pic_url: linked?.profilePicUrl || null,
      };
    });

  const total = creators.length;

  if (offset > 0) creators = creators.slice(offset);
  if (limit > 0) creators = creators.slice(0, limit);

  return json(
    { creators, total, page: { limit, offset, returned: creators.length } },
    { headers: { ...CORS, "Cache-Control": "public, max-age=60" } },
  );
}
