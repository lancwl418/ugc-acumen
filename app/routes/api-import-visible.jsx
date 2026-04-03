// 临时 API — 从 JSON 导入 VisibleMention 数据，用完后删除此文件
import { json } from "@remix-run/node";
import prisma from "../db.server.js";

const VISIBLE_DATA = [
  { id: "18085131338045950", category: "off-road", products: ["the-legend-3ch-waterproof-mirror-dvr-switching-system-with-8-gang-in-car-power-solid-state-switch-control-box-with-wifi-bluetooth-gps-super-night-vision"] },
  { id: "18120235678530231", category: "off-road", products: ["the-legend-3ch-waterproof-mirror-dvr-switching-system-with-8-gang-in-car-power-solid-state-switch-control-box-with-wifi-bluetooth-gps-super-night-vision"] },
  { id: "17867641023483406", category: "travel", products: ["m4-quad-mirror-dash-cam-with-1080p-front-rear-left-right-side-cameras-12ips-touchscreen-2"] },
  { id: "18532131610026505", category: "off-road", products: [] },
  { id: "18086867902927773", category: "off-road", products: [] },
  { id: "18077733232890070", category: "off-road", products: [] },
  { id: "18042867203463669", category: "off-road", products: [] },
  { id: "18077136710022944", category: "off-road", products: [] },
  { id: "18094697233634746", category: "travel", products: [] },
  { id: "18105483700785990", category: "off-road", products: [] },
  { id: "18026960068659285", category: "off-road", products: [] },
  { id: "17929380849109756", category: "off-road", products: [] },
  { id: "18079629666043076", category: "off-road", products: [] },
  { id: "18094680178722006", category: "off-road", products: [] },
  { id: "17920651729182826", category: "off-road", products: [] },
  { id: "18247040247220485", category: "off-road", products: [] },
  { id: "18074020858037982", category: "off-road", products: [] },
  { id: "18008571555714765", category: "off-road", products: [] },
  { id: "18041505447462459", category: "camping", products: [] },
  { id: "18358174564120804", category: "off-road", products: [] },
  { id: "18143009975402050", category: "off-road", products: [] },
  { id: "18074044625037982", category: "off-road", products: [] },
  { id: "18067508553039290", category: "off-road", products: [] },
  { id: "17929479095106540", category: "off-road", products: [] },
  { id: "18079643178043076", category: "off-road", products: [] },
  { id: "18100093009767660", category: "off-road", products: [] },
  { id: "18059866803093510", category: "camping", products: [] },
  { id: "17921260765176474", category: "off-road", products: [] },
  { id: "17889637099321014", category: "off-road", products: [] },
  { id: "18025165093659285", category: "off-road", products: [] },
  { id: "18042853704463669", category: "off-road", products: [] },
  { id: "18098389768799764", category: "off-road", products: [] },
  { id: "18011529974649765", category: "off-road", products: [] },
  { id: "18310268765184131", category: "electronic", products: [] },
];

export async function loader() {
  return json({ message: "POST to this endpoint to import visible data", count: VISIBLE_DATA.length });
}

export async function action() {
  const ids = VISIBLE_DATA.map((v) => v.id);
  const mentions = await prisma.mention.findMany({ where: { id: { in: ids } } });
  const mentionMap = new Map(mentions.map((m) => [m.id, m]));

  let imported = 0;
  let notFound = [];

  for (const entry of VISIBLE_DATA) {
    const m = mentionMap.get(entry.id);
    if (!m) {
      notFound.push(entry.id);
      continue;
    }

    await prisma.visibleMention.upsert({
      where: { id: entry.id },
      update: {
        category: entry.category,
        products: JSON.stringify(entry.products),
      },
      create: {
        id: entry.id,
        username: m.username,
        timestamp: m.timestamp,
        mediaType: m.mediaType,
        mediaUrl: m.mediaUrl,
        thumbnailUrl: m.thumbnailUrl,
        caption: m.caption,
        permalink: m.permalink,
        category: entry.category,
        products: JSON.stringify(entry.products),
        likeCount: m.likeCount,
        commentsCount: m.commentsCount,
      },
    });
    imported++;
  }

  return json({ ok: true, imported, notFound, notFoundCount: notFound.length });
}
