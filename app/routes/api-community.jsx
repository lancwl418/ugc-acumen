// app/routes/api-community.jsx
// Public API: Community page data — non-video VisibleMention posts grouped /
// filtered by scenario, plus aggregate stats for the hero.
// Videos are excluded by design (storefront page is photo-only for v1).
import { json } from "@remix-run/node";
import prisma from "../db.server.js";
import { toAPI } from "../lib/visibleMentions.js";
import { getAllCreatorLinks } from "../lib/creatorLinks.server.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const SCENARIOS = [
  { id: "daily",     label: "Daily Safety" },
  { id: "rv",        label: "RV & Overland" },
  { id: "adventure", label: "Adventure" },
  { id: "event",     label: "Event Capture" },
  { id: "install",   label: "Installation" },
];

const SCENARIO_IDS = new Set(SCENARIOS.map((s) => s.id));

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const url = new URL(request.url);
  const scenarioParam = url.searchParams.get("scenario");
  const scenario = scenarioParam && SCENARIO_IDS.has(scenarioParam) ? scenarioParam : null;

  // Exclude VIDEO media. Instagram posts are IMAGE, CAROUSEL_ALBUM, or VIDEO.
  const baseWhere = {
    mediaType: { not: "VIDEO" },
    category: scenario ? scenario : { in: [...SCENARIO_IDS] },
  };

  const [rows, creatorLinks, totalAll, mentionCount] = await Promise.all([
    prisma.visibleMention.findMany({
      where: baseWhere,
      orderBy: [{ featured: "desc" }, { timestamp: "desc" }],
    }),
    getAllCreatorLinks(),
    prisma.visibleMention.count({
      where: { mediaType: { not: "VIDEO" }, category: { in: [...SCENARIO_IDS] } },
    }),
    prisma.mention.count({ where: { mediaType: { not: "VIDEO" } } }),
  ]);

  const items = rows.map((row) => {
    const api = toAPI(row);
    const link = creatorLinks[api.username];
    api.is_ambassador = !!link?.isAmbassador;
    api.ambassador_role = link?.role || null;
    api.display_name = link?.displayName || null;
    api.profile_pic_url = link?.profilePicUrl || null;
    return api;
  });

  const byScenario = {};
  for (const s of SCENARIOS) {
    byScenario[s.id] = {
      label: s.label,
      posts: items.filter((p) => p.category === s.id),
    };
  }

  const counts = {};
  for (const s of SCENARIOS) {
    counts[s.id] = { posts: byScenario[s.id].posts.length };
  }
  counts.all = { posts: items.length };

  return json(
    {
      scenarios: SCENARIOS,
      counts,
      posts: items,
      by_scenario: byScenario,
      stats: {
        total_curated: totalAll,
        total_clips: mentionCount,
        ambassadors: Object.values(creatorLinks).filter((l) => l.isAmbassador).length,
      },
    },
    { headers: { ...CORS, "Cache-Control": "public, max-age=60" } },
  );
}
