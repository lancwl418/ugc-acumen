/**
 * Hashtag UGC Masonry (no deps)
 * - 容器匹配：页面上的 [data-ugc-cat="<category>"] 容器
 * - API：
 *    GET  {API_BASE}/api.hashtag-ugc?category=camping&limit=24&offset=0
 *    GET  {API_BASE}/api-products
 *    GET  {API_BASE}/api/ig-media?id=<media_id>   // 代理媒体，避免 403
 */
(function () {
  const SCRIPT = document.getElementById("acumen-hashtag-ugc");
  const API_BASE =
    (SCRIPT && SCRIPT.getAttribute("data-api-base")) ||
    "https://ugc.acumen-camera.com";
  const PAGE_SIZE = Number(SCRIPT?.getAttribute("data-limit") || 24);

  // --- 样式 ---
  const style = document.createElement("style");
  style.innerHTML = `
    /* 容器（每个分类一个容器） */
    .acumen-ugc-grid {
      column-gap: 16px;
    }
    /* 响应式列数 */
    @media (min-width: 320px)  { .acumen-ugc-grid { column-count: 1; } }
    @media (min-width: 576px)  { .acumen-ugc-grid { column-count: 2; } }
    @media (min-width: 992px)  { .acumen-ugc-grid { column-count: 3; } }
    @media (min-width: 1280px) { .acumen-ugc-grid { column-count: 4; } }

    /* 卡片：避免 column 内断裂 */
    .acumen-ugc-card {
      break-inside: avoid;
      -webkit-column-break-inside: avoid;
      margin: 0 0 16px;
      display: block;
      border-radius: 8px;
      overflow: hidden;
      background: #fff;
      box-shadow: 0 1px 6px rgba(0,0,0,.06);
    }
    .acumen-ugc-card a {
      display: block;
      text-decoration: none;
      color: inherit;
    }
    .acumen-ugc-card img,
    .acumen-ugc-card video {
      width: 100%;
      height: auto;
      display: block;
    }
    .acumen-ugc-card .caption {
      padding: 10px 12px;
      font-size: 13px;
      line-height: 1.5;
      color: #333;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Load More */
    .acumen-ugc-loadmore {
      display: flex;
      justify-content: center;
      margin: 14px 0 24px;
    }
    .acumen-ugc-btn {
      border: 1px solid #222;
      background: #fff;
      color: #222;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      transition: .2s ease;
    }
    .acumen-ugc-btn[disabled] {
      cursor: not-allowed;
      opacity: .5;
    }
    .acumen-ugc-btn:hover:not([disabled]) {
      background: #222;
      color: #fff;
    }

    /* Modal */
    .acumen-modal {
      position: fixed; inset: 0; z-index: 9999;
      display: none; align-items: center; justify-content: center;
      background: rgba(0,0,0,.5);
      padding: 20px;
    }
    .acumen-modal.show { display: flex; }
    .acumen-modal-content {
      background: #fff; border-radius: 10px; width: min(980px, 96vw);
      max-height: 86vh; overflow: auto; padding: 16px;
      display: grid; gap: 16px; grid-template-columns: 1fr 1fr;
    }
    @media (max-width: 768px) {
      .acumen-modal-content { grid-template-columns: 1fr; }
    }
    .acumen-modal-close {
      position: absolute; top: 10px; right: 16px;
      font-size: 28px; font-weight: 700; cursor: pointer;
      color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,.5);
    }
    .acumen-modal-media img, .acumen-modal-media video {
      width: 100%; max-height: 70vh; object-fit: contain; background:#000;
      border-radius: 8px;
    }
    .ugc-product-card {
      display: flex; gap: 10px; align-items: center;
      padding: 8px; border: 1px solid #eee; border-radius: 6px; margin-bottom: 8px;
    }
    .ugc-product-card img { width: 64px; height: 64px; object-fit: cover; border-radius: 4px; }
    .ugc-product-card a { color: #0a58ca; text-decoration: underline; font-size: 13px; }
    .acumen-modal-right .caption { white-space: pre-wrap; }
  `;
  document.head.appendChild(style);

  // --- 工具 ---
  const qsa = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const escapeHtml = (s = "") =>
    s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

  /** 把媒体 ID 转为代理地址，彻底避免 403 */
  const mediaSrc = (item) =>
    `${API_BASE}/api/ig-media?id=${encodeURIComponent(item.id)}`;

  // --- 产品数据 ---
  let productMap = {};
  fetch(`${API_BASE}/api-products`)
    .then((r) => r.json())
    .then((data) => {
      (data.products || []).forEach((p) => (productMap[p.handle] = p));
    })
    .catch((e) => console.warn("[Hashtag UGC] load products failed:", e));

  // --- UI: Modal ---
  let modal;
  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "acumen-modal";
    modal.innerHTML = `
      <div class="acumen-modal-close">&times;</div>
      <div class="acumen-modal-content">
        <div class="acumen-modal-media"></div>
        <div class="acumen-modal-right">
          <h4>Related Products</h4>
          <div class="acumen-modal-products"></div>
          <p class="caption"></p>
          <a class="origin" target="_blank" style="color:#0a58ca;text-decoration:underline;">View original post</a>
        </div>
      </div>`;
    modal.addEventListener("click", (e) => {
      if (e.target === modal || e.target.classList.contains("acumen-modal-close")) {
        modal.classList.remove("show");
      }
    });
    document.body.appendChild(modal);
    return modal;
  }

  function openModal(item) {
    const m = ensureModal();
    const media = m.querySelector(".acumen-modal-media");
    const products = m.querySelector(".acumen-modal-products");
    const caption = m.querySelector(".caption");
    const origin = m.querySelector(".origin");

    media.innerHTML =
      item.media_type === "VIDEO"
        ? `<video controls playsinline><source src="${mediaSrc(item)}" type="video/mp4" /></video>`
        : `<img src="${mediaSrc(item)}" alt="ugc detail" />`;

    const html = (item.products || [])
      .map((h) => {
        const p = productMap[h];
        return p
          ? `<div class="ugc-product-card">
               <img src="${p.image}" alt="${escapeHtml(p.title)}" />
               <div>
                 <div style="font-size:14px;margin-bottom:2px;">${escapeHtml(p.title)}</div>
                 <div style="color:#d45a20;margin-bottom:4px;">$${p.price}</div>
                 <a href="${p.link}" target="_blank">View more</a>
               </div>
             </div>`
          : "";
      })
      .join("");
    products.innerHTML = html || "<p style='font-size:13px;color:#666;'>No related products.</p>";

    caption.textContent = item.caption || "";
    origin.href = item.permalink;

    m.classList.add("show");
  }

  // --- 生成卡片 ---
  function cardHTML(item) {
    const isVideo = item.media_type === "VIDEO";
    return `
      <div class="acumen-ugc-card" data-id="${item.id}">
        <a href="javascript:void(0)" class="ugc-open">
          ${
            isVideo
              ? `<video muted playsinline preload="metadata"><source src="${mediaSrc(item)}" type="video/mp4" /></video>`
              : `<img src="${mediaSrc(item)}" alt="ugc" loading="lazy" />`
          }
        </a>
        ${
          item.caption
            ? `<div class="caption">${escapeHtml(item.caption)}</div>`
            : ""
        }
      </div>
    `;
  }

  function bindCardEvents(container, itemsById) {
    qsa(".ugc-open", container).forEach((a) => {
      a.addEventListener("click", () => {
        const card = a.closest(".acumen-ugc-card");
        const id = card?.getAttribute("data-id");
        if (id && itemsById[id]) openModal(itemsById[id]);
      });
    });
  }

  // --- 分页加载 ---
  class UGCList {
    constructor(category, host) {
      this.category = category;
      this.host = host;
      this.grid = document.createElement("div");
      this.grid.className = "acumen-ugc-grid";
      this.host.appendChild(this.grid);

      this.btnWrap = document.createElement("div");
      this.btnWrap.className = "acumen-ugc-loadmore";
      this.btnWrap.innerHTML = `<button class="acumen-ugc-btn">Load more</button>`;
      this.host.appendChild(this.btnWrap);
      this.btn = this.btnWrap.querySelector("button");

      this.offset = 0;
      this.total = 0;
      this.loading = false;
      this.itemsById = {};

      this.btn.addEventListener("click", () => this.loadMore());
      // 首屏
      this.loadMore(true);
    }

    async fetchPage() {
      const url = new URL(`${API_BASE}/api.hashtag-ugc`);
      url.searchParams.set("category", this.category);
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("offset", String(this.offset));

      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }

    async loadMore(first = false) {
      if (this.loading) return;
      this.loading = true;
      this.btn.disabled = true;
      this.btn.textContent = "Loading...";

      try {
        const data = await this.fetchPage();
        const list = data.media || [];
        this.total = Number(data.total || 0);

        // 渲染
        const html = list.map((it) => {
          this.itemsById[it.id] = it;
          return cardHTML(it);
        }).join("");
        const frag = document.createElement("div");
        frag.innerHTML = html;
        // 将 frag 里的子元素 append 到 grid（减少回流）
        while (frag.firstChild) this.grid.appendChild(frag.firstChild);

        bindCardEvents(this.grid, this.itemsById);

        this.offset += list.length;
        if (this.offset >= this.total || list.length < PAGE_SIZE) {
          this.btnWrap.style.display = "none";
        } else {
          this.btnWrap.style.display = "flex";
          this.btn.disabled = false;
          this.btn.textContent = "Load more";
        }
      } catch (e) {
        console.error(`[Hashtag UGC] fetch error (${this.category}):`, e);
        this.btn.disabled = false;
        this.btn.textContent = "Retry";
      } finally {
        this.loading = false;
      }
    }
  }

  // --- 启动：找到页面上的每个分类容器 ---
  const SUPPORTED = new Set([
    "camping",
    "off-road",
    "electronic",
    "travel",
    "documentation",
    "events",
  ]);

  const hosts = qsa("[data-ugc-cat]").filter((el) =>
    SUPPORTED.has(el.getAttribute("data-ugc-cat"))
  );

  if (!hosts.length) {
    console.warn(
      "[Hashtag UGC] no containers found. Add elements like <div data-ugc-cat=\"camping\"></div>"
    );
    return;
  }

  hosts.forEach((host) => {
    const cat = host.getAttribute("data-ugc-cat");
    new UGCList(cat, host);
  });

  console.log("AVADA Joy has initialized");
})();
