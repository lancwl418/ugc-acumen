// public/hashtag-ugc-masonry.js
(function () {
  const STYLE = `
  .acumen-ugc-masonry {
    column-count: 3;
    column-gap: 16px;
  }
  @media (max-width: 1200px) { .acumen-ugc-masonry { column-count: 2; } }
  @media (max-width: 768px)  { .acumen-ugc-masonry { column-count: 1; } }

  .acumen-ugc-card {
    break-inside: avoid;
    margin-bottom: 16px;
    border-radius: 8px;
    overflow: hidden;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,.08);
    border: 1px solid #eee;
  }
  .acumen-ugc-card a { display:block; color:inherit; text-decoration:none; }
  .acumen-ugc-media { width:100%; height:auto; display:block; }
  .acumen-ugc-caption {
    padding: 10px 12px;
    font-size: 14px;
    color: #333;
  }
  .acumen-ugc-meta {
    padding: 10px 12px 12px;
    display:flex; justify-content:space-between; align-items:center;
    font-size:12px; color:#666;
  }
  .acumen-ugc-badge {
    display:inline-block; padding:2px 6px; border-radius: 999px; background:#f3f4f6;
    font-size:11px; color:#444;
  }
  .acumen-ugc-loadmore {
    display:block; margin: 16px auto 0; padding:10px 16px;
    border:1px solid #ddd; background:#fff; border-radius:6px;
    cursor:pointer; font-size:14px;
  }
  .acumen-ugc-loadmore[disabled] { opacity:.6; cursor:not-allowed; }
  `;

  function injectStyle(css) {
    const el = document.createElement("style");
    el.textContent = css;
    document.head.appendChild(el);
  }

  function getScriptConfig() {
    const script = document.getElementById("acumen-hashtag-ugc");
    const apiBase =
      (script && script.getAttribute("data-api-base")) ||
      "https://ugc.acumen-camera.com";
    return { apiBase };
  }

  async function fetchPage(apiBase, category, limit, offset) {
    // ✅ 路径使用 “点” 路由
    const url =
      `${apiBase}/api-hashtag-ugc?category=${encodeURIComponent(category)}&limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function createCard(item) {
    const mediaSrc = item.media_type === "VIDEO"
      ? item.thumbnail_url || item.media_url
      : item.media_url;

    const wrapper = document.createElement("div");
    wrapper.className = "acumen-ugc-card";

    const a = document.createElement("a");
    a.href = item.permalink;
    a.target = "_blank";
    a.rel = "noopener noreferrer";

    if (item.media_type === "VIDEO") {
      const img = document.createElement("img");
      img.className = "acumen-ugc-media";
      img.src = mediaSrc;
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      a.appendChild(img);
    } else {
      const img = document.createElement("img");
      img.className = "acumen-ugc-media";
      img.src = mediaSrc;
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      a.appendChild(img);
    }

    wrapper.appendChild(a);

    const caption = document.createElement("div");
    caption.className = "acumen-ugc-caption";
    caption.textContent = item.caption || "No caption.";
    wrapper.appendChild(caption);

    const meta = document.createElement("div");
    meta.className = "acumen-ugc-meta";
    meta.innerHTML = `
      <span class="acumen-ugc-badge">${item.media_type}</span>
      <span>${(item.timestamp || "").slice(0, 10)}</span>
    `;
    wrapper.appendChild(meta);

    return wrapper;
  }

  function MasonryList(root, apiBase, category) {
    this.root = root;
    this.apiBase = apiBase;
    this.category = category;
    this.limit = 24;
    this.offset = 0;
    this.loading = false;
    this.total = 0;

    this.listEl = document.createElement("div");
    this.listEl.className = "acumen-ugc-masonry";
    root.appendChild(this.listEl);

    this.moreBtn = document.createElement("button");
    this.moreBtn.className = "acumen-ugc-loadmore";
    this.moreBtn.textContent = "Load more";
    this.moreBtn.addEventListener("click", () => this.loadMore());
    root.appendChild(this.moreBtn);
  }

  MasonryList.prototype.loadMore = async function () {
    if (this.loading) return;
    this.loading = true;
    this.moreBtn.disabled = true;
    this.moreBtn.textContent = "Loading...";

    try {
      const { media, total } = await fetchPage(
        this.apiBase,
        this.category,
        this.limit,
        this.offset
      );
      this.total = total || this.total;

      (media || []).forEach((item) => {
        this.listEl.appendChild(createCard(item));
      });

      this.offset += this.limit;

      if (this.offset >= this.total || (media || []).length < this.limit) {
        this.moreBtn.style.display = "none";
      } else {
        this.moreBtn.disabled = false;
        this.moreBtn.textContent = "Load more";
      }
    } catch (e) {
      console.error(`[Hashtag UGC] fetch error (${this.category}):`, e);
      this.moreBtn.disabled = false;
      this.moreBtn.textContent = "Retry";
    } finally {
      this.loading = false;
    }
  };

  function boot() {
    injectStyle(STYLE);
    const { apiBase } = getScriptConfig();

    const idByCategory = {
      camping: "acumen-hashtag-ugc-camping",
      "off-road": "acumen-hashtag-ugc-offroad",
      electronic: "acumen-hashtag-ugc-electronic",
      travel: "acumen-hashtag-ugc-travel",
      documentation: "acumen-hashtag-ugc-documentation",
      events: "acumen-hashtag-ugc-events",
    };

    Object.entries(idByCategory).forEach(([cat, id]) => {
      const root = document.getElementById(id);
      if (!root) return;
      const m = new MasonryList(root, apiBase, cat);
      m.loadMore(); // 首屏
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
