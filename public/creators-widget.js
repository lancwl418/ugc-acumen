(function () {
  const BASE = "https://ugc.acumen-camera.com";

  const style = document.createElement("style");
  style.innerHTML = `
    .acumen-creators-widget {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem 1rem;
    }

    /* === Creator avatar row === */
    .acumen-creators-row {
      display: flex;
      gap: 20px;
      overflow-x: auto;
      padding: 8px 4px 16px;
      scrollbar-width: thin;
      -webkit-overflow-scrolling: touch;
    }
    .acumen-creators-row::-webkit-scrollbar {
      height: 4px;
    }
    .acumen-creators-row::-webkit-scrollbar-thumb {
      background: #ccc;
      border-radius: 4px;
    }

    .acumen-creator-chip {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      flex-shrink: 0;
      transition: transform 0.2s;
    }
    .acumen-creator-chip:hover {
      transform: translateY(-2px);
    }
    .acumen-creator-chip.active .acumen-creator-avatar {
      border-color: #333;
      box-shadow: 0 0 0 2px #333;
    }
    .acumen-creator-avatar {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      object-fit: cover;
      border: 3px solid transparent;
      transition: border-color 0.2s, box-shadow 0.2s;
      background: #f0f0f0;
    }
    .acumen-creator-avatar-placeholder {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      border: 3px solid transparent;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 22px;
      font-weight: 700;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .acumen-creator-chip.active .acumen-creator-avatar-placeholder {
      border-color: #333;
      box-shadow: 0 0 0 2px #333;
    }
    .acumen-creator-name {
      font-size: 12px;
      color: #555;
      max-width: 80px;
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .acumen-creator-chip.active .acumen-creator-name {
      color: #111;
      font-weight: 600;
    }

    /* === UGC grid === */
    .acumen-ugc-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
      margin-top: 24px;
    }

    .acumen-ugc-card {
      border-radius: 12px;
      overflow: hidden;
      background: #fff;
      border: 1px solid #eee;
      cursor: pointer;
      transition: box-shadow 0.2s, transform 0.15s;
    }
    .acumen-ugc-card:hover {
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
      transform: translateY(-2px);
    }
    .acumen-ugc-card-media {
      width: 100%;
      height: 280px;
      overflow: hidden;
      position: relative;
    }
    .acumen-ugc-card-media img,
    .acumen-ugc-card-media video {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .acumen-ugc-card-media .video-badge {
      position: absolute;
      top: 8px;
      right: 8px;
      background: rgba(0,0,0,0.6);
      color: #fff;
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 4px;
    }
    .acumen-ugc-card-info {
      padding: 12px 14px;
    }
    .acumen-ugc-card-info .acumen-ugc-caption {
      font-size: 13px;
      line-height: 1.5;
      color: #333;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      margin: 0 0 8px;
    }
    .acumen-ugc-card-stats {
      display: flex;
      gap: 12px;
      font-size: 12px;
      color: #888;
    }

    /* === Loading / empty === */
    .acumen-loading {
      text-align: center;
      padding: 40px;
      color: #999;
      font-size: 14px;
    }

    /* === Modal === */
    .acumen-creators-modal {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.6);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 9999;
      padding: 20px;
    }
    .acumen-creators-modal-content {
      position: relative;
      background: #fff;
      border-radius: 12px;
      display: flex;
      max-width: 900px;
      max-height: 85vh;
      overflow: hidden;
      width: 100%;
    }
    .acumen-creators-modal-media {
      flex: 1;
      min-width: 0;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .acumen-creators-modal-media img,
    .acumen-creators-modal-media video {
      max-width: 100%;
      max-height: 85vh;
      object-fit: contain;
    }
    .acumen-creators-modal-right {
      width: 300px;
      flex-shrink: 0;
      padding: 24px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .acumen-creators-modal-close {
      position: absolute;
      top: 8px;
      right: 12px;
      font-size: 28px;
      font-weight: bold;
      color: #fff;
      cursor: pointer;
      z-index: 10;
      text-shadow: 0 1px 3px rgba(0,0,0,0.5);
    }
    .acumen-creators-modal-close:hover { color: #ff4444; }

    .acumen-creators-modal-author {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .acumen-creators-modal-author img {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      object-fit: cover;
    }
    .acumen-creators-modal-author strong {
      font-size: 14px;
    }
    .acumen-creators-modal-caption {
      font-size: 13px;
      line-height: 1.6;
      color: #333;
    }
    .acumen-creators-modal-stats {
      font-size: 12px;
      color: #888;
      display: flex;
      gap: 12px;
    }
    .acumen-creators-modal-link {
      font-size: 13px;
      color: #007bff;
      text-decoration: none;
    }
    .acumen-creators-modal-link:hover { text-decoration: underline; }

    /* Mobile */
    @media (max-width: 640px) {
      .acumen-creator-avatar,
      .acumen-creator-avatar-placeholder {
        width: 52px;
        height: 52px;
        font-size: 18px;
      }
      .acumen-creators-row { gap: 14px; }
      .acumen-ugc-grid {
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
      }
      .acumen-ugc-card-media { height: 200px; }
      .acumen-creators-modal-content {
        flex-direction: column;
        max-height: 90vh;
      }
      .acumen-creators-modal-right {
        width: 100%;
        max-height: 40vh;
      }
    }
  `;
  document.head.appendChild(style);

  // State
  let allCreators = [];
  let selectedUsername = null;
  let creatorsContainer = null;

  function init() {
    creatorsContainer = document.getElementById("acumen-creators-widget");
    if (!creatorsContainer) return;

    creatorsContainer.innerHTML = '<div class="acumen-loading">Loading creators...</div>';

    fetch(`${BASE}/api-creators`)
      .then((r) => r.json())
      .then((data) => {
        allCreators = (data.creators || []).filter((c) => c.post_count > 0);
        if (allCreators.length === 0) {
          creatorsContainer.innerHTML = '<div class="acumen-loading">No creators found.</div>';
          return;
        }
        render();
        selectCreator(allCreators[0].username);
      })
      .catch((err) => {
        console.error("[AcumenCreators] Failed to load creators:", err);
        creatorsContainer.innerHTML = '<div class="acumen-loading">Failed to load creators.</div>';
      });
  }

  function render() {
    creatorsContainer.innerHTML = `
      <div class="acumen-creators-widget">
        <div class="acumen-creators-row" id="acumen-avatar-row"></div>
        <div id="acumen-ugc-area"></div>
      </div>
    `;
    renderAvatarRow();
  }

  function renderAvatarRow() {
    const row = document.getElementById("acumen-avatar-row");
    if (!row) return;

    row.innerHTML = allCreators
      .map((c) => {
        const isActive = c.username === selectedUsername;
        const avatarHTML = c.profile_pic_url
          ? `<img class="acumen-creator-avatar" src="${c.profile_pic_url}" alt="@${c.username}" />`
          : `<div class="acumen-creator-avatar-placeholder">${(c.username || "?")[0].toUpperCase()}</div>`;

        return `
          <div class="acumen-creator-chip ${isActive ? "active" : ""}" data-username="${c.username}">
            ${avatarHTML}
            <span class="acumen-creator-name">@${c.username}</span>
          </div>
        `;
      })
      .join("");

    row.querySelectorAll(".acumen-creator-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        selectCreator(chip.dataset.username);
      });
    });
  }

  function selectCreator(username) {
    selectedUsername = username;
    renderAvatarRow();

    const area = document.getElementById("acumen-ugc-area");
    if (!area) return;
    area.innerHTML = '<div class="acumen-loading">Loading posts...</div>';

    const creator = allCreators.find((c) => c.username === username);

    fetch(`${BASE}/api-creator-detail?username=${encodeURIComponent(username)}&limit=20`)
      .then((r) => r.json())
      .then((data) => {
        const posts = data.posts || [];
        if (posts.length === 0) {
          area.innerHTML = '<div class="acumen-loading">No posts yet.</div>';
          return;
        }
        renderUGCGrid(area, posts, creator);
      })
      .catch((err) => {
        console.error("[AcumenCreators] Failed to load posts:", err);
        area.innerHTML = '<div class="acumen-loading">Failed to load posts.</div>';
      });
  }

  function renderUGCGrid(container, posts, creator) {
    container.innerHTML = `<div class="acumen-ugc-grid">
      ${posts
        .map(
          (post, idx) => `
        <div class="acumen-ugc-card" data-idx="${idx}">
          <div class="acumen-ugc-card-media">
            ${
              post.media_type === "VIDEO"
                ? `<video muted loop playsinline preload="metadata"><source src="${post.media_url}" type="video/mp4"></video>
                   <span class="video-badge">▶ Video</span>`
                : `<img src="${post.media_url || post.thumbnail_url}" alt="UGC" loading="lazy" />`
            }
          </div>
          <div class="acumen-ugc-card-info">
            <p class="acumen-ugc-caption">${post.caption || ""}</p>
            <div class="acumen-ugc-card-stats">
              <span>♥ ${post.like_count || 0}</span>
              <span>💬 ${post.comments_count || 0}</span>
            </div>
          </div>
        </div>
      `
        )
        .join("")}
    </div>`;

    container.querySelectorAll(".acumen-ugc-card").forEach((card) => {
      card.addEventListener("click", () => {
        const idx = parseInt(card.dataset.idx, 10);
        showModal(posts[idx], creator);
      });
    });
  }

  function showModal(post, creator) {
    const modal = document.createElement("div");
    modal.className = "acumen-creators-modal";

    const avatarHTML = creator?.profile_pic_url
      ? `<img src="${creator.profile_pic_url}" alt="@${post.username}" />`
      : "";

    modal.innerHTML = `
      <div class="acumen-creators-modal-content">
        <span class="acumen-creators-modal-close">&times;</span>
        <div class="acumen-creators-modal-media">
          ${
            post.media_type === "VIDEO"
              ? `<video controls autoplay><source src="${post.media_url}" type="video/mp4"></video>`
              : `<img src="${post.media_url || post.thumbnail_url}" alt="UGC" />`
          }
        </div>
        <div class="acumen-creators-modal-right">
          <div class="acumen-creators-modal-author">
            ${avatarHTML}
            <strong>@${post.username}</strong>
          </div>
          <div class="acumen-creators-modal-caption">${post.caption || "No caption."}</div>
          <div class="acumen-creators-modal-stats">
            <span>♥ ${post.like_count || 0} likes</span>
            <span>💬 ${post.comments_count || 0} comments</span>
          </div>
          ${post.permalink ? `<a class="acumen-creators-modal-link" href="${post.permalink}" target="_blank" rel="noreferrer">View on Instagram →</a>` : ""}
        </div>
      </div>
    `;

    modal.querySelector(".acumen-creators-modal-close").addEventListener("click", () => modal.remove());
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });

    document.body.appendChild(modal);
  }

  // Auto-init on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
