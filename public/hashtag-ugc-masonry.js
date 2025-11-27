/* public/hashtag-ugc-masonry.js — Masonry + acumen modal + big/small cards */
(function () {
  const SCRIPT =
    document.currentScript || document.getElementById("acumen-hashtag-ugc");
  const API_BASE =
    (SCRIPT && SCRIPT.getAttribute("data-api-base")) ||
    "https://ugc.acumen-camera.com";

  // 后端接口
  const API_HASHTAG = `${API_BASE}/api-hashtag-ugc`;
  const API_TAG = `${API_BASE}/api-tag-ugc`;
  const API_OEMBED = `${API_BASE}/api-ig-oembed`;
  const API_DETAIL = `${API_BASE}/api-ugc-media-detail`;
  const API_PRODUCTS = `${API_BASE}/api-products`;

  // 分类容器
  const TARGETS = {
    camping: document.querySelector("#ugc-camping"),
    "off-road": document.querySelector("#ugc-off-road"),
    electronic: document.querySelector("#ugc-electronic"),
    travel: document.querySelector("#ugc-travel"),
    documentation: document.querySelector("#ugc-documentation"),
    events: document.querySelector("#ugc-events"),
  };

  // 轻量缓存
  const ITEM_CACHE = new Map();

  // 商品缓存
  let PRODUCT_MAP = null;
  async function ensureProductMap() {
    if (PRODUCT_MAP) return PRODUCT_MAP;
    try {
      const r = await fetch(API_PRODUCTS, { mode: "cors" });
      const j = await r.json();
      const map = {};
      (j.products || []).forEach((p) => {
        map[p.handle] = p;
      });
      PRODUCT_MAP = map;
    } catch {
      PRODUCT_MAP = {};
    }
    return PRODUCT_MAP;
  }

  /* ---------------- 样式 ---------------- */
  const style = document.createElement("style");
  style.innerHTML = `

  /* ---------------- Masonry 瀑布流布局 ---------------- */
  .ugc-masonry {
    column-count: 1;
    column-gap: 16px;
  }
  @media (min-width: 640px) { .ugc-masonry { column-count: 2; } }
  @media (min-width: 1024px){ .ugc-masonry { column-count: 3; } }
  @media (min-width: 1440px){ .ugc-masonry { column-count: 4; } }

  /* 卡片基础 */
  .ugc-card {
    break-inside: avoid;
    margin-bottom: 16px;
    border-radius: 12px;
    overflow: hidden;
    background: #fff;
    box-shadow: 0 2px 8px rgba(0,0,0,.06);
    display: block;
  }

  .ugc-open {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
  }

  /* 大卡片媒体 */
  .ugc-media-wrap {
    width: 100%;
    display: block;
    background: #f6f6f6;
  }
  .ugc-media-wrap img,
  .ugc-media-wrap video {
    width: 100%;
    height: auto;
    display: block;
  }

  /* ---------------- 小卡片（高度短一点） ---------------- */
  .ugc-card--compact .ugc-media-wrap {
    max-height: 220px;
    overflow: hidden;
  }
  .ugc-card--compact .ugc-media-wrap img,
  .ugc-card--compact .ugc-media-wrap video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .ugc-card--compact .ugc-caption {
    padding: 10px;
    font-size: 13px;
  }

  /* caption */
  .ugc-caption {
    padding: 12px;
    font-size: 14px;
    line-height: 1.5;
    color: #333;
  }

  .ugc-loadmore {
    margin: 16px auto 0;
    display: block;
    padding: 10px 16px;
    border: 1px solid #ddd;
    background: #fff;
    border-radius: 6px;
    cursor: pointer;
  }
  .ugc-empty {
    color: #999;
    font-size: 14px;
    padding: 16px 0;
    text-align: center;
  }

  /* ---------------- acumen modal ---------------- */
  .acumen-modal {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 99999;
  }
  .acumen-modal-content {
    position: relative;
    background: #fff;
    border-radius: 10px;
    display: flex;
    gap: 24px;
    padding: 24px;
    max-width: 980px;
    max-height: 80vh;
    overflow: hidden;
  }
  .acumen-modal-close {
    position: absolute;
    right: 16px;
    top: 8px;
    font-size: 28px;
    cursor: pointer;
  }

  .acumen-media { flex: 0 0 320px; }
  .acumen-mediaBox {
    width: 320px; height: 400px;
    background: #f6f6f6;
    border-radius: 8px;
    display:flex;align-items:center;justify-content:center;
    overflow:hidden;
  }
  .acumen-mediaBox img,
  .acumen-mediaBox video {
    width:100%;height:100%;object-fit:contain;
  }

  /* 轮播 */
  .acumen-carousel { position:relative;width:100%;height:100%; }
  .acumen-slide { position:absolute;inset:0;opacity:0;transition:.25s; }
  .acumen-slide.is-active { opacity:1; }
  .acumen-cbtn {
    position:absolute;top:50%;transform:translateY(-50%);
    width:36px;height:36px;border-radius:50%;
    background:rgba(0,0,0,.4);color:#fff;border:0;cursor:pointer;
  }
  .acumen-cbtn.prev { left:8px; }
  .acumen-cbtn.next { right:8px; }

  /* 右侧 */
  .acumen-modal-right {
    flex:1;overflow:auto;display:flex;flex-direction:column;gap:16px;
  }

  /* 产品条 */
  .acumen-products{position:relative}
  .acumen-pstrip{display:flex;gap:12px;overflow:auto;padding-bottom:6px}
  .acumen-pstrip::-webkit-scrollbar{display:none}
  .acumen-ps-btn{
    position:absolute;top:50%;transform:translateY(-50%);
    width:30px;height:30px;border-radius:50%;
    background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.1);
    border:0;cursor:pointer;
  }
  .acumen-ps-btn.prev{left:-8px}
  .acumen-ps-btn.next{right:-8px}

  /* 产品卡片 */
  .ugc-product-card {
    display:flex;gap:8px;padding:8px;
    border:1px solid #eee;border-radius:6px;background:#fff;
    min-width:240px;
  }
  .ugc-product-card img { width:60px;height:60px;object-fit:cover;border-radius:4px; }
  .ugc-product-title{font-size:14px;font-weight:600;}
  .ugc-product-price{font-size:14px;color:#d45a20;font-weight:600;}

  `;
  document.head.appendChild(style);

  /* ---------------- Modal 容器 ---------------- */
  const modal = document.createElement("div");
  modal.className = "acumen-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="acumen-modal-content">
      <span class="acumen-modal-close" data-close>&times;</span>
      <div id="acumen-modal-body" style="display:flex;gap:24px;flex:1;"></div>
    </div>`;
  document.body.appendChild(modal);
  const modalBody = modal.querySelector("#acumen-modal-body");

  modal.addEventListener("click", (e) => {
    if (e.target === modal || e.target.hasAttribute("data-close")) closeModal();
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

  /* ---------------- 媒体渲染 ---------------- */
  function renderCarousel(children = []) {
    const slides = children
      .map(
        (c, i) => `
      <div class="acumen-slide ${i === 0 ? "is-active" : ""}">
        ${
          c.media_type === "VIDEO" && /\.mp4/.test(c.media_url)
            ? `<video autoplay muted playsinline controls><source src="${c.media_url}" type="video/mp4"></video>`
            : `<img src="${c.media_url}" />`
        }
      </div>`
      )
      .join("");

    return `
      <div class="acumen-mediaBox">
        <div class="acumen-carousel">
          ${slides}
          ${
            children.length > 1
              ? `
            <button class="acumen-cbtn prev">&#9664;</button>
            <button class="acumen-cbtn next">&#9654;</button>`
              : ""
          }
        </div>
      </div>`;
  }

  function bindCarouselEvents(root) {
    const slides = [...root.querySelectorAll(".acumen-slide")];
    if (slides.length <= 1) return;

    let idx = slides.findIndex((s) => s.classList.contains("is-active"));
    function go(d) {
      slides[idx].classList.remove("is-active");
      idx = (idx + d + slides.length) % slides.length;
      slides[idx].classList.add("is-active");
    }

    root.querySelector(".acumen-cbtn.prev")?.addEventListener("click", () =>
      go(-1)
    );
    root.querySelector(".acumen-cbtn.next")?.addEventListener("click", () =>
      go(1)
    );
  }

  function renderSingleMedia(item) {
    const url = item.media_url;
    if (item.media_type === "VIDEO" && /\.mp4/.test(url)) {
      return `
      <div class="acumen-mediaBox">
        <video autoplay muted playsinline controls>
          <source src="${url}" type="video/mp4">
        </video>
      </div>`;
    }
    return `
      <div class="acumen-mediaBox">
        <img src="${url}">
      </div>`;
  }

  function mediaHTML(detail, fallback) {
    const children =
      detail?.children?.data?.length
        ? detail.children.data
        : fallback?.children?.data?.length
        ? fallback.children.data
        : null;

    if (children) return renderCarousel(children);
    const d = detail || fallback;
    return d ? renderSingleMedia(d) : `<div class="acumen-mediaBox"></div>`;
  }

  /* ---------------- 关联产品渲染 ---------------- */
  function productsHTML(handles = [], map = {}) {
    const items = handles.map((h) => map[h]).filter(Boolean);
    if (!items.length) return "";

    const cards = items
      .map(
        (p) => `
      <div class="ugc-product-card">
        <img src="${p.image}">
        <div>
          <div class="ugc-product-title">${p.title}</div>
          <div class="ugc-product-price">$${p.price}</div>
          <a href="${p.link}" target="_blank">View More</a>
        </div>
      </div>`
      )
      .join("");

    return `
      <div class="acumen-products">
        <h4>Related Products</h4>
        <button class="acumen-ps-btn prev">&#9664;</button>
        <div class="acumen-pstrip">${cards}</div>
        <button class="acumen-ps-btn next">&#9654;</button>
      </div>`;
  }

  /* ---------------- 打开弹窗 ---------------- */
  async function openLightboxById(mediaId) {
    const fallback = ITEM_CACHE.get(mediaId) || {};
    modalBody.innerHTML = `<div style="padding:20px;">Loading…</div>`;
    openModal();

    let detail = null;
    try {
      const r = await fetch(
        `${API_DETAIL}?media_id=${encodeURIComponent(mediaId)}`,
        { mode: "cors" }
      );
      if (r.ok) detail = await r.json();
    } catch {}

    const username = detail?.username || fallback.username || "";
    const caption = detail?.caption || fallback.caption || "";
    const permalink = detail?.permalink || fallback.permalink || "";

    await ensureProductMap();
    const productsHtml = productsHTML(fallback.products || [], PRODUCT_MAP);

    modalBody.innerHTML = `
      <div class="acumen-media">
        ${mediaHTML(detail, fallback)}
      </div>
      <div class="acumen-modal-right">
        ${productsHtml}
        <div class="ugc-caption">
          ${username ? `<p>@${username}</p>` : ""}
          <p>${caption}</p>
        </div>
        ${
          permalink
            ? `<a href="${permalink}" target="_blank">View original</a>`
            : ""
        }
      </div>
    `;

    const car = modalBody.querySelector(".acumen-carousel");
    if (car) bindCarouselEvents(car);
  }

  /* ---------------- Masonry 列表 ---------------- */
  class MasonryList {
    constructor(container, category, pageSize = 24) {
      this.container = container;
      this.category = category;
      this.pageSize = pageSize;

      this.offsetHashtag = 0;
      this.offsetTag = 0;
      this.totalHashtag = 0;
      this.totalTag = 0;

      if (!container) {
        console.warn("no category container:", category);
        this.disabled = true;
        return;
      }

      this.wrap = document.createElement("div");
      this.wrap.className = "ugc-masonry";

      this.loadMoreBtn = document.createElement("button");
      this.loadMoreBtn.className = "ugc-loadmore";
      this.loadMoreBtn.textContent = "Load more";

      this.loadMoreBtn.addEventListener("click", () => this.loadMore());

      container.innerHTML = "";
      container.appendChild(this.wrap);
      container.appendChild(this.loadMoreBtn);

      this.wrap.addEventListener("click", (e) => {
        const btn = e.target.closest(".ugc-open");
        if (!btn) return;
        const card = btn.closest(".ugc-card");
        const id = card?.dataset.id;
        if (id) openLightboxById(id);
      });
    }

    async fetchPage(offsetH, offsetT) {
      const sizeH = Math.ceil(this.pageSize / 2);
      const sizeT = this.pageSize - sizeH;

      const qsH = `category=${this.category}&limit=${sizeH}&offset=${offsetH}&noRefetch=1`;
      const qsT = `category=${this.category}&limit=${sizeT}&offset=${offsetT}&noRefetch=1`;

      const [r1, r2] = await Promise.allSettled([
        fetch(`${API_HASHTAG}?${qsH}`, { mode: "cors" }),
        fetch(`${API_TAG}?${qsT}`, { mode: "cors" }),
      ]);

      let hashtag = { media: [], total: 0 };
      let tag = { media: [], total: 0 };

      if (r1.status === "fulfilled" && r1.value.ok)
        hashtag = await r1.value.json();
      if (r2.status === "fulfilled" && r2.value.ok)
        tag = await r2.value.json();

      const merged = [...hashtag.media, ...tag.media].sort((a, b) =>
        (b.timestamp || "").localeCompare(a.timestamp || "")
      );

      return {
        media: merged,
        totalHashtag: hashtag.total,
        totalTag: tag.total,
        gotHashtag: hashtag.media.length,
        gotTag: tag.media.length,
      };
    }

    async loadMore() {
      if (this.disabled) return;

      const data = await this.fetchPage(this.offsetHashtag, this.offsetTag);
      const list = data.media;

      if (!list.length && this.offsetHashtag === 0 && this.offsetTag === 0) {
        const empty = document.createElement("div");
        empty.className = "ugc-empty";
        empty.textContent = "No posts yet.";
        this.wrap.appendChild(empty);
        this.loadMoreBtn.style.display = "none";
        return;
      }

      for (const item of list) this.appendItem(item);

      this.offsetHashtag += data.gotHashtag;
      this.offsetTag += data.gotTag;
      this.totalHashtag = data.totalHashtag;
      this.totalTag = data.totalTag;

      const done =
        this.offsetHashtag >= data.totalHashtag &&
        this.offsetTag >= data.totalTag;
      this.loadMoreBtn.style.display = done ? "none" : "block";
    }

    appendItem(item) {
      ITEM_CACHE.set(item.id, item);

      const card = document.createElement("div");

      const isCompact = Math.random() < 0.28;
      card.className = "ugc-card" + (isCompact ? " ugc-card--compact" : "");

      card.dataset.id = item.id;
      card.dataset.type = item.media_type;

      const mediaUrl = item.media_url || item.thumbnail_url || "";
      const isVideo =
        item.media_type === "VIDEO" && /\.mp4(\?|$)/i.test(mediaUrl);

      const mediaHtml = isVideo
        ? `
        <video class="ugc-media-wrap" autoplay muted playsinline loop>
          <source src="${mediaUrl}" type="video/mp4">
        </video>`
        : `<img class="ugc-media-wrap" src="${mediaUrl}">`;

      const author = item.username
        ? `<div class="ugc-caption" style="font-size:12px;color:#666;margin-top:-6px;">
             @${item.username}
           </div>`
        : "";

      card.innerHTML = `
        <button class="ugc-open">${mediaHtml}</button>
        ${
          item.caption
            ? `<div class="ugc-caption">${escapeHtml(
                item.caption.slice(0, 200)
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

  /* ---------------- 启动 ---------------- */
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
