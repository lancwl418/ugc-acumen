// One-time script: remap old VisibleMention.category values to the 5
// community scenarios used by the new /api-community endpoint and the
// community-widget.js storefront page.
//
// Usage:
//   node scripts/remap-categories.js              # dry run (shows what would change)
//   node scripts/remap-categories.js --apply      # actually update rows
//
// Connects via DATABASE_URL — set it to prod Supabase URL if running against prod.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Old category → new scenario mapping.
// Tweak the right-hand side and re-run if you disagree with any of these.
const MAP = {
  "off-road":      "adventure",   // Off-Road Adventure   → Adventure
  "camping":       "rv",          // Camping & Towing     → RV & Overland
  "electronic":    "daily",       // Everyday Protection  → Daily Safety
  "travel":        "daily",       // Commercial & Fleet   → Daily Safety
  "documentation": "event",       // Documentation        → Event Capture
  "events":        "adventure",   // UTV/SxS              → Adventure
};

const NEW_SCENARIOS = new Set(["daily", "rv", "adventure", "event", "install"]);

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
