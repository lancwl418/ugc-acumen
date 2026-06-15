// app/lib/instagramAPI.js
// Instagram mentions 抓取 —— 走 FlashAPI（RapidAPI flashapi1），取代 Graph /tags。
// 「mentions」= 别人发帖时 @标记了品牌账号的内容（即 IG 个人页的 Tagged tab）。
import {
  flashGet,
  resolveUserId,
  normalizeTaggedItem,
  withCache,
} from "./flashAPI.server.js";

/* ====================== Mentions（/ig/tagged/）分页 ======================= */
// 注意：FlashAPI 每页固定返回约 21 条，不严格遵守 limit。这里不做切片，
// 以免破坏游标连续性（next_max_id 指向整页末尾）。limit 仅供调用方参考。
export async function fetchTagUGCPage({ limit = 12, after = "" } = {}) {
  return withCache(`tag:${after}`, 30_000, async () => {
    const idUser = await resolveUserId();
    if (!idUser) return { items: [], nextAfter: "" };

    const j = await flashGet("/ig/tagged/", { id_user: idUser, end_cursor: after });
    const items = (j?.items || []).map(normalizeTaggedItem).filter((x) => x.id);
    const nextAfter = j?.more_available ? (j?.next_max_id || "") : "";
    return { items, nextAfter };
  });
}

/* ====================== 单帖评论（/ig/comments/） ======================= */
export async function fetchMediaComments(shortcode, { limit = 20 } = {}) {
  if (!shortcode) return [];
  const j = await flashGet("/ig/comments/", { shortcode, sort: "recent" });
  return (j?.comments || [])
    .slice(0, limit)
    .map((c) => {
      const ts = c.created_at || c.created_at_utc;
      return {
        id: String(c.pk || c.id || ""),
        text: c.text || "",
        username: c.user?.username || "",
        timestamp: ts ? new Date(ts * 1000).toISOString() : "",
      };
    })
    .filter((c) => c.id);
}

/* ====================== 工具：从 permalink 取 shortcode ======================= */
export function shortcodeFromPermalink(url = "") {
  const m = String(url).match(/\/(?:p|reel|tv)\/([^/?#]+)/);
  return m ? m[1] : "";
}

/* ======= 兼容旧接口的 stub（保留导出，避免破坏外部引用） ======= */
export async function refreshMediaUrlByTag(/* entry, opts */) { /* 原样保留 */ }
export async function scanTagsUntil(/* opts */) { /* 原样保留 */ }
