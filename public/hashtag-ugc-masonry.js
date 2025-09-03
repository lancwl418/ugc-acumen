/* public/hashtag-ugc-masonry.js */
(function () {
  const SCRIPT =
    document.currentScript || document.getElementById("acumen-hashtag-ugc");
  const API_BASE =
    (SCRIPT && SCRIPT.getAttribute("data-api-base")) ||
    "https://ugc.acumen-camera.com";

  // 后端接口
  const API_HASHTAG = `${API_BASE}/api-hashtag-ugc`;      // Hashtag 可见清单
  const API_TAG     = `${API_BASE}/api-tag-ugc`;          // ✅ 新增：Tag/Mentions 可见清单
  const API_OEMBED  = `${API_BASE}/api-ig-oembed`;        // oEmbed 代理
  const API_DETAIL  = `${API_BASE}/api-ugc-media-detail`; // 弹窗详细三层兜底

  // 分类容器
  const TARGETS = {
    camping:        document.querySelector("#ugc-camping"),
    "off-road":     document.querySelector("#ugc-off-road"),
    electronic:     document.querySelector("#ugc-electronic"),
    travel:         document.querySelector("#ugc-travel"),
    documentation:  document.querySelector("#ugc-documentation"),
    events:         document.querySelector("#ugc-events"),
  };

  // 轻量缓存：按 id 存 admin 列表里的条目，供弹窗兜底
  const ITEM_CACHE = new Map();

  // 样式
  const css = `
  .ugc-masonry { column-count: 1; column-gap: 16px; }
  @media (min-width: 640px) { .ugc-masonry { column-count: 2; } }
  @media (min-width: 1024px){ .ugc-masonry { column-count: 3; } }
  .ugc-card { break-inside: avoid; margin-bottom: 16px; border-radius: 8px; overflow: hidden; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.06); }
  .ugc-card button { display:block; padding:0; border:0; width:100%; background:none; cursor:pointer; }
  .ugc-media-wrap { width:100%; display:block; background:#f6f6f6; }
  .ugc-media-wrap img, .ugc-media-wrap video { width:100%; height:auto; display:block; }
  .ugc-caption { padding: 12px; font-size: 14px; line-height: 1.5; color:#333; }
  .ugc-loadmore { margin: 16px auto 0; display:block; padding:10px 16px; border:1px solid #ddd; background:#fff; border-radius:6px; cursor:pointer; }
  .ugc-empty { color:#999; font-size:14px; padding:16px 0; text-align:center; }

  /* Modal */
  .igm[hidden]{display:none}
  .igm{position:fixed;inset:0;z-index:9999}
  .igm__bg{position:absolute;inset:0;background:rgba(0,0,0,.55)}
  .igm__dlg{position:absolute;inset:5% 8%;background:#fff;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 10px 30px rgba(0,0,0,.18)}
  .igm__x{position:absolute;top:10px;right:10px;font-size:24px;background:#fff;border:1px solid #eee;border-radius:50%;width:36px;height:36px;cursor:pointer}
  .igm__body{flex:1;display:flex;align-items:center;justify-content:center;min-height:300px;padding:0}
  .igm__body img,.igm__body iframe,.igm__body video{max-width:100%;max-height:80vh;display:block}
  .igm__actions{padding:12px;border-top:1px solid #eee;display:flex;justify-content:flex-end;gap:8px}
  .igm__btn{padding:8px 12px;border:1px solid #ddd;border-radius:8px;background:#fff}
  .igm__wrap{position:relative}
  .igm__shield{position:absolute;inset:0;background:transparent}
  `;
  const style = document.createElement("style");
  style.innerHTML = css;
  document.head.appendChild(style);

  /* ---------------- Modal ---------------- */
  const modal = document.createElement("div");
  modal.id = "ig-modal";
  modal.className = "igm";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="igm__bg" data-close></div>
    <div class="igm__dlg" role="dialog" aria-modal="true">
      <button class="igm__x" type="button" data-close>&times;</button>
      <div id="ig-modal-body" class="igm__body"></div>
      <div class="igm__actions">
        <a id="ig-open" class="igm__btn" target="_blank" rel="noopener">View on Instagram</a>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const modalBody = modal.querySelector("#ig-modal-body");
  const modalOpen = modal.querySelector("#ig-open");
  modal.addEventListener("click", (e) => {
    if (e.target.hasAttribute("data-close")) closeModal();
  });
  function openModal() {
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeModal() {
    modal.hidden = true;
    modalBody.innerHTML = "";
    document.body.style.overflow = "";
  }

  function ensureEmbedJs() {
    if (window.__igEmbedLoaded) {
      window.instgrm?.Embeds?.process();
      return;
    }
    const s = document.createElement("script");
    s.src = "https://www.instagram.com/embed.js";
    s.async = true;
    s.onload = () => {
      window.__igEmbedLoaded = true;
      window.instgrm?.Embeds?.process();
    };
    document.body.appendChild(s);
  }

  // 弹窗三层兜底：优先 /api-ugc-media-detail → 失败用 /api-ig-oembed → 最后用 admin 缓存
  async function openLightboxById(mediaId) {
    const adminFallback = ITEM_CACHE.get(mediaId) || {};
    const permalink = adminFallback.permalink || "";
    modalOpen.href = permalink || "#";
    modalBody.innerHTML = '<div style="padding:40px;color:#999">Loading…</div>';
    openModal();

    // A) 详细接口（Graph 优先，服务端已做三层兜底）
    try {
      const r = await fetch(`${API_DETAIL}?media_id=${encodeURIComponent(mediaId)}`, { mode: "cors" });
      if (r.ok) {
        const j = await r.json();
        if (j.media_type === "VIDEO" && j.media_url) {
          modalBody.innerHTML = `<video controls playsinline preload="metadata"><source src="${j.media_url}" type="video/mp4"></video>`;
        } else {
          const img = j.media_url || j.thumbnail_url || adminFallback.media_url || adminFallback.thumbnail_url || "";
          modalBody.innerHTML = img ? `<img src="${img}" alt="">` : `<div style="padding:40px">No media.</div>`;
        }
        if (j.permalink || permalink) modalOpen.href = j.permalink || permalink;
        return; // ✅
      }
    } catch (e) {
      console.info("detail api failed, fallback to oEmbed/admin:", e);
    }

    // B) oEmbed（需要 permalink）
    if (permalink) {
      try {
        const r = await fetch(`${API_OEMBED}?url=${encodeURIComponent(permalink)}`, { mode: "cors" });
        if (r.ok) {
          const j = await r.json();
          if (j.html && /<video/i.test(j.html)) {
            modalBody.innerHTML = `<div class="igm__wrap">${j.html}<div class="igm__shield" title="Open in Instagram via the button below"></div></div>`;
            ensureEmbedJs();
          } else {
            const src = j.thumbnail_url || adminFallback.media_url || adminFallback.thumbnail_url || "";
            modalBody.innerHTML = src ? `<img src="${src}" alt="">` : `<div style="padding:40px">Unable to load.</div>`;
          }
          return;
        }
      } catch (e) {
        console.info("oEmbed failed, fallback to admin:", e);
      }
    }

    // C) Admin 最后一层
    const fallback =
      adminFallback.media_url || adminFallback.thumbnail_url || "";
    modalBody.innerHTML = fallback
      ? `<img src="${fallback}" alt="">`
      : `<div style="padding:40px">No media available.</div>`;
  }

  /* ---------------- Masonry ---------------- */
  class MasonryList {
    constructor(container, category, pageSize = 24) {
      this.container = container;
      this.category = category;
      this.pageSize = pageSize;
      this.offset = 0;        // 同步用于 hashtag & tag 两个接口
      this.total = 0;

      if (!this.container) {
        console.warn(`[UGC] container for "${category}" not found, skip.`);
        this.disabled = true;
        return;
      }

      this.wrap = document.createElement("div");
      this.wrap.className = "ugc-masonry";

      this.loadMoreBtn = document.createElement("button");
      this.loadMoreBtn.className = "ugc-loadmore";
      this.loadMoreBtn.textContent = "Load more";
      this.loadMoreBtn.addEventListener("click", () => this.loadMore());

      this.container.innerHTML = "";
      this.container.appendChild(this.wrap);
      this.container.appendChild(this.loadMoreBtn);

      // 事件代理：点击卡片 => 按 media_id 打开弹窗（走三层兜底）
      this.wrap.addEventListener("click", (e) => {
        const btn = e.target.closest(".ugc-open");
        if (!btn) return;
        e.preventDefault();
        const card = btn.closest(".ugc-card");
        const id = card?.dataset.id;
        if (id) openLightboxById(id);
      });
    }

    async loadMore() {
      if (this.disabled) return;

      try {
        const data = await this.fetchPage(this.offset);
        const list = data.media || [];
        const failed = data.failed || [];
        // total 用两边 total 之和，尽量把两类都吃完
        this.total = data.total || this.total;

        if (failed.length) {
          console.info(`[UGC] ${this.category} partial failed:`, failed);
        }

        if (!list.length) {
          if (this.offset === 0) {
            const empty = document.createElement("div");
            empty.className = "ugc-empty";
            empty.textContent = "No posts yet.";
            this.wrap.appendChild(empty);
          }
          this.loadMoreBtn.style.display = "none";
          return;
        }

        for (const item of list) this.appendItem(item);

        this.offset += list.length;
        this.loadMoreBtn.style.display =
          this.offset >= this.total ? "none" : "inline-block";
      } catch (err) {
        console.error(`[UGC] fetch error (${this.category}):`, err);
      }
    }

    async fetchPage(offset) {
      // 读取 hashtag & tag 两类可见清单，服务端已按 category 过滤
      const qs = `category=${encodeURIComponent(this.category)}&limit=${this.pageSize}&offset=${offset}&noRefetch=1`;
      const [rHashtag, rTag] = await Promise.allSettled([
        fetch(`${API_HASHTAG}?${qs}`, { mode: "cors" }),
        fetch(`${API_TAG}?${qs}`,     { mode: "cors" }),
      ]);

      let hashtag = { media: [], total: 0, failed: [] };
      let tag     = { media: [], total: 0, failed: [] };

      if (rHashtag.status === "fulfilled" && rHashtag.value.ok) {
        hashtag = await rHashtag.value.json();
      }
      if (rTag.status === "fulfilled" && rTag.value.ok) {
        tag = await rTag.value.json();
      }

      // 合并 + 时间降序
      const merged = [...(hashtag.media || []), ...(tag.media || [])]
        .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));

      return {
        media: merged,
        total: (hashtag.total || 0) + (tag.total || 0),
        failed: [...(hashtag.failed || []), ...(tag.failed || [])],
      };
    }

    appendItem(item) {
      if (!this.wrap) return;

      // 写入本地缓存（弹窗兜底用）
      ITEM_CACHE.set(item.id, item);

      const card = document.createElement("div");
      card.className = "ugc-card";
      card.dataset.id = item.id;
      card.dataset.type = item.media_type || "IMAGE";

      const mediaUrl = item.media_url || item.thumbnail_url || "";
      if (!mediaUrl) return;

      const mediaHtml =
        item.media_type === "VIDEO"
          ? `<img class="ugc-media-wrap" src="${mediaUrl}" alt="">`
          : `<img class="ugc-media-wrap" src="${mediaUrl}" alt="">`;

      const author =
        item.username || item.author
          ? `<div class="ugc-caption" style="color:#666;font-size:12px;margin-top:-6px;">
               @${escapeHtml(item.username || item.author)}
             </div>`
          : "";

      card.innerHTML = `
        <button class="ugc-open" type="button">
          ${mediaHtml}
        </button>
        ${
          item.caption
            ? `<div class="ugc-caption">${escapeHtml(
                (item.caption || "").slice(0, 200)
              )}</div>`
            : ""
        }
        ${author}
      `;
      this.wrap.appendChild(card);
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function boot() {
    Object.keys(TARGETS).forEach((cat) => {
      const el = TARGETS[cat];
      if (!el) return;
      const ms = new MasonryList(el, cat, 24);
      ms.loadMore();
    });
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
