// One-time script: migrate historical VisibleMention ids from the old Instagram
// Graph media id to the FlashAPI media pk, matched by the shortcode embedded in
// each row's permalink. After switching mentions fetching from Graph /tags to
// FlashAPI /ig/tagged/, freshly fetched posts carry pk-based ids while curated
// VisibleMention rows still carry Graph ids — the admin matches curation by id,
// so without this remap previously-curated posts show as unselected and
// re-selecting them would create duplicates.
//
// Usage:
//   node scripts/migrate-ids-to-flashapi.js                 # dry run (no writes)
//   node scripts/migrate-ids-to-flashapi.js --apply         # actually remap ids
//   node scripts/migrate-ids-to-flashapi.js --apply --reset-cache
//        also clears the Mention/Comment cache so the next sync rebuilds it
//        cleanly under the new pk ids (Mention is a rebuildable cache).
//
// Env required: DATABASE_URL (+ DIRECT_URL), RAPIDAPI_KEY, INSTAGRAM_USERNAME
// (or INSTAGRAM_USER_PK). Point DATABASE_URL at prod Supabase to run against prod.

import { PrismaClient } from "@prisma/client";
import { flashGet, resolveUserId } from "../app/lib/flashAPI.server.js";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const RESET_CACHE = process.argv.includes("--reset-cache");

function shortcodeFromPermalink(url = "") {
  const m = String(url).match(/\/(?:p|reel|tv)\/([^/?#]+)/);
  return m ? m[1] : "";
}

// Page through all tagged posts → build shortcode → pk map (covers all 740-ish).
async function buildShortcodeMap() {
  const idUser = await resolveUserId();
  if (!idUser) throw new Error("无法解析品牌 user id（检查 INSTAGRAM_USERNAME / RAPIDAPI_KEY）");

  const map = new Map();
  let after = "";
  let pages = 0;
  for (;;) {
    const j = await flashGet("/ig/tagged/", { id_user: idUser, end_cursor: after });
    for (const it of j?.items || []) {
      const pk = String(it.pk || String(it.id || "").split("_")[0] || "");
      if (it.code && pk) map.set(it.code, pk);
    }
    pages++;
    if (!j?.more_available || !j?.next_max_id) break;
    after = j.next_max_id;
    if (pages > 80) { console.warn("⚠️ 翻页超过 80 页，提前停止"); break; }
  }
  return map;
}

// Per-post fallback when a shortcode isn't in the tagged map.
async function pkByShortcode(code) {
  try {
    const j = await flashGet("/ig/post_info/", { shortcode: code });
    const it = (j?.items || [])[0];
    return it?.pk ? String(it.pk) : "";
  } catch {
    return "";
  }
}

async function main() {
  console.log(APPLY ? "=== APPLY 模式（会写库）===" : "=== DRY RUN（不写库，加 --apply 才执行）===\n");

  const visibles = await prisma.visibleMention.findMany({
    select: { id: true, permalink: true, username: true },
  });
  console.log(`VisibleMention 共 ${visibles.length} 条`);

  console.log("拉取全部 tagged 帖子建立 shortcode→pk 映射…");
  const map = await buildShortcodeMap();
  console.log(`映射建立完成：${map.size} 条\n`);

  const plan = [];
  const noShortcode = [];
  const unresolved = [];
  let already = 0;

  for (const v of visibles) {
    const code = shortcodeFromPermalink(v.permalink);
    if (!code) { noShortcode.push(v); continue; }
    let pk = map.get(code);
    if (!pk) pk = await pkByShortcode(code); // 兜底（可能已被作者删除）
    if (!pk) { unresolved.push({ ...v, code }); continue; }
    if (pk === v.id) { already++; continue; }
    plan.push({ oldId: v.id, newId: pk, code, username: v.username });
  }

  console.log("---- 计划 ----");
  console.log(`需要改 id          : ${plan.length}`);
  console.log(`已经一致(无需改)   : ${already}`);
  console.log(`permalink 无 shortcode: ${noShortcode.length}`);
  console.log(`查不到 pk(可能已删) : ${unresolved.length}`);
  plan.slice(0, 15).forEach((p) => console.log(`   ${p.oldId}  →  ${p.newId}   (@${p.username} ${p.code})`));
  if (plan.length > 15) console.log(`   …(其余 ${plan.length - 15} 条略)`);
  if (unresolved.length) {
    console.log("未解析样例:");
    unresolved.slice(0, 10).forEach((u) => console.log(`   [?] ${u.id}  ${u.permalink}`));
  }

  if (!APPLY) {
    console.log("\nDRY RUN 结束。确认无误后加 --apply 执行。");
    await prisma.$disconnect();
    return;
  }

  // Apply: remap id; if target pk already exists (post was re-curated), drop the
  // stale old-id row and keep the existing new-id one.
  let changed = 0;
  let mergedConflict = 0;
  for (const p of plan) {
    const exists = await prisma.visibleMention.findUnique({
      where: { id: p.newId },
      select: { id: true },
    });
    if (exists) {
      await prisma.visibleMention.delete({ where: { id: p.oldId } });
      mergedConflict++;
    } else {
      await prisma.visibleMention.update({
        where: { id: p.oldId },
        data: { id: p.newId },
      });
      changed++;
    }
  }
  console.log(`\nVisibleMention：改 id ${changed} 条，冲突删旧 ${mergedConflict} 条`);

  if (RESET_CACHE) {
    const del = await prisma.mention.deleteMany();
    console.log(`清空 Mention 缓存 ${del.count} 条（Comment 级联删除），下次 sync 按新 pk 重建`);
  }

  await prisma.$disconnect();
  console.log("完成。");
}

main().catch(async (e) => {
  console.error("迁移失败:", e);
  await prisma.$disconnect();
  process.exit(1);
});
