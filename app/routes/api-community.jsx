// app/routes/api-community.jsx
// Public API: Community page data — curated VisibleMention items grouped /
// filtered by scenario, plus aggregate stats for the hero.
//   posts  → IMAGE / CAROUSEL_ALBUM items (photo masonry)
//   videos → VIDEO items (video masonry; media_url is the R2 mp4,
//            thumbnail_url the poster). Split so the storefront can render
//            the two media tabs without re-filtering.
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
  { id: "driving", label: "Driving Safety" },
  { id: "towing",  label: "Towing & Camping" },
  { id: "offroad", label: "Off-road & Overland" },
  { id: "fleet",   label: "Fleet & Commercial" },
  { id: "utv",     label: "UTV & Utility" },
  { id: "marine",  label: "Marine Life" },
];

const SCENARIO_IDS = new Set(SCENARIOS.map((s) => s.id));

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const url = new URL(request.url);
  const scenarioParam = url.searchParams.get("scenario");
  const scenario = scenarioParam && SCENARIO_IDS.has(scenarioParam) ? scenarioParam : null;

  // Instagram posts are IMAGE, CAROUSEL_ALBUM, or VIDEO — all included.
  const baseWhere = {
    category: scenario ? scenario : { in: [...SCENARIO_IDS] },
  };

  const [rows, creatorLinks, productRows, totalAll, mentionCount] = await Promise.all([
    prisma.visibleMention.findMany({
      where: baseWhere,
      orderBy: [{ featured: "desc" }, { timestamp: "desc" }],
    }),
    getAllCreatorLinks(),
    prisma.product.findMany(),
    prisma.visibleMention.count({
      where: { category: { in: [...SCENARIO_IDS] } },
    }),
    prisma.mention.count(),
  ]);

  // Linked products: VisibleMention.products stores Shopify handles (array;
  // older rows may hold a single handle string). Resolve them against the
  // synced Product table so the widget can render title / image / price.
  const productByHandle = Object.fromEntries(productRows.map((p) => [p.handle, p]));
  const resolveProducts = (raw) => {
    const handles = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return handles
      .map((h) => productByHandle[h])
      .filter(Boolean)
      .map((p) => ({
        handle: p.handle,
        title: p.title,
        image: p.image || null,
        link: p.link || null,
        price: p.price ?? 0,
      }));
  };

  const items = rows.map((row) => {
    const api = toAPI(row);
    const link = creatorLinks[api.username];
    api.is_ambassador = !!link?.isAmbassador;
    api.ambassador_role = link?.role || null;
    api.display_name = link?.displayName || null;
    api.profile_pic_url = link?.profilePicUrl || null;
    api.linked_products = resolveProducts(api.products);
    return api;
  });

  const isVideo = (p) => p.media_type === "VIDEO";
  const posts = items.filter((p) => !isVideo(p));
  const videos = items.filter(isVideo);

  const byScenario = {};
  for (const s of SCENARIOS) {
    byScenario[s.id] = {
      label: s.label,
      posts: posts.filter((p) => p.category === s.id),
      videos: videos.filter((p) => p.category === s.id),
    };
  }

  const counts = {};
  for (const s of SCENARIOS) {
    counts[s.id] = {
      posts: byScenario[s.id].posts.length,
      videos: byScenario[s.id].videos.length,
    };
  }
  counts.all = { posts: posts.length, videos: videos.length };

  return json(
    {
      scenarios: SCENARIOS,
      counts,
      posts,
      videos,
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
