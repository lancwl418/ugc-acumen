/* public/hashtag-ugc-masonry.js — modal 改为 acumen-* 风格 */
(function () {
  const SCRIPT =
    document.currentScript || document.getElementById("acumen-hashtag-ugc");
  const API_BASE =
    (SCRIPT && SCRIPT.getAttribute("data-api-base")) ||
    "https://ugc.acumen-camera.com";

  // 后端接口
  const API_HASHTAG = `${API_BASE}/api-hashtag-ugc`;      // Hashtag 可见清单
  const API_TAG     = `${API_BASE}/api-tag-ugc`;          // Tag/Mentions 可见清单
  const API_OEMBED  = `${API_BASE}/api-ig-oembed`;        // oEmbed 代理
  const API_DETAIL  = `${API_BASE}/api-ugc-media-detail`; // 弹窗详细三层兜底
  const API_PRODUCTS = `${API_BASE}/api-products`;        // 商品数据（handle->meta）

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

  // 商品缓存：handle -> {title, image, price, link}
  let PRODUCT_MAP = null;
  async function ensureProductMap() {
    if (PRODUCT_MAP) return PRODUCT_MAP;
    try {
      const r = await fetch(API_PRODUCTS, { mode: "cors" });
      const j = await r.json();
      const map = {};
      (j.products || []).forEach(p => { map[p.handle] = p; });
      PRODUCT_MAP = map;
    } catch {
      PRODUCT_MAP = {};
    }
    return PRODUCT_MAP;
  }

  /* ---------------- 样式（含 masonry + 新 modal 的 acumen-* 样式） ---------------- */
  const style = document.createElement("style");
  style.innerHTML = `
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

  /* =============== acumen modal =============== */

  /* 弹窗背景 */
  .acumen-modal {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 9999;
  }

  /* 弹窗主体（左右布局） */
  .acumen-modal-content {
    position: relative;
    background: #fff;
    border-radius: 8px;
    padding: 24px;
    display: flex;
    gap: 24px;
    max-width: 980px;        /* 比你给的略宽一些，右侧信息更舒展 */
    max-height: 80vh;
    overflow: hidden;
    font-family: Arial, sans-serif;
  }

  /* 左侧媒体区域固定宽高 */
  .acumen-media {
    flex: 0 0 320px;
  }
  .acumen-mediaBox{
    width:320px; height:400px;
    border-radius:8px;
    background:#f6f6f6;
    position:relative; overflow:hidden;
    display:flex; align-items:center; justify-content:center;
  }
  .acumen-mediaBox img, .acumen-mediaBox video{
    width:100%; height:100%; object-fit:contain; display:block;
  }

  /* 轮播 */
  .acumen-carousel{position:relative;width:100%;height:100%}
  .acumen-slide{position:absolute;inset:0;opacity:0;transition:opacity .25s ease}
  .acumen-slide.is-active{opacity:1}
  .acumen-cbtn{position:absolute;top:50%;transform:translateY(-50%);width:36px;height:36px;border-radius:50%;border:0;background:rgba(0,0,0,.5);color:#fff;cursor:pointer}
  .acumen-cbtn.prev{left:8px}
  .acumen-cbtn.next{right:8px}

  /* 右侧信息区 */
  .acumen-modal-right {
    flex: 1;
    min-width:0;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow: auto;
  }
  .acumen-modal-close {
    position: absolute;
    top: 8px;
    right: 12px;
    font-size: 28px;
    font-weight: bold;
    color: #333;
    cursor: pointer;
    line-height: 1;
  }
  .acumen-modal-close:hover { color: red; }

  /* 相关产品（横滑条 + 按钮） */
  .acumen-products{position:relative}
  .acumen-products h4{margin:0 0 8px}
  .acumen-pstrip{display:flex;gap:12px;overflow:auto;scrollbar-width:none;padding-bottom:6px}
  .acumen-pstrip::-webkit-scrollbar{display:none}
  .acumen-ps-btn{position:absolute;top:16px;transform:translateY(-50%);width:30px;height:30px;border-radius:50%;border:0;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.1);cursor:pointer}
  .acumen-ps-btn.prev{left:-8px}
  .acumen-ps-btn.next{right:-8px}

  /* 产品卡片（沿用你的命名） */
  .ugc-product-card {
    display: flex; align-items: center; gap: 8px;
    padding: 8px; border: 1px solid #eee; border-radius: 6px;
    min-width: 260px; max-width: 260px; background:#fff;
  }
  .ugc-product-card img {
    width: 60px; height: 60px; object-fit: cover; border-radius: 4px;
  }
  .ugc-product-card a {
    font-size: 12px; color: #007bff; text-decoration: underline;
  }
  .ugc-product-title{font-size:14px;line-height:1.35;margin:0 0 4px}
  .ugc-product-price{color:#d45a20;font-weight:600;font-size:14px;margin:0 0 4px}

  /* 作者 + caption */
  .acumen-caption{font-size:14px;line-height:1.6;color:#333;white-space:pre-wrap}
  .acumen-author{font-weight:600;margin-right:6px}
  .acumen-original a{font-size:14px;color:#007bff;text-decoration:underline}
  `;
  document.head.appendChild(style);

  /* ---------------- Modal 容器 ---------------- */
  const modal = document.createElement("div");
  modal.className = "acumen-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="acumen-modal-content" role="dialog" aria-modal="true">
      <span class="acumen-modal-close" data-close>&times;</span>
      <div id="acumen-modal-body" style="display:flex;gap:24px;flex:1;min-width:0;"></div>
    </div>`;
  document.body.appendChild(modal);
  const modalBody = modal.querySelector("#acumen-modal-body");
  modal.addEventListener("click", (e) => {
    if (e.target.hasAttribute("data-close") || e.target === modal) closeModal();
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

  /* ---------------- 媒体渲染（按 acumen-*） ---------------- */
  function renderCarousel(children = []) {
    const slides = children
      .map((c, i) => {
        const url = c.media_url || c.thumbnail_url || "";
        const isVid = c.media_type === "VIDEO" && /\.mp4(\?|$)/i.test(url);
        if (isVid) {
          return `<div class="acumen-slide ${i === 0 ? "is-active" : ""}">
            <video autoplay muted playsinline controls preload="metadata">
              <source src="${url}" type="video/mp4" />
            </video>
          </div>`;
        }
        return `<div class="acumen-slide ${i === 0 ? "is-active" : ""}">
          <img src="${url}" alt="" />
        </div>`;
      })
      .join("");

    return `
      <div class="acumen-mediaBox">
        <div class="acumen-carousel">
          ${slides}
          ${children.length > 1 ? `
            <button class="acumen-cbtn prev" type="button" aria-label="Prev">&#9664;</button>
            <button class="acumen-cbtn next" type="button" aria-label="Next">&#9654;</button>
          ` : ""}
        </div>
      </div>`;
  }

  function bindCarouselEvents(root) {
    const slides = Array.from(root.querySelectorAll(".acumen-slide"));
    if (slides.length <= 1) return;
    let idx = slides.findIndex(s => s.classList.contains("is-active"));
    const go = (d) => {
      slides[idx].classList.remove("is-active");
      idx = (idx + d + slides.length) % slides.length;
      slides[idx].classList.add("is-active");
    };
    root.querySelector(".acumen-cbtn.prev")?.addEventListener("click", () => go(-1));
    root.querySelector(".acumen-cbtn.next")?.addEventListener("click", () => go(+1));
  }

  function renderSingleMedia(detailOrItem) {
    const url = detailOrItem.media_url || detailOrItem.thumbnail_url || "";
    const isVideo = (detailOrItem.media_type === "VIDEO") && /\.mp4(\?|$)/i.test(url);
    if (isVideo) {
      return `
        <div class="acumen-mediaBox">
          <video muted playsinline autoplay controls preload="metadata">
            <source src="${url}" type="video/mp4" />
          </video>
        </div>`;
    }
    return `
      <div class="acumen-mediaBox">
        <img src="${url}" alt="" />
      </div>`;
  }

  function mediaHTML(detail, fallback) {
    const children =
      detail?.children?.data?.length ? detail.children.data :
      (fallback?.children?.data?.length ? fallback.children.data : null);

    if (children && children.length) return renderCarousel(children);
    if (detail && (detail.media_url || detail.thumbnail_url)) return renderSingleMedia(detail);
    if (fallback && (fallback.media_url || fallback.thumbnail_url)) return renderSingleMedia(fallback);
    return `<div class="acumen-mediaBox"></div>`;
  }

  /* ---------------- 产品渲染（按示例风格） ---------------- */
  function productsHTML(handles = [], productMap = {}) {
    const items = (handles || [])
      .map(h => productMap[h])
      .filter(Boolean);
    if (!items.length) return "";

    const cards = items.map(p => `
      <div class="ugc-product-card">
        <img src="${p.image}" alt="${escapeHtml(p.title)}" />
        <div>
          <div class="ugc-product-title">${escapeHtml(p.title)}</div>
          ${p.price ? `<div class="ugc-product-price">$${p.price}</div>` : ""}
          <a href="${p.link}" target="_blank" rel="noopener">View More</a>
        </div>
      </div>
    `).join("");

    return `
      <div class="acumen-products">
        <h4>Related Products</h4>
        <button class="acumen-ps-btn prev" type="button" aria-label="Prev">&#9664;</button>
        <div class="acumen-pstrip">${cards}</div>
        <button class="acumen-ps-btn next" type="button" aria-label="Next">&#9654;</button>
      </div>`;
  }

  function bindProductsStrip(root) {
    const strip = root.querySelector(".acumen-pstrip");
    if (!strip) return;
    const prev = root.querySelector(".acumen-ps-btn.prev");
    const next = root.querySelector(".acumen-ps-btn.next");
    const step = 280;
    prev?.addEventListener("click", () => strip.scrollBy({ left: -step, behavior: "smooth" }));
    next?.addEventListener("click", () => strip.scrollBy({ left: step, behavior: "smooth" }));
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

  /* ---------------- 弹窗：三层兜底 + 渲染 ---------------- */
  async function openLightboxById(mediaId) {
    const adminFallback = ITEM_CACHE.get(mediaId) || {};
    let detail = null;

    modalBody.innerHTML = '<div style="padding:20px;color:#999">Loading…</div>';
    openModal();

    try {
      const r = await fetch(`${API_DETAIL}?media_id=${encodeURIComponent(mediaId)}`, { mode: "cors" });
      if (r.ok) detail = await r.json();
    } catch {}

    const username = detail?.username || adminFallback.username || "";
    const caption  = detail?.caption  || adminFallback.caption  || "";
    const permalink = detail?.permalink || adminFallback.permalink || "";

    await ensureProductMap();
    const productsHTMLStr = productsHTML(adminFallback.products || [], PRODUCT_MAP);

    let mediaBoxHTML = mediaHTML(detail, adminFallback);

    if (mediaBoxHTML.includes('acumen-mediaBox"></div>') && permalink) {
      try {
        const r = await fetch(`${API_OEMBED}?url=${encodeURIComponent(permalink)}`, { mode: "cors" });
        if (r.ok) {
          const e = await r.json();
          if (e.html && /<video/i.test(e.html)) {
            mediaBoxHTML = `
              <div class="acumen-mediaBox">
                <div class="acumen-carousel">
                  <div class="acumen-slide is-active">
                    ${e.html}
                  </div>
                </div>
              </div>`;
            ensureEmbedJs();
          } else if (e.thumbnail_url) {
            mediaBoxHTML = `
              <div class="acumen-mediaBox">
                <img src="${e.thumbnail_url}" alt="">
              </div>`;
          }
        }
      } catch {}
    }

    modalBody.innerHTML = `
      <div class="acumen-media">
        ${mediaBoxHTML}
      </div>
      <div class="acumen-modal-right">
        ${productsHTMLStr || ""}
        <div class="acumen-caption">
          ${username ? `<span class="acumen-author">@${escapeHtml(username)}</span>` : ""}
          ${escapeHtml(caption || "No caption.")}
        </div>
        <div class="acumen-original">
          ${permalink ? `<a href="${permalink}" target="_blank" rel="noopener">View original post</a>` : ""}
        </div>
      </div>
    `;

    const car = modalBody.querySelector(".acumen-carousel");
    if (car) bindCarouselEvents(car);
    const pro = modalBody.querySelector(".acumen-products");
    if (pro) bindProductsStrip(pro);
  }

  /* ---------------- Masonry 列表（不变） ---------------- */
  class MasonryList {
    constructor(container, category, pageSize = 24) {
      this.container = container;
      this.category = category;
      this.pageSize = pageSize;

      this.offsetHashtag = 0;
      this.offsetTag = 0;
      this.totalHashtag = 0;
      this.totalTag = 0;

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
        const data = await this.fetchPage(this.offsetHashtag, this.offsetTag);
        const list = data.media || [];

        if (!list.length && this.offsetHashtag === 0 && this.offsetTag === 0) {
          const empty = document.createElement("div");
          empty.className = "ugc-empty";
          empty.textContent = "No posts yet.";
          this.wrap.appendChild(empty);
          this.loadMoreBtn.style.display = "none";
          return;
        }

        for (const item of list) this.appendItem(item);

        this.offsetHashtag += data.gotHashtag || 0;
        this.offsetTag += data.gotTag || 0;
        this.totalHashtag = data.totalHashtag || this.totalHashtag;
        this.totalTag = data.totalTag || this.totalTag;

        const allDone =
          this.offsetHashtag >= (this.totalHashtag || 0) &&
          this.offsetTag >= (this.totalTag || 0);
        this.loadMoreBtn.style.display = allDone ? "none" : "inline-block";
      } catch (err) {
        console.error(`[UGC] fetch error (${this.category}):`, err);
      }
    }

    async fetchPage(offsetHashtag, offsetTag) {
      const sizeH = Math.ceil(this.pageSize / 2);
      const sizeT = this.pageSize - sizeH;

      const qsH = `category=${encodeURIComponent(this.category)}&limit=${sizeH}&offset=${offsetHashtag}&noRefetch=1`;
      const qsT = `category=${encodeURIComponent(this.category)}&limit=${sizeT}&offset=${offsetTag}&noRefetch=1`;

      const [rHashtag, rTag] = await Promise.allSettled([
        fetch(`${API_HASHTAG}?${qsH}`, { mode: "cors" }),
        fetch(`${API_TAG}?${qsT}`, { mode: "cors" }),
      ]);

      let hashtag = { media: [], total: 0 };
      let tag = { media: [], total: 0 };

      if (rHashtag.status === "fulfilled" && rHashtag.value.ok) {
        hashtag = await rHashtag.value.json();
      }
      if (rTag.status === "fulfilled" && rTag.value.ok) {
        tag = await rTag.value.json();
      }

      const merged = [...(hashtag.media || []), ...(tag.media || [])]
        .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));

      return {
        media: merged,
        totalHashtag: hashtag.total || 0,
        totalTag: tag.total || 0,
        gotHashtag: (hashtag.media || []).length,
        gotTag: (tag.media || []).length,
      };
    }

    appendItem(item) {
      ITEM_CACHE.set(item.id, item);

      const card = document.createElement("div");
      card.className = "ugc-card";
      card.dataset.id = item.id;
      card.dataset.type = item.media_type || "IMAGE";

      const mediaUrl = item.media_url || item.thumbnail_url || "";
      const isVideo = (item.media_type === "VIDEO") && /\.mp4(\?|$)/i.test(mediaUrl);

      let mediaHtml = "";
      if (isVideo) {
        mediaHtml = `
          <video class="ugc-media-wrap" autoplay muted playsinline loop preload="metadata">
            <source src="${mediaUrl}" type="video/mp4" />
          </video>`;
      } else {
        mediaHtml = `<img class="ugc-media-wrap" src="${mediaUrl}" alt="">`;
      }

      const author =
        item.username
          ? `<div class="ugc-caption" style="color:#666;font-size:12px;margin-top:-6px;">
               @${escapeHtml(item.username)}
             </div>`
          : "";

      card.innerHTML = `
        <button class="ugc-open" type="button">
          ${mediaHtml}
        </button>
        ${
          item.caption
            ? `<div class="ugc-caption">${escapeHtml((item.caption || "").slice(0, 200))}</div>`
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
