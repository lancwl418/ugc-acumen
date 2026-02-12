// app/lib/creatorLinks.server.js
import fs from "fs/promises";
import { CREATOR_LINKS_PATH, ensureCreatorLinksFile } from "./persistPaths.js";

async function readLinks() {
  await ensureCreatorLinksFile();
  try {
    return JSON.parse(await fs.readFile(CREATOR_LINKS_PATH, "utf-8") || "{}");
  } catch {
    return {};
  }
}

async function writeLinks(data) {
  await ensureCreatorLinksFile();
  await fs.writeFile(CREATOR_LINKS_PATH, JSON.stringify(data, null, 2), "utf-8");
}

export async function getCreatorLink(username) {
  const links = await readLinks();
  return links[username] || null;
}

export async function getAllCreatorLinks() {
  return readLinks();
}

export async function linkCreator(username, { customerId, displayName, email }) {
  const links = await readLinks();
  links[username] = {
    customerId,
    displayName,
    email,
    linkedAt: new Date().toISOString(),
  };
  await writeLinks(links);
  return links[username];
}

export async function unlinkCreator(username) {
  const links = await readLinks();
  delete links[username];
  await writeLinks(links);
}
