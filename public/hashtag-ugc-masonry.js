/* public/hashtag-ugc-masonry.js */
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
  .igm__dlg{position:absolute;inset:5% 8%;background:#fff;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 10px 30px rgba(0,0,0,.18);max-height:90vh}
  .igm__x{position:absolute;top:10px;right:10px;font-size:24px;background:#fff;border:1px solid #eee;border-radius:50%;width:36px;height:36px;cursor:pointer}
  .igm__body{flex:1;display:flex;gap:24px;min-height:300px;padding:20px;overflow:hidden}
  .igm__media{flex:0 0 420px;align-self:flex-start}
  .igm__mediaBox{width:420px;height:420px;border-radius:8px;background:#f6f6f6;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center}
  .igm__mediaBox img,.igm__mediaBox video{width:100%;height:100%;object-fit:contain;display:block}

  /* carousel */
  .igm__carousel{position:relative;width:100%;height:100%}
  .igm__carousel-slide{position:absolute;inset:0;opacity:0;transition:opacity .25s ease}
  .igm__carousel-slide.is-active{opacity:1}
  .igm__carousel-btn{position:absolute;top:50%;transform:translateY(-50%);width:36px;height:36px;border-radius:50%;border:0;background:rgba(0,0,0,.5);color:#fff;cursor:pointer}
  .igm__carousel-btn.prev{left:8px}
  .igm__carousel-btn.next{right:8px}

  .igm__side{flex:1;min-width:0;display:flex;flex-direction:column;gap:16px;overflow:auto}
  .igm__products{position:relative}
  .igm__products-title{font-weight:600;font-size:20px;margin:0 0 8px}
  .igm__pstrip{display:flex;gap:12px;overflow:auto;scrollbar-width:none;padding-bottom:6px}
  .igm__pstrip::-webkit-scrollbar{display:none}
  .igm__pcard{min-width:260px;max-width:260px;display:flex;gap:10px;border:1px solid #eee;border-radius:10px;padding:12px;align-items:flex-start;background:#fff}
  .igm__pcard img{width:64px;height:64px;object-fit:cover;border-radius:6px}
  .igm__pcard-title{font-size:14px;line-height:1.35;margin:0 0 4px}
  .igm__pcard-price{color:#d45a20;font-weight:600;font-size:14px;margin:0 0 4px}
  .igm__plink{font-size:12px;text-decoration:underline;color:#2563eb}
  .igm__ps-btn{position:absolute;top:28px;transform:translateY(-50%);width:30px;height:30px;border-radius:50%;border:0;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.1);cursor:pointer}
  .igm__ps-btn.prev{left:-8px}
  .igm__ps-btn.next{right:-8px}

  .igm__caption{font-size:14px;line-height:1.6;color:#333;white-space:pre-wrap}
  .igm__author{font-weight:600;margin-right:6px}
  .igm__original a{font-size:14px;color:#2563eb;text-decoration:underline}
  `;
  const style = document.createElement("style");
  style.innerHTML = css;
  document.head.appendChild(style);

  /* ---------------- Modal DOM ---------------- */
  const modal = document.createElement("div");
  modal.id = "ig-modal";
  modal.className = "igm";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="igm__bg" data-close></div>
    <div class="igm__dlg" role="dialog" aria-modal="true">
      <button class="igm__x" type="button" data-close>&times;</button>
      <div id="ig-modal-body" class="igm__body"></div>
    </div>`;
  document.body.appendChild(modal);
  const modalBody = modal.querySelector("#ig-modal-body");
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

  /* ---------------- Rich Modal Rendering ---------------- */
  function renderCarousel(children = []) {
    const slides = children
      .map((c, i) => {
        const url = c.media_url || c.thumbnail_url || "";
        const isVid = c.media_type === "VIDEO" && /\.mp4(\?|$)/i.test(url);
        if (isVid) {
          return `<div class="igm__carousel-slide ${i === 0 ? "is-active" : ""}">
            <video autoplay muted playsinline controls preload="metadata" class="w-full h-full">
              <source src="${url}" type="video/mp4" />
            </video>
          </div>`;
        }
        return `<div class="igm__carousel-slide ${i === 0 ? "is-active" : ""}">
          <img src="${url}" alt="" />
        </div>`;
      })
      .join("");

    return `
      <div class="igm__mediaBox">
        <div class="igm__carousel">
          ${slides}
          ${children.length > 1 ? `
            <button class="igm__carousel-btn prev" type="button" aria-label="Prev">&#9664;</button>
            <button class="igm__carousel-btn next" type="button" aria-label="Next">&#9654;</button>
          ` : ""}
        </div>
      </div>`;
  }

  function bindCarouselEvents(box) {
    const slides = Array.from(box.querySelectorAll(".igm__carousel-slide"));
    if (slides.length <= 1) return;
    let idx = slides.findIndex(s => s.classList.contains("is-active"));
    const go = (d) => {
      slides[idx].classList.remove("is-active");
      idx = (idx + d + slides.length) % slides.length;
      slides[idx].classList.add("is-active");
    };
    box.querySelector(".igm__carousel-btn.prev")?.addEventListener("click", () => go(-1));
    box.querySelector(".igm__carousel-btn.next")?.addEventListener("click", () => go(+1));
  }

  function renderSingleMedia(detailOrItem) {
    const url = detailOrItem.media_url || detailOrItem.thumbnail_url || "";
    const isVideo = (detailOrItem.media_type === "VIDEO") && /\.mp4(\?|$)/i.test(url);
    if (isVideo) {
      return `
        <div class="igm__mediaBox">
          <video muted playsinline autoplay controls preload="metadata">
            <source src="${url}" type="video/mp4" />
          </video>
        </div>`;
    }
    return `
      <div class="igm__mediaBox">
        <img src="${url}" alt="" />
      </div>`;
  }

  function mediaHTML(detail, fallback) {
    // 1) 有 children 时按轮播（优先 detail.children）
    const children =
      detail?.children?.data?.length ? detail.children.data :
      (fallback?.children?.data?.length ? fallback.children.data : null);

    if (children && children.length) return renderCarousel(children);

    // 2) 单媒体（detail 优先）
    if (detail && (detail.media_url || detail.thumbnail_url)) return renderSingleMedia(detail);
    if (fallback && (fallback.media_url || fallback.thumbnail_url)) return renderSingleMedia(fallback);

    // 3) oEmbed 兜底的缩略图由上层逻辑再尝试，这里先空
    return `<div class="igm__mediaBox"></div>`;
  }

  function productsHTML(handles = [], productMap = {}) {
    const items = (handles || [])
      .map(h => productMap[h])
      .filter(Boolean);
    if (!items.length) return "";

    const cards = items.map(p => `
      <div class="igm__pcard">
        <img src="${p.image}" alt="${escapeHtml(p.title)}" />
        <div>
          <div class="igm__pcard-title">${escapeHtml(p.title)}</div>
          ${p.price ? `<div class="igm__pcard-price">$${p.price}</div>` : ""}
          <a class="igm__plink" href="${p.link}" target="_blank" rel="noopener">View More</a>
        </div>
      </div>
    `).join("");

    return `
      <div class="igm__products">
        <h3 class="igm__products-title">Related Products</h3>
        <button class="igm__ps-btn prev" type="button" aria-label="Prev">&#9664;</button>
        <div class="igm__pstrip">${cards}</div>
        <button class="igm__ps-btn next" type="button" aria-label="Next">&#9654;</button>
      </div>`;
  }

  function bindProductsStrip(root) {
    const strip = root.querySelector(".igm__pstrip");
    if (!strip) return;
    const prev = root.querySelector(".igm__ps-btn.prev");
    const next = root.querySelector(".igm__ps-btn.next");
    const step = 280; // 一张卡的宽度+间距
    prev?.addEventListener("click", () => strip.scrollBy({ left: -step, behavior: "smooth" }));
    next?.addEventListener("click", () => strip.scrollBy({ left: step, behavior: "smooth" }));
  }

  // 弹窗三层兜底（并渲染富 UI）
  async function openLightboxById(mediaId) {
    const adminFallback = ITEM_CACHE.get(mediaId) || {};
    let detail = null;

    modalBody.innerHTML = '<div style="padding:40px;color:#999">Loading…</div>';
    openModal();

    // A) 详细接口（Graph 优先）
    try {
      const r = await fetch(`${API_DETAIL}?media_id=${encodeURIComponent(mediaId)}`, { mode: "cors" });
      if (r.ok) detail = await r.json();
    } catch {}

    // 若 detail 和 fallback 都没任何媒体，再尝试 oEmbed 照片缩略图
    if (!detail && !adminFallback) {
      modalBody.innerHTML = `<div style="padding:40px">No media available.</div>`;
      return;
    }

    // 准备渲染的数据
    const username = detail?.username || adminFallback.username || "";
    const caption  = detail?.caption  || adminFallback.caption  || "";
    const permalink = detail?.permalink || adminFallback.permalink || "";

    // 商品数据（handles）
    await ensureProductMap();
    const productsHTMLStr = productsHTML(adminFallback.products || [], PRODUCT_MAP);

    // 媒体 HTML（carousel/single/video）
    let mediaBoxHTML = mediaHTML(detail, adminFallback);

    // 如果两者都没图，再试 oEmbed 缩略图
    if (mediaBoxHTML.includes('igm__mediaBox"></div>') && permalink) {
      try {
        const r = await fetch(`${API_OEMBED}?url=${encodeURIComponent(permalink)}`, { mode: "cors" });
        if (r.ok) {
          const e = await r.json();
          if (e.html && /<video/i.test(e.html)) {
            // 直接用 embed（遮罩避免点透）
            mediaBoxHTML = `
              <div class="igm__mediaBox">
                <div class="igm__carousel">
                  <div class="igm__carousel-slide is-active">
                    ${e.html}
                  </div>
                </div>
              </div>`;
            ensureEmbedJs();
          } else if (e.thumbnail_url) {
            mediaBoxHTML = `
              <div class="igm__mediaBox">
                <img src="${e.thumbnail_url}" alt="">
              </div>`;
          }
        }
      } catch {}
    }

    // 渲染整体布局
    modalBody.innerHTML = `
      <div class="igm__media">
        ${mediaBoxHTML}
      </div>
      <div class="igm__side">
        ${productsHTMLStr || ""}
        <div class="igm__caption">
          ${username ? `<span class="igm__author">@${escapeHtml(username)}</span>` : ""}
          ${escapeHtml(caption || "No caption.")}
        </div>
        <div class="igm__original">
          ${permalink ? `<a href="${permalink}" target="_blank" rel="noopener">View original post</a>` : ""}
        </div>
      </div>
    `;

    // 绑定交互
    const car = modalBody.querySelector(".igm__carousel");
    if (car) bindCarouselEvents(car);
    const pro = modalBody.querySelector(".igm__products");
    if (pro) bindProductsStrip(pro);
  }

  /* ---------------- Masonry ---------------- */
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
          <video class="ugc-media-wrap" controls autoplay muted playsinline loop preload="metadata">
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
