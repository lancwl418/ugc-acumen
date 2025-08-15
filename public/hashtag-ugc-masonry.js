/* public/hashtag-ugc-masonry.js */
(function () {
  // 允许在 script 标签上自定义 API 基础域
  const SCRIPT = document.currentScript || document.getElementById("acumen-hashtag-ugc");
  const API_BASE =
    (SCRIPT && SCRIPT.getAttribute("data-api-base")) ||
    "https://ugc.acumen-camera.com";

  // 最终请求的接口（注意：这里是 api-hashtag-ugc，有连字符）
  const API_HASHTAG = `${API_BASE}/api-hashtag-ugc`;

  // 页面上每个分类对应的容器（存在才渲染，不存在就忽略，避免 appendChild on null）
  const TARGETS = {
    camping: document.querySelector("#ugc-camping"),
    "off-road": document.querySelector("#ugc-off-road"),
    electronic: document.querySelector("#ugc-electronic"),
    travel: document.querySelector("#ugc-travel"),
    documentation: document.querySelector("#ugc-documentation"),
    events: document.querySelector("#ugc-events"),
  };

  // 样式
  const css = `
  .ugc-masonry {
    column-count: 1;
    column-gap: 16px;
  }
  @media (min-width: 640px) { .ugc-masonry { column-count: 2; } }
  @media (min-width: 1024px){ .ugc-masonry { column-count: 3; } }
  .ugc-card {
    break-inside: avoid;
    margin-bottom: 16px;
    border-radius: 8px;
    overflow: hidden;
    background: #fff;
    box-shadow: 0 2px 8px rgba(0,0,0,.06);
  }
  .ugc-card a { color: inherit; text-decoration: none; }
  .ugc-media-wrap { width: 100%; display: block; background:#f6f6f6; }
  .ugc-media-wrap img, .ugc-media-wrap video {
    width: 100%; height: auto; display: block;
  }
  .ugc-caption { padding: 12px; font-size: 14px; line-height: 1.5; color:#333; }
  .ugc-loadmore { margin: 16px auto 0; display:block; padding:10px 16px; border:1px solid #ddd; background:#fff; border-radius:6px; cursor:pointer; }
  .ugc-empty { color:#999; font-size:14px; padding:16px 0; text-align:center; }
  `;
  const style = document.createElement("style");
  style.innerHTML = css;
  document.head.appendChild(style);

  // —— Masonry 组件 —— //
  class MasonryList {
    constructor(container, category, pageSize = 24) {
      this.container = container;
      this.category = category;
      this.pageSize = pageSize;
      this.offset = 0;
      this.total = 0;

      // 防御：容器不存在就直接结束
      if (!this.container) {
        console.warn(`[Hashtag UGC] container for "${category}" not found, skip.`);
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
    }

    async loadMore() {
      if (this.disabled) return;

      try {
        const data = await this.fetchPage(this.offset);
        if (!data) return;

        const list = data.media || [];
        const failed = data.failed || [];
        this.total = data.total || this.total;

        // 打点查看哪些 id 拉取失败（不会影响渲染）
        if (failed.length) {
          console.info(`[Hashtag UGC] ${this.category} failed:`, failed);
        }

        // 没有任何可渲染的媒体
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

        // 渲染条目
        for (const item of list) {
          this.appendItem(item);
        }

        this.offset += list.length;

        // 没有更多了
        if (this.offset >= this.total) {
          this.loadMoreBtn.style.display = "none";
        } else {
          this.loadMoreBtn.style.display = "inline-block";
        }
      } catch (err) {
        console.error(`[Hashtag UGC] fetch error (${this.category}):`, err);
      }
    }

    async fetchPage(offset) {
      const url = `${API_HASHTAG}?category=${encodeURIComponent(
        this.category
      )}&limit=${this.pageSize}&offset=${offset}`;

      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
    }

    appendItem(item) {
      // 容器在异步阶段被移除？保护一下
      if (!this.wrap) return;

      const card = document.createElement("div");
      card.className = "ugc-card";

      const href = item.permalink || "#";
      const mediaUrl =
        item.media_url || item.thumbnail_url || ""; // 后端已做 fallback，这里再兜底

      // 没有媒体地址就跳过该条
      if (!mediaUrl) return;

      const mediaHtml =
        item.media_type === "VIDEO"
          ? `<video controls muted playsinline preload="metadata" class="ugc-media-wrap">
               <source src="${mediaUrl}" type="video/mp4">
             </video>`
          : `<img class="ugc-media-wrap" src="${mediaUrl}" alt="">`;

      card.innerHTML = `
        <a href="${href}" target="_blank" rel="noopener">
          ${mediaHtml}
        </a>
        ${
          item.caption
            ? `<div class="ugc-caption">${escapeHtml(
                item.caption.slice(0, 200)
              )}</div>`
            : ""
        }
      `;

      this.wrap.appendChild(card);
    }
  }

  // 简单转义（避免 caption 里有 < >）
  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  // 初始化所有存在的分类容器
  function boot() {
    const categories = Object.keys(TARGETS);
    categories.forEach((cat) => {
      const el = TARGETS[cat];
      if (!el) return; // 页面没有该 tab 容器就忽略

      const ms = new MasonryList(el, cat, 24);
      ms.loadMore();
    });
  }

  // DOM 就绪后再跑
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
