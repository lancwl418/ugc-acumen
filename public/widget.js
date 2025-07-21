(function () {
    
  
    // 注入基础样式
    const style = document.createElement("style");
    style.innerHTML = `
      .acumen-ugc-container { padding: 2rem; font-family: Arial, sans-serif; }
      .acumen-ugc-container h2 { font-size: 1.5rem; margin-bottom: 1rem; }
      .acumen-ugc-slide p {
        margin: 0;
        font-size: 14px;
        line-height: 1.4;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .acumen-ugc-slide button {
        font-size: 14px;
        color: #007bff;
        text-decoration: underline;
        padding: 0;
        border: none;
        background: none;
        cursor: pointer;
        text-align: left;
      }
      .acumen-ugc-media {
        height: 250px;
        overflow: hidden;
        border-radius: 8px;
      }
      .acumen-ugc-media img,
      .acumen-ugc-media video {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .acumen-modal {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 9999;
      }
      .acumen-modal-content {
        background: #fff;
        border-radius: 8px;
        padding: 24px;
        max-width: 90vw;
        max-height: 90vh;
        overflow-y: auto;
        display: flex;
        gap: 24px;
      }
      .acumen-modal-content img,
      .acumen-modal-content video {
        max-width: 100%;
        height: auto;
      }
      .acumen-modal-right {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
 
      .acumen-ugc-container .swiper-pagination-bullet {
  width: 12px;
  height: 12px;
  background: #000;
  opacity: 0.7;
  margin: 0 8px !important;
}

.acumen-ugc-container .swiper-pagination-bullet-active {
  background: #007bff; /* 活动点颜色 */
  opacity: 1;
}

.acumen-ugc-container .swiper-pagination {
  position: relative;
  margin-top: 10px; /* 往下移动 */
  text-align: center;
}
    `;
    document.head.appendChild(style);
  
    function renderSlider(mediaItems) {
      const container = document.getElementById("acumen-ugc-widget");
      if (!container) return;
  
      container.innerHTML = `
        <div class="acumen-ugc-container">
          <div class="swiper">
            <div class="swiper-wrapper">
              ${mediaItems
                .map(
                  (item) => `
                  <div class="swiper-slide acumen-ugc-slide" data-id="${item.id}">
                    <div class="acumen-ugc-media">
                      ${
                        item.media_type === "VIDEO"
                          ? `<video muted autoplay loop><source src="${item.media_url}" type="video/mp4"></video>`
                          : `<img src="${item.media_url}" alt="Instagram content" />`
                      }
                    </div>
                    <p><strong>@acumencamera</strong>: ${item.caption || "No caption."}</p>
                    <button class="view-post">View full post</button>
                  </div>
                `
                )
                .join("")}
            </div>
            <div class="swiper-pagination"></div>
            <div class="swiper-button-prev"></div>
            <div class="swiper-button-next"></div>
          </div>
        </div>
      `;
  
      // 初始化 Swiper
      setTimeout(() => {
        new Swiper(".swiper", {
          loop: true,
          slidesPerView: 5,
          spaceBetween: 16,
          pagination: { el: ".swiper-pagination" },
          navigation: {
            nextEl: ".swiper-button-next",
            prevEl: ".swiper-button-prev",
          },
          breakpoints: {
            768: { slidesPerView: 3 },
            1024: { slidesPerView: 4 },
            1280: { slidesPerView: 5 },
          },
        });
      }, 200);
  
      // 绑定 modal 打开
      container.querySelectorAll(".view-post").forEach((btn, idx) => {
        btn.addEventListener("click", () => showModal(mediaItems[idx]));
      });
    }
  
    function showModal(item) {
      const modal = document.createElement("div");
      modal.className = "acumen-modal";
      modal.innerHTML = `
        <div class="acumen-modal-content">
          <div style="flex: 1;">
            ${
              item.media_type === "VIDEO"
                ? `<video controls><source src="${item.media_url}" type="video/mp4"></video>`
                : `<img src="${item.media_url}" alt="Instagram content" />`
            }
          </div>
          <div class="acumen-modal-right">
            <p><strong>@acumencamera</strong>: ${item.caption || "No caption."}</p>
            <a href="${item.permalink}" target="_blank" style="color:#007bff; text-decoration:underline;">View original post</a>
          </div>
        </div>
      `;
      modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.remove();
      });
      document.body.appendChild(modal);
    }
  
    // 获取数据
    

    fetch("https://ugc.acumen-camera.com/api/ugc-media")
      .then((res) => res.json())
      .then((data) => renderSlider(data.media || []))
      .catch((err) => console.error("Failed to load UGC:", err));
  })();
  