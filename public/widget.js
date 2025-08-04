(function () {
  // 注入基础样式
  const style = document.createElement("style");
  style.innerHTML = `
    .acumen-ugc-container { padding: 2rem; font-family: Arial, sans-serif; }
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

    /* 弹窗 */
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
      position: relative;
      background: #fff;
      border-radius: 8px;
      padding: 24px;
      max-width: 80vw;
      max-height: 80vh;
      overflow-y: auto;
      display: flex;
      gap: 24px;
    }
    .acumen-modal-content img,
    .acumen-modal-content video {
      max-width: 400px;
      height: auto;
      border-radius: 6px;
      display: block;
      margin: 0 auto;
    }
    .acumen-modal-right {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    /* 关闭按钮 */
    .acumen-modal-close {
      position: absolute;
      top: 12px;
      right: 16px;
      font-size: 22px;
      font-weight: bold;
      color: #333;
      cursor: pointer;
    }
    .acumen-modal-close:hover {
      color: red;
    }

    /* 产品卡片 */
    .ugc-product-card {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      border: 1px solid #eee;
      border-radius: 6px;
    }
    .ugc-product-card img {
      width: 60px;
      height: 60px;
      object-fit: cover;
      border-radius: 4px;
    }
    .ugc-product-card a {
      font-size: 12px;
      color: #007bff;
      text-decoration: underline;
    }
  `;
  document.head.appendChild(style);

  function renderSlider(mediaItems, productMap) {
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

    container.querySelectorAll(".view-post").forEach((btn, idx) => {
      btn.addEventListener("click", () =>
        showModal(mediaItems[idx], productMap)
      );
    });
  }

  function showModal(item, productMap) {
    const modal = document.createElement("div");
    modal.className = "acumen-modal";

    const productHTML =
      item.products && item.products.length
        ? item.products
            .map((handle) => {
              const p = productMap[handle];
              return p
                ? `<div class="ugc-product-card">
                     <img src="${p.image}" alt="${p.title}" />
                     <div>
                       <div>${p.title}</div>
                       <a href="${p.link}" target="_blank">View More</a>
                     </div>
                   </div>`
                : "";
            })
            .join("")
        : "<p>No related products.</p>";

    modal.innerHTML = `
      <div class="acumen-modal-content">
        <span class="acumen-modal-close">&times;</span>
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
          <h4>Related Products</h4>
          ${productHTML}
        </div>
      </div>
    `;

    modal.querySelector(".acumen-modal-close").addEventListener("click", () => modal.remove());
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });

    document.body.appendChild(modal);
  }

  Promise.all([
    fetch("https://ugc.acumen-camera.com/api/ugc-media").then((res) => res.json()),
    fetch("https://ugc.acumen-camera.com/products.json").then((res) => res.json()),
  ])
    .then(([ugcData, productData]) => {
      const productMap = {};
      (productData.products || []).forEach((p) => {
        productMap[p.handle] = p;
      });
      renderSlider(ugcData.media || [], productMap);
    })
    .catch((err) => console.error("Failed to load UGC or products:", err));
})();
