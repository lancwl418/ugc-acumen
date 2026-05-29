// app/routes/api-ambassadors.jsx
// Public API: Community ambassador profiles + clip counts.
import { json } from "@remix-run/node";
import prisma from "../db.server.js";
import { getAmbassadors } from "../lib/creatorLinks.server.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const ambassadors = await getAmbassadors();

  if (!ambassadors.length) {
    return json({ ambassadors: [] }, { headers: { ...CORS, "Cache-Control": "public, max-age=60" } });
  }

  const clipCounts = await prisma.mention.groupBy({
    by: ["username"],
    _count: { id: true },
    where: { username: { in: ambassadors.map((a) => a.username) } },
  });
  const countByUser = Object.fromEntries(clipCounts.map((c) => [c.username, c._count.id]));

  const out = ambassadors.map((a) => ({
    username: a.username,
    display_name: a.displayName || a.username,
    profile_pic_url: a.profilePicUrl || null,
    role: a.role,
    quote: a.quote,
    setup: a.setup,
    base: a.base,
    joined_year: a.joinedYear,
    scenarios: a.scenarios,
    clips: countByUser[a.username] || 0,
  }));

  return json({ ambassadors: out }, { headers: { ...CORS, "Cache-Control": "public, max-age=60" } });
}
