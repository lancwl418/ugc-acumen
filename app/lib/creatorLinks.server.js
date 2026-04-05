// app/lib/creatorLinks.server.js
// Creator → Shopify Customer 关联 — Prisma 版
import prisma from "../db.server.js";

export async function getCreatorLink(username) {
  const row = await prisma.creatorLink.findUnique({ where: { username } });
  if (!row) return null;
  return {
    customerId: row.customerId,
    displayName: row.displayName,
    email: row.email,
    profilePicUrl: row.profilePicUrl,
    linkedAt: row.linkedAt.toISOString(),
  };
}

export async function getAllCreatorLinks() {
  const rows = await prisma.creatorLink.findMany();
  const map = {};
  for (const row of rows) {
    map[row.username] = {
      customerId: row.customerId,
      displayName: row.displayName,
      email: row.email,
      profilePicUrl: row.profilePicUrl,
      linkedAt: row.linkedAt.toISOString(),
    };
  }
  return map;
}

export async function linkCreator(username, { customerId, displayName, email }) {
  return prisma.creatorLink.upsert({
    where: { username },
    update: { customerId, displayName, email },
    create: { username, customerId, displayName, email },
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
