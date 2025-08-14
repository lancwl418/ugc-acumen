(function () {
    /* ====================== 读取 API 基础域 ====================== */
    function getApiBase() {
      const me =
        document.currentScript ||
        document.getElementById("acumen-hashtag-ugc") ||
        document.querySelector('script[src*="hashtag-ugc-masonry"]');
      const base =
        (me && me.getAttribute("data-api-base")) ||
        "https://ugc.acumen-camera.com";
      return base.replace(/\/+$/, "");
    }
    const API_BASE = getApiBase();
    const HASHTAG_API = `${API_BASE}/api/hashtag-ugc`;
    const PRODUCTS_API = `${API_BASE}/api-products`;
  
    /* ====================== 样式（Masonry + 卡片 + Modal） ====================== */
    const style = document.createElement("style");
    style.innerHTML = `
      .acumen-masonry {
        column-count: 4;
        column-gap: 16px;
      }
      @media (max-width: 1280px) { .acumen-masonry { column-count: 3; } }
      @media (max-width: 1024px) { .acumen-masonry { column-count: 2; } }
      @media (max-width: 640px)  { .acumen-masonry { column-count: 1; } }
  
      .acumen-ugc-card {
        break-inside: avoid;
        background: #fff;
        border: 1px solid #eee;
        border-radius: 10px;
        margin: 0 0 16px;
        overflow: hidden;
        box-shadow: 0 2px 8px rgba(0,0,0,.05);
      }
  
      .acumen-ugc-thumb {
        width: 100%;
        background: #f7f7f7;
        position: relative;
        overflow: hidden;
      }
      .acumen-ugc-thumb img,
      .acumen-ugc-thumb video {
        width: 100%;
        height: auto;
        display: block;
        object-fit: cover;
      }
  
      .acumen-ugc-body {
        padding: 12px 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .acumen-ugc-caption {
        font-size: 14px;
        line-height: 1.5;
        color: #333;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .acumen-ugc-actions { display:flex; gap:12px; align-items:center; }
      .acumen-ugc-actions button,
      .acumen-ugc-actions a {
        font-size: 13px;
        color: #0a66c2;
        background: none;
        border: none;
        padding: 0;
        text-decoration: underline;
        cursor: pointer;
      }
  
      .acumen-loadmore-wrap { text-align:center; margin-top: 16px; }
      .acumen-loadmore-btn {
        padding: 10px 16px;
        border-radius: 6px;
        border: 1px solid #ddd;
        background: #fff;
        cursor: pointer;
        min-width: 160px;
      }
      .acumen-loadmore-btn[disabled] { opacity: .5; cursor: not-allowed; }
      .acumen-loadmore-btn:hover:not([disabled]) { background: #f6f6f6; }
  
      /* Modal */
      .acumen-modal {
        position: fixed; inset: 0;
        background: rgba(0,0,0,.5);
        display: flex; align-items: center; justify-content: center;
        z-index: 9999;
      }
      .acumen-modal-content {
        position: relative;
        background: #fff;
        border-radius: 10px;
        padding: 24px;
        display: flex; gap: 24px;
        max-width: 900px;
        width: calc(100% - 40px);
        max-height: 85vh; overflow-y: auto;
        box-shadow: 0 10px 30px rgba(0,0,0,.18);
      }
      .acumen-modal-media { width: 380px; max-width: 100%; }
      .acumen-modal-media img, .acumen-modal-media video {
        width: 100%;
        max-height: 520px;
        object-fit: contain;
        border-radius: 8px;
      }
      .acumen-modal-right { flex:1; display:flex; flex-direction:column; gap:12px; }
      .acumen-modal-close {
        position: absolute; top: 10px; right: 12px;
        font-size: 28px; font-weight: bold; color:#555; cursor:pointer; line-height:1;
      }
      .acumen-modal-close:hover { color: #d00; }
  
      .ugc-product-card {
        display:flex; align-items:center; gap:8px;
        border:1px solid #eee; border-radius:8px; padding:10px;
      }
      .ugc-product-card img {
        width: 64px; height:64px; object-fit:cover; border-radius:6px;
      }
      .ugc-product-card a {
        color:#0a66c2; font-size:13px; text-decoration: underline;
      }
    `;
    document.head.appendChild(style);
  
    /* ====================== 工具函数 ====================== */
    function $(sel, ctx = document) { return ctx.querySelector(sel); }
    function h(tag, attrs = {}, html = "") {
      const el = document.createElement(tag);
      Object.entries(attrs).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        if (k === "class") el.className = v;
        else el.setAttribute(k, v);
      });
      if (html) el.innerHTML = html;
      return el;
    }
  
    function showModal(item, productMap) {
      const modal = h("div", { class: "acumen-modal" });
      const productHTML =
        item.products && item.products.length
          ? item.products.map((handle) => {
              const p = productMap[handle];
              return p
                ? `<div class="ugc-product-card">
                     <img src="${p.image}" alt="${p.title}" />
                     <div>
                       <div style="font-weight:600;">${p.title}</div>
                       <div style="color:#d45a20;margin:2px 0;">$${p.price}</div>
                       <a href="${p.link}" target="_blank" rel="noreferrer">View More</a>
                     </div>
                   </div>`
                : "";
            }).join("")
          : "<p style='color:#666;'>No related products.</p>";
  
      modal.innerHTML = `
        <div class="acumen-modal-content">
          <span class="acumen-modal-close">&times;</span>
          <div class="acumen-modal-media">
            ${
              item.media_type === "VIDEO"
                ? `<video controls><source src="${item.media_url}" type="video/mp4" /></video>`
                : `<img src="${item.media_url}" alt="UGC media" />`
            }
          </div>
          <div class="acumen-modal-right">
            <h3 style="margin:0 0 4px;">Related Products</h3>
            ${productHTML}
            <p style="margin-top:8px;"><strong>@acumencamera</strong>: ${item.caption || "No caption."}</p>
            <a href="${item.permalink}" target="_blank" rel="noreferrer" style="color:#0a66c2;text-decoration:underline;">View original post</a>
          </div>
        </div>
      `;
      const close = () => modal.remove();
      modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
      $(".acumen-modal-close", modal)?.addEventListener("click", close);
      document.body.appendChild(modal);
    }
  
    /* ====================== 渲染单个 Masonry 容器（分页） ====================== */
    function bootMasonryContainer(container, productMap) {
      const category = (container.getAttribute("data-category") || "").trim();
      if (!category) return;
  
      const endpoint = container.getAttribute("data-endpoint") || HASHTAG_API;
      const productsEndpoint = container.getAttribute("data-products") || PRODUCTS_API;
      const initial = Number(container.getAttribute("data-initial") || 24);
      const step = Number(container.getAttribute("data-step") || 12);
  
      container.innerHTML = `
        <div class="acumen-masonry"></div>
        <div class="acumen-loadmore-wrap">
          <button class="acumen-loadmore-btn" type="button">Load more</button>
        </div>
      `;
      const grid = container.querySelector(".acumen-masonry");
      const loadBtn = container.querySelector(".acumen-loadmore-btn");
  
      let offset = 0;
      let total = Infinity;
      let isLoading = false;
  
      async function fetchPage(limit, off) {
        const url = new URL(endpoint);
        url.searchParams.set("category", category);
        url.searchParams.set("limit", String(limit));
        url.searchParams.set("offset", String(off));
        const res = await fetch(url.toString(), { credentials: "omit" });
        const ct = res.headers.get("content-type") || "";
        if (!res.ok || !ct.includes("application/json")) {
          const text = await res.text();
          throw new Error(`Fetch hashtag-ugc failed: ${res.status} ${text.slice(0,120)}`);
        }
        return res.json(); // { media, total }
      }
  
      function renderItems(items) {
        const html = items.map((item) => {
          const mediaHTML =
            item.media_type === "VIDEO"
              ? `<video muted playsinline loop><source src="${item.media_url}" type="video/mp4"></video>`
              : `<img src="${item.media_url}" alt="UGC media" loading="lazy" />`;
  
          return `
            <article class="acumen-ugc-card" data-id="${item.id}">
              <div class="acumen-ugc-thumb">${mediaHTML}</div>
              <div class="acumen-ugc-body">
                <div class="acumen-ugc-caption">${item.caption || ""}</div>
                <div class="acumen-ugc-actions">
                  <button class="acumen-view" type="button">View full post</button>
                  <a href="${item.permalink}" target="_blank" rel="noreferrer">Open on Instagram</a>
                </div>
              </div>
            </article>
          `;
        }).join("");
        grid.insertAdjacentHTML("beforeend", html);
  
        items.forEach((item) => {
          const card = grid.querySelector(`.acumen-ugc-card[data-id="${item.id}"]`);
          const view = card?.querySelector(".acumen-view");
          const thumb = card?.querySelector(".acumen-ugc-thumb");
          const open = () => showModal(item, productMap);
          view?.addEventListener("click", open);
          thumb?.addEventListener("click", open);
        });
      }
  
      async function loadMore(first = false) {
        if (isLoading) return;
        if (offset >= total) return;
  
        isLoading = true;
        loadBtn.disabled = true;
        loadBtn.textContent = "Loading...";
  
        const pageSize = first ? initial : step;
        try {
          const data = await fetchPage(pageSize, offset);
          const list = Array.isArray(data.media) ? data.media : [];
          total = typeof data.total === "number" ? data.total : total;
  
          renderItems(list);
          offset += list.length;
  
          if (offset >= total || list.length === 0) {
            loadBtn.disabled = true;
            loadBtn.textContent = "No more posts";
          } else {
            loadBtn.disabled = false;
            loadBtn.textContent = "Load more";
          }
        } catch (e) {
          console.error(`[Hashtag UGC] fetch error (${category}):`, e);
          loadBtn.disabled = false;
          loadBtn.textContent = "Retry";
        } finally {
          isLoading = false;
        }
      }
  
      loadBtn.addEventListener("click", () => loadMore(false));
      loadMore(true);
    }
  
    /* ====================== 启动：加载产品、初始化所有容器 ====================== */
    async function init() {
      let productMap = {};
      try {
        const res = await fetch(PRODUCTS_API);
        const ct = res.headers.get("content-type") || "";
        if (!res.ok || !ct.includes("application/json")) {
          const text = await res.text();
          throw new Error(`Unexpected response: ${res.status} ${text.slice(0,120)}`);
        }
        const data = await res.json();
        (data.products || []).forEach((p) => { productMap[p.handle] = p; });
      } catch (e) {
        console.warn("[Hashtag UGC] load products failed:", e);
      }
  
      document
        .querySelectorAll(".acumen-hashtag-ugc[data-category]")
        .forEach((el) => bootMasonryContainer(el, productMap));
    }
  
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  })();
  