import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useEffect, useState } from "react";

export async function loader() {
  const res = await fetch(`${process.env.APP_URL || ""}/api/ugc-media`);
  const data = await res.json();
  return json(data);
}

export default function UGCSlider() {
  const { media } = useLoaderData();
  const [selectedItem, setSelectedItem] = useState(null);

  useEffect(() => {
    if (typeof window !== "undefined" && window.Swiper) {
      new window.Swiper(".swiper", {
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
        // 禁用视频滑动冲突
  preventClicks: true,
  preventClicksPropagation: true,
      });
    }
  }, []);

  return (
    <>
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/swiper@10/swiper-bundle.min.css"
      />
      <script
        src="https://cdn.jsdelivr.net/npm/swiper@10/swiper-bundle.min.js"
        defer
      />

      <div className="ugc-container" style={{ padding: "2rem" }}>
        <h2 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>
          ACUMENCAMERA Community Posts
        </h2>
        <div className="swiper">
          <div className="swiper-wrapper">
            {media.map((item) => (
              <div
                className="swiper-slide"
                key={item.id}
                style={{ display: "flex", flexDirection: "column", gap: "8px" }}
              >
                <div
                  style={{
                    height: "250px",
                    overflow: "hidden",
                    borderRadius: "8px",
                  }}
                >
                  {item.media_type === "VIDEO" ? (
                    <video
                      autoPlay muted loop
                      
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    >
                      <source src={item.media_url} type="video/mp4" />
                    </video>
                  ) : (
                    <img
                      src={item.media_url}
                      alt="Instagram content"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  )}
                </div>
                <p
                  style={{
                    margin: 0,
                    fontSize: "14px",
                    lineHeight: "1.4",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  <strong>@acumencamera</strong>: {item.caption || "No caption."}
                </p>
                <button
                  onClick={() => setSelectedItem(item)}
                  style={{
                    fontSize: "14px",
                    color: "#007bff",
                    textDecoration: "underline",
                    padding: 0,
                    border: "none",
                    background: "none",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  View full post
                </button>
              </div>
            ))}
          </div>
          <div className="swiper-pagination"></div>
          <div className="swiper-button-prev"></div>
          <div className="swiper-button-next"></div>
        </div>
      </div>

      {selectedItem && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 1000,
          }}
          onClick={() => setSelectedItem(null)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "8px",
              padding: "24px",
              maxWidth: "90vw",
              maxHeight: "90vh",
              overflowY: "auto",
              display: "flex",
              gap: "24px",
              cursor: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ flex: 1 }}>
              {selectedItem.media_type === "VIDEO" ? (
                <video controls style={{ maxWidth: "100%", height: "auto" }}>
                  <source src={selectedItem.media_url} type="video/mp4" />
                </video>
              ) : (
                <img
                  src={selectedItem.media_url}
                  alt="Instagram content"
                  style={{ maxWidth: "100%", height: "auto" }}
                />
              )}
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "16px" }}>
              <p>
                <strong>@acumencamera:</strong> {selectedItem.caption || "No caption."}
              </p>
              <a
                href={selectedItem.permalink}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#007bff", textDecoration: "underline" }}
              >
                View original post
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
