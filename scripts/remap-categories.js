// One-time script: remap VisibleMention.category values to the 6 community
// scenarios used by the new /api-community endpoint and community-widget.js.
//
// Usage:
//   node scripts/remap-categories.js              # dry run (shows what would change)
//   node scripts/remap-categories.js --apply      # actually update rows
//
// Connects via DATABASE_URL — set it to prod Supabase URL if running against prod.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Old/legacy category → new scenario mapping.
// Covers both the previous 5-scenario set (daily/rv/adventure/event/install)
// and the original raw labels (camping/off-road/electronic/travel/...).
//
// "install" is intentionally absent — those rows stay as-is until re-tagged
// by hand in the admin (they will be invisible to /api-community in the
// meantime).
const MAP = {
  // Previous 5-scenario set
  "daily":         "driving",
  "rv":            "towing",
  "adventure":     "offroad",
  "event":         "driving",
  // Original raw labels (pre-first-remap)
  "camping":       "towing",
  "off-road":      "offroad",
  "electronic":    "driving",
  "travel":        "driving",
  "documentation": "driving",
  "events":        "offroad",
};

const NEW_SCENARIOS = new Set([
  "driving",
  "towing",
  "offroad",
  "fleet",
  "utv",
  "marine",
]);

async function main() {
  const apply = process.argv.includes("--apply");

  const grouped = await prisma.visibleMention.groupBy({
    by: ["category"],
    _count: { id: true },
    orderBy: { category: "asc" },
  });

  console.log("\nCurrent VisibleMention categories:");
  console.log("─".repeat(60));
  let totalToMigrate = 0;
  let totalAlreadyNew = 0;
  let totalUnknown = 0;

  for (const g of grouped) {
    const cat = g.category;
    const count = g._count.id;
    if (NEW_SCENARIOS.has(cat)) {
      console.log(`  ✓ ${cat.padEnd(16)} ${count.toString().padStart(4)}   (already a scenario)`);
      totalAlreadyNew += count;
    } else if (MAP[cat]) {
      console.log(`  → ${cat.padEnd(16)} ${count.toString().padStart(4)}   will become "${MAP[cat]}"`);
      totalToMigrate += count;
    } else {
      console.log(`  ? ${cat.padEnd(16)} ${count.toString().padStart(4)}   (no mapping — will be left as-is, invisible to /api-community)`);
      totalUnknown += count;
    }
  }

  console.log("─".repeat(60));
  console.log(`Total:  ${totalAlreadyNew + totalToMigrate + totalUnknown} rows`);
  console.log(`  - already a new scenario: ${totalAlreadyNew}`);
  console.log(`  - will be remapped:       ${totalToMigrate}`);
  console.log(`  - no mapping (skipped):   ${totalUnknown}`);

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to actually update rows.\n");
    return;
  }

  if (!totalToMigrate) {
    console.log("\nNothing to remap. Done.\n");
    return;
  }

  console.log("\nApplying updates…");
  for (const [oldCat, newCat] of Object.entries(MAP)) {
    const res = await prisma.visibleMention.updateMany({
      where: { category: oldCat },
      data: { category: newCat },
    });
    if (res.count > 0) {
      console.log(`  ${oldCat} → ${newCat}: ${res.count} rows`);
    }
  }
  console.log("\nDone.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
