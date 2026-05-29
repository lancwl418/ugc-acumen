// app/lib/creatorLinks.server.js
// Creator → Shopify Customer 关联 — Prisma 版
import prisma from "../db.server.js";

function rowToAPI(row) {
  return {
    customerId: row.customerId,
    displayName: row.displayName,
    email: row.email,
    profilePicUrl: row.profilePicUrl,
    linkedAt: row.linkedAt.toISOString(),
    isAmbassador: !!row.isAmbassador,
    role: row.role || null,
    quote: row.quote || null,
    setup: row.setup || null,
    base: row.base || null,
    joinedYear: row.joinedYear || null,
    scenarios: row.scenarios ? safeJSON(row.scenarios, []) : [],
  };
}

function safeJSON(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

export async function getCreatorLink(username) {
  const row = await prisma.creatorLink.findUnique({ where: { username } });
  if (!row) return null;
  return rowToAPI(row);
}

export async function getAllCreatorLinks() {
  const rows = await prisma.creatorLink.findMany();
  const map = {};
  for (const row of rows) {
    map[row.username] = rowToAPI(row);
  }
  return map;
}

export async function getAmbassadors() {
  const rows = await prisma.creatorLink.findMany({
    where: { isAmbassador: true },
    orderBy: { linkedAt: "asc" },
  });
  return rows.map((row) => ({ username: row.username, ...rowToAPI(row) }));
}

export async function linkCreator(username, { customerId, displayName, email }) {
  return prisma.creatorLink.upsert({
    where: { username },
    update: { customerId, displayName, email },
    create: { username, customerId, displayName, email },
  });
}

export async function updateAmbassadorProfile(username, patch) {
  const data = {
    isAmbassador: !!patch.isAmbassador,
    role: patch.role || null,
    quote: patch.quote || null,
    setup: patch.setup || null,
    base: patch.base || null,
    joinedYear: patch.joinedYear != null && patch.joinedYear !== "" ? Number(patch.joinedYear) : null,
    scenarios: Array.isArray(patch.scenarios) ? JSON.stringify(patch.scenarios) : null,
  };
  return prisma.creatorLink.upsert({
    where: { username },
    update: data,
    create: { username, customerId: "", ...data },
  });
}

export async function unlinkCreator(username) {
  return prisma.creatorLink.delete({ where: { username } }).catch(() => {});
}

export async function updateProfilePic(username, profilePicUrl) {
  return prisma.creatorLink.upsert({
    where: { username },
    update: { profilePicUrl },
    create: { username, customerId: "", profilePicUrl },
  });
}

/**
 * Get profile pic URL for a username.
 * Returns stored URL or null.
 */
export async function getProfilePicUrl(username) {
  const row = await prisma.creatorLink.findUnique({
    where: { username },
    select: { profilePicUrl: true },
  });
  return row?.profilePicUrl || null;
}
