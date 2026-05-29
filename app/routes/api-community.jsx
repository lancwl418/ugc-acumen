// app/routes/api-community.jsx
// Public API: Community page data — visible UGC grouped/filtered by scenario,
// plus aggregate stats for the hero. Serves Videos + Photos; Reviews are not
// in scope for v1.
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

function isVideo(mediaType) {
  return mediaType === "VIDEO";
}

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const url = new URL(request.url);
  const scenarioParam = url.searchParams.get("scenario");
  const scenario = scenarioParam && SCENARIO_IDS.has(scenarioParam) ? scenarioParam : null;
  const limitPer = Number(url.searchParams.get("limit") || 0);

  const where = scenario ? { category: scenario } : { category: { in: [...SCENARIO_IDS] } };

  const [rows, creatorLinks, totalAll, mentionCount] = await Promise.all([
    prisma.visibleMention.findMany({
      where,
      orderBy: [{ featured: "desc" }, { timestamp: "desc" }],
    }),
    getAllCreatorLinks(),
    prisma.visibleMention.count({ where: { category: { in: [...SCENARIO_IDS] } } }),
    prisma.mention.count(),
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

  const videos = items.filter((i) => isVideo(i.media_type));
  const photos = items.filter((i) => !isVideo(i.media_type));

  const byScenario = {};
  for (const s of SCENARIOS) {
    byScenario[s.id] = {
      label: s.label,
      videos: videos.filter((v) => v.category === s.id),
      photos: photos.filter((p) => p.category === s.id),
    };
  }

  const counts = {};
  for (const s of SCENARIOS) {
    counts[s.id] = {
      videos: byScenario[s.id].videos.length,
      photos: byScenario[s.id].photos.length,
      total:  byScenario[s.id].videos.length + byScenario[s.id].photos.length,
    };
  }
  counts.all = {
    videos: videos.length,
    photos: photos.length,
    total:  videos.length + photos.length,
  };

  return json(
    {
      scenarios: SCENARIOS,
      counts,
      videos,
      photos,
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
