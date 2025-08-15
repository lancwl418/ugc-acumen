// public/js/hashtag-ugc-masonry.js
const API_BASE = "https://ugc.acumen-camera.com";
const API_HASHTAG = `${API_BASE}/api-hashtag-ugc`; // ✅ 连字符

let offset = 0;
const limit = 6; // 每次加载数量
let loading = false;
let finished = false;

async function fetchHashtagUGC(category) {
  if (loading || finished) return;
  loading = true;

  try {
    const url = `${API_HASHTAG}?category=${encodeURIComponent(category)}&limit=${limit}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data.media || data.media.length === 0) {
      finished = true;
      return;
    }

    renderUGC(data.media);
    offset += data.media.length;

    if (offset >= data.total) {
      finished = true;
    }
  } catch (err) {
    console.error("Error fetching hashtag UGC:", err);
  } finally {
    loading = false;
  }
}

function renderUGC(items) {
  const container = document.getElementById("ugc-container");
  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "ugc-card";
    card.innerHTML = `
      <a href="${item.permalink}" target="_blank" rel="noopener">
        <img src="${item.media_url}" alt="${item.caption || ""}" loading="lazy" />
      </a>
      <p>${item.caption || ""}</p>
    `;
    container.appendChild(card);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const category = document.body.dataset.ugcCategory || "camping";
  fetchHashtagUGC(category);

  const loadMoreBtn = document.getElementById("ugc-load-more");
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", () => {
      fetchHashtagUGC(category);
    });
  }
});
