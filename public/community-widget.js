/* Acumen Community storefront widget
 * Renders the magazine-style community page (Ambassador rail + scenario tabs +
 * video/photo grids + submit CTA) into a mount element.
 *
 * Mount:  <div id="acumen-community-root"></div>
 *         <script src="https://ugc.acumen-camera.com/community-widget.js" defer></script>
 */
(function () {
  const BASE = "https://ugc.acumen-camera.com";

  const SCENARIOS = [
    { id: "all",     label: "All scenarios" },
    { id: "driving", label: "Driving Safety" },
    { id: "towing",  label: "Towing & Camping" },
    { id: "offroad", label: "Off-road & Overland" },
    { id: "fleet",   label: "Fleet & Commercial" },
    { id: "utv",     label: "UTV & Utility" },
    { id: "marine",  label: "Marine Life" },
  ];

  const SCENARIO_BLURB = {
    driving: "Commute incidents, parked-mode catches, near-misses. The boring stuff that pays for the camera.",
    towing: "RVs, trailers, boondocking, campsite arrivals — long-haul footage from owners who live on the road.",
    offroad: "Trails, snow-line, river crossings, overland routes. Where the cameras and the drivers get tested.",
    fleet: "Vans, work trucks, delivery routes and rideshare — cameras earning their keep on the clock.",
    utv: "Side-by-sides, ATVs, ranch and dune runs — utility rigs that double as toys.",
    marine: "Boats, jet skis, ramps and docks — clips from the water and the launch.",
  };

  // Palette tones used for placeholder backgrounds when no thumbnail
  const TONE = {
    driving: { a: "#3A4756", b: "#1F2730" },
    towing:  { a: "#A87A4E", b: "#5C3E22" },
    offroad: { a: "#3F5D45", b: "#1B2A21" },
    fleet:   { a: "#5C5650", b: "#2E2A26" },
    utv:     { a: "#8A6B33", b: "#3E2F16" },
    marine:  { a: "#2F5C6B", b: "#13313A" },
  };

  // ─── State ──────────────────────────────────────────────
  const state = {
    scenario: "all",
    data: null,         // /api-community payload
    ambassadors: null,  // /api-ambassadors payload
    error: null,
  };

  // ─── Style + font injection ─────────────────────────────
  function injectFontLink() {
    if (document.getElementById("acumen-community-font")) return;
    const pre1 = document.createElement("link");
    pre1.rel = "preconnect";
    pre1.href = "https://fonts.googleapis.com";
    document.head.appendChild(pre1);
    const pre2 = document.createElement("link");
    pre2.rel = "preconnect";
    pre2.href = "https://fonts.gstatic.com";
    pre2.crossOrigin = "anonymous";
    document.head.appendChild(pre2);
    const link = document.createElement("link");
    link.id = "acumen-community-font";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap";
    document.head.appendChild(link);
  }

  function injectStyles() {
    if (document.getElementById("acumen-community-styles")) return;
    const css = `
.ac-community {
  --bg:#FFFFFF; --bg-soft:#F2F4F6; --bg-tint:#EDF2F5; --bg-card:#FFFFFF;
  --ink:#0E1116; --ink-soft:#2A2F38; --muted:#6B7280;
  --line:#E5E8EC; --line-strong:#CFD5DC;
  --accent:#19A6DC; --accent-soft:#D7EFFA; --accent-deep:#0E7FB0;
  --navy:#0F2542; --navy-soft:#1A3358;
  --shadow-sm:0 1px 2px rgba(15,37,66,.05),0 1px 1px rgba(15,37,66,.03);
  --shadow-md:0 6px 18px rgba(15,37,66,.08),0 2px 6px rgba(15,37,66,.05);
  --radius:10px; --radius-lg:18px;
  --font-sans:"Montserrat","Helvetica Neue",Helvetica,Arial,sans-serif;
  --font-mono:"JetBrains Mono",ui-monospace,monospace;
  font-family:var(--font-sans); color:var(--ink); background:var(--bg);
  font-size:14px; line-height:1.5; -webkit-font-smoothing:antialiased;
}
.ac-community *,.ac-community *::before,.ac-community *::after{box-sizing:border-box;}
.ac-community a{color:inherit;text-decoration:none;}
.ac-community button{font-family:inherit;cursor:pointer;}
.ac-community .ac-shell{max-width:1320px;margin:0 auto;padding:0 40px;}
.ac-community .ac-mono{font-family:var(--font-mono);font-size:11px;letter-spacing:.04em;text-transform:uppercase;}

/* Hero */
.ac-community .ac-hero{padding:56px 0 28px;}
.ac-community .ac-hero-grid{display:grid;grid-template-columns:1.4fr 1fr;gap:64px;align-items:end;}
.ac-community .ac-eyebrow{display:inline-flex;align-items:center;gap:8px;color:var(--accent);font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;}
.ac-community .ac-eyebrow::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--accent);}
.ac-community .ac-hero h1{font-weight:800;font-size:clamp(42px,5.6vw,72px);line-height:1.04;letter-spacing:-.02em;margin:14px 0 0;color:var(--ink);text-wrap:balance;}
.ac-community .ac-hero h1 em{color:var(--accent);font-style:normal;font-weight:800;}
.ac-community .ac-hero-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding-bottom:6px;}
.ac-community .ac-stat-num{font-weight:800;font-size:40px;line-height:1;letter-spacing:-.02em;color:var(--ink);}
.ac-community .ac-stat-label{color:var(--muted);font-size:12px;margin-top:8px;font-weight:500;}

/* Ambassador rail */
.ac-community .ac-amb-section{margin-top:48px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:32px 0 36px;}
.ac-community .ac-amb-head{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:24px;gap:24px;flex-wrap:wrap;}
.ac-community .ac-amb-title{font-weight:800;font-size:32px;line-height:1.05;margin:0;letter-spacing:-.02em;}
.ac-community .ac-amb-title em{color:var(--accent);font-style:normal;font-weight:800;}
.ac-community .ac-amb-sub{color:var(--muted);font-size:13.5px;margin-top:8px;max-width:540px;line-height:1.55;}
.ac-community .ac-amb-rail{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;}
.ac-community .ac-amb-card{background:var(--bg-card);border:1px solid var(--line);border-radius:var(--radius);padding:18px;display:flex;flex-direction:column;gap:14px;transition:border-color .15s ease,transform .15s ease;}
.ac-community .ac-amb-card:hover{border-color:var(--line-strong);transform:translateY(-2px);}
.ac-community .ac-amb-portrait{position:relative;aspect-ratio:4/3;border-radius:8px;overflow:hidden;background:var(--bg-soft);}
.ac-community .ac-amb-portrait img{width:100%;height:100%;object-fit:cover;display:block;}
.ac-community .ac-amb-badge-tag{position:absolute;top:10px;left:10px;background:rgba(255,255,255,.95);color:var(--ink);font-weight:700;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;padding:4px 10px;border-radius:999px;display:inline-flex;align-items:center;gap:5px;box-shadow:var(--shadow-sm);}
.ac-community .ac-amb-badge-tag::before{content:"";width:5px;height:5px;border-radius:50%;background:var(--accent);}
.ac-community .ac-amb-name{font-weight:800;font-size:18px;line-height:1.2;margin:0;letter-spacing:-.01em;}
.ac-community .ac-amb-role{color:var(--accent);font-weight:700;font-size:11px;letter-spacing:.06em;text-transform:uppercase;margin-top:4px;display:block;}
.ac-community .ac-amb-quote{font-weight:500;font-size:13.5px;color:var(--ink-soft);line-height:1.55;margin:0;text-wrap:pretty;}
.ac-community .ac-amb-quote::before{content:"\\201C";color:var(--accent);margin-right:2px;font-weight:700;}
.ac-community .ac-amb-quote::after{content:"\\201D";color:var(--accent);margin-left:2px;font-weight:700;}
.ac-community .ac-amb-meta{display:flex;flex-direction:column;gap:4px;font-size:12.5px;color:var(--muted);margin-top:auto;}
.ac-community .ac-amb-meta .row{display:flex;justify-content:space-between;align-items:baseline;}
.ac-community .ac-amb-meta .k{font-weight:700;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);}
.ac-community .ac-amb-meta .v{color:var(--ink-soft);}
.ac-community .ac-amb-foot{display:flex;align-items:center;gap:10px;padding-top:12px;margin-top:4px;border-top:1px solid var(--line);}
.ac-community .ac-amb-foot .clips{font-weight:500;font-size:12px;color:var(--muted);}
.ac-community .ac-amb-foot .follow{margin-left:auto;height:30px;padding:0 16px;border-radius:999px;background:var(--accent);color:#fff;border:1px solid var(--accent);font-size:12px;font-weight:600;}
.ac-community .ac-amb-foot .follow:hover{background:var(--accent-deep);border-color:var(--accent-deep);}

/* Primary scenario tabs */
.ac-community .ac-tabs-row{display:flex;align-items:flex-end;justify-content:space-between;border-bottom:1px solid var(--line);margin-top:56px;gap:24px;flex-wrap:wrap;}
.ac-community .ac-tabs{display:flex;gap:4px;flex-wrap:wrap;}
.ac-community .ac-tab{display:inline-flex;align-items:baseline;gap:8px;padding:18px 20px 20px;background:transparent;border:none;color:var(--muted);font-weight:800;font-size:20px;letter-spacing:-.015em;border-bottom:2px solid transparent;margin-bottom:-1px;}
.ac-community .ac-tab .count{font-weight:600;font-size:11px;color:var(--muted);}
.ac-community .ac-tab.is-active{color:var(--ink);border-bottom-color:var(--accent);}
.ac-community .ac-tab.is-active .count{color:var(--accent);}
.ac-community .ac-tab:hover:not(.is-active){color:var(--ink-soft);}

/* Secondary media-type sub-tabs */
.ac-community .ac-sub-tabs-row{display:flex;align-items:center;justify-content:space-between;padding:22px 0 6px;gap:24px;flex-wrap:wrap;}
.ac-community .ac-sub-tabs-context{display:inline-flex;align-items:center;gap:10px;color:var(--muted);}
.ac-community .ac-sub-tabs-context .ac-mono{color:var(--muted);}
.ac-community .ac-sub-tabs-scenario{font-weight:700;font-size:14px;color:var(--ink);letter-spacing:-.005em;}
.ac-community .ac-sub-tabs{display:inline-flex;align-items:center;gap:4px;padding:4px;background:var(--bg-soft);border-radius:999px;border:1px solid var(--line);}
.ac-community .ac-sub-tab{display:inline-flex;align-items:center;gap:8px;border:none;background:transparent;padding:8px 18px;border-radius:999px;color:var(--muted);font-size:13px;font-weight:600;transition:background .15s ease,color .15s ease;}
.ac-community .ac-sub-tab:hover{color:var(--ink-soft);}
.ac-community .ac-sub-tab.is-active{background:var(--accent);color:#fff;box-shadow:var(--shadow-sm);}
.ac-community .ac-sub-count{font-weight:700;font-size:11px;color:var(--muted);background:var(--bg-card);padding:1px 7px;border-radius:999px;min-width:20px;text-align:center;}
.ac-community .ac-sub-tab.is-active .ac-sub-count{background:rgba(255,255,255,.22);color:#fff;}

/* Section heads */
.ac-community .ac-section{margin-top:64px;}
.ac-community .ac-section-head{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:28px;gap:24px;flex-wrap:wrap;}
.ac-community .ac-section-title{font-weight:800;font-size:32px;line-height:1.05;margin:0;letter-spacing:-.02em;color:var(--ink);}
.ac-community .ac-section-title em{color:var(--accent);font-style:normal;font-weight:800;}
.ac-community .ac-section-sub{color:var(--muted);font-size:14px;margin-top:8px;max-width:540px;font-weight:500;}

/* Video grid */
.ac-community .ac-video-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:24px;}
.ac-community .ac-v-card{grid-column:span 4;}
.ac-community .ac-v-card.feature{grid-column:span 8;}
.ac-community .ac-v-thumb{position:relative;aspect-ratio:16/10;border-radius:var(--radius);overflow:hidden;background:var(--bg-soft);box-shadow:var(--shadow-sm);cursor:pointer;}
.ac-community .ac-v-card.feature .ac-v-thumb{aspect-ratio:16/9;}
.ac-community .ac-v-thumb img,.ac-community .ac-v-thumb video{width:100%;height:100%;object-fit:cover;display:block;}
.ac-community .ac-v-top{position:absolute;top:12px;left:12px;right:12px;display:flex;justify-content:space-between;align-items:flex-start;pointer-events:none;}
.ac-community .ac-v-tag{display:inline-flex;align-items:center;gap:6px;background:rgba(15,37,66,.85);backdrop-filter:blur(6px);color:#fff;padding:4px 10px;border-radius:999px;font-weight:600;font-size:11px;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap;}
.ac-community .ac-v-play{position:absolute;left:14px;bottom:14px;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.95);color:var(--ink);display:grid;place-items:center;border:none;box-shadow:0 6px 16px rgba(0,0,0,.25);}
.ac-community .ac-v-meta{padding:14px 2px 0;}
.ac-community .ac-v-title{font-weight:700;font-size:16px;line-height:1.3;letter-spacing:-.005em;margin:0;color:var(--ink);text-wrap:pretty;}
.ac-community .ac-v-card.feature .ac-v-title{font-size:22px;font-weight:800;letter-spacing:-.015em;}
.ac-community .ac-v-byline{display:flex;align-items:center;gap:10px;margin-top:10px;font-size:13px;color:var(--muted);flex-wrap:wrap;}
.ac-community .ac-avatar{width:22px;height:22px;border-radius:50%;background:var(--bg-soft);display:grid;place-items:center;font-size:10px;color:var(--ink);border:1px solid var(--line);overflow:hidden;font-weight:700;}
.ac-community .ac-avatar img{width:100%;height:100%;object-fit:cover;}
.ac-community .ac-v-stats{display:inline-flex;gap:12px;margin-left:auto;font-family:var(--font-mono);font-size:11px;}
.ac-community .ac-v-stats span{display:inline-flex;align-items:center;gap:4px;}

/* Inline ambassador chip */
.ac-community .ac-amb-chip{display:inline-flex;align-items:center;gap:4px;color:var(--accent);font-weight:700;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;margin-left:2px;}
.ac-community .ac-amb-chip svg{width:12px;height:12px;}

/* Photo masonry */
.ac-community .ac-masonry{column-count:3;column-gap:24px;}
.ac-community .ac-p-card{break-inside:avoid;margin-bottom:24px;background:var(--bg-card);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;transition:transform .2s ease,box-shadow .2s ease;}
.ac-community .ac-p-card:hover{transform:translateY(-2px);box-shadow:var(--shadow-md);}
.ac-community .ac-p-img{position:relative;background:var(--bg-soft);}
.ac-community .ac-p-img img{display:block;width:100%;height:auto;}
.ac-community .ac-p-img .ac-v-tag{position:absolute;top:12px;left:12px;}
.ac-community .ac-p-body{padding:18px;}
.ac-community .ac-r-pill{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:var(--accent-soft);color:var(--accent-deep);font-weight:600;font-size:11px;letter-spacing:.04em;text-transform:uppercase;}
.ac-community .ac-p-title{font-weight:700;font-size:17px;line-height:1.3;margin:12px 0 8px;letter-spacing:-.005em;color:var(--ink);}
.ac-community .ac-p-excerpt{color:var(--ink-soft);font-size:13.5px;line-height:1.55;margin:0;}
.ac-community .ac-p-foot{display:flex;align-items:center;gap:10px;padding:12px 18px 16px;color:var(--muted);font-size:12.5px;border-top:1px solid var(--line);}
.ac-community .ac-p-foot .ac-v-stats{margin-left:auto;color:var(--ink-soft);}

/* Submit CTA */
.ac-community .ac-submit-cta{margin-top:96px;padding:56px 48px;background:var(--navy);color:#fff;border-radius:var(--radius-lg);display:grid;grid-template-columns:1.4fr 1fr;gap:48px;align-items:center;}
.ac-community .ac-submit-cta h2{font-weight:800;font-size:44px;line-height:1.08;margin:0;letter-spacing:-.02em;color:#fff;}
.ac-community .ac-submit-cta h2 em{color:var(--accent);font-style:normal;font-weight:800;}
.ac-community .ac-submit-cta p{color:rgba(255,255,255,.72);font-size:14.5px;margin:18px 0 0;max-width:480px;font-weight:500;line-height:1.55;}
.ac-community .ac-submit-cta .ac-actions{display:flex;gap:12px;margin-top:24px;flex-wrap:wrap;}
.ac-community .ac-btn{display:inline-flex;align-items:center;gap:8px;height:44px;padding:0 22px;border-radius:999px;font-size:14px;font-weight:600;border:1px solid var(--accent);background:var(--accent);color:#fff;}
.ac-community .ac-btn:hover{background:var(--accent-deep);border-color:var(--accent-deep);}
.ac-community .ac-btn.ghost{background:transparent;border:1px solid rgba(255,255,255,.32);color:#fff;}
.ac-community .ac-btn.ghost:hover{background:#fff;color:var(--navy);border-color:#fff;}
.ac-community .ac-submit-aside{font-size:12px;color:rgba(255,255,255,.56);font-weight:500;line-height:1.85;border-left:1px solid rgba(255,255,255,.18);padding-left:28px;}
.ac-community .ac-submit-aside b{color:#fff;font-weight:700;text-transform:uppercase;letter-spacing:.04em;font-size:11px;display:inline-block;margin-bottom:6px;}

.ac-community .ac-foot{padding:48px 0;color:var(--muted);font-size:12.5px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;}

.ac-community .ac-empty{padding:80px 20px;text-align:center;color:var(--muted);border:1px dashed var(--line-strong);border-radius:var(--radius-lg);}
.ac-community .ac-loading{padding:80px 20px;text-align:center;color:var(--muted);font-weight:500;}

/* Responsive */
@media (max-width:1100px){
  .ac-community .ac-hero-grid{grid-template-columns:1fr;gap:24px;}
  .ac-community .ac-amb-rail{grid-template-columns:repeat(2,1fr);}
  .ac-community .ac-video-grid{grid-template-columns:repeat(6,1fr);}
  .ac-community .ac-v-card,.ac-community .ac-v-card.feature{grid-column:span 6;}
  .ac-community .ac-submit-cta{grid-template-columns:1fr;padding:32px;}
  .ac-community .ac-submit-aside{border-left:none;padding-left:0;border-top:1px solid rgba(255,255,255,.18);padding-top:20px;}
}
@media (max-width:1000px){
  .ac-community .ac-masonry{column-count:2;}
}
@media (max-width:700px){
  .ac-community .ac-shell{padding:0 20px;}
  .ac-community .ac-amb-rail{grid-template-columns:1fr;}
  .ac-community .ac-masonry{column-count:1;}
  .ac-community .ac-tab{font-size:16px;padding:14px 14px 16px;}
}
`;
    const style = document.createElement("style");
    style.id = "acumen-community-styles";
    style.innerHTML = css;
    document.head.appendChild(style);
  }

  // ─── Utility helpers ────────────────────────────────────
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === "class") node.className = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else if (k.startsWith("on") && typeof attrs[k] === "function") node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  function escapeHTML(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
  }

  function initialsOf(name) {
    if (!name) return "AC";
    return name.split(/[\s_]/).filter(Boolean).map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  }

  function formatCount(n) {
    if (n == null) return "0";
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  }

  function timeAgo(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const day = 86400_000;
    if (diff < day) return "today";
    if (diff < 7 * day) return Math.floor(diff / day) + "d ago";
    if (diff < 30 * day) return Math.floor(diff / (7 * day)) + "w ago";
    if (diff < 365 * day) return Math.floor(diff / (30 * day)) + "mo ago";
    return Math.floor(diff / (365 * day)) + "y ago";
  }

  function scenarioLabel(id) {
    return (SCENARIOS.find((s) => s.id === id) || {}).label || id;
  }

  function scenarioTone(id) {
    return TONE[id] || TONE.driving;
  }

  function stripeBackground(id) {
    const t = scenarioTone(id);
    return `repeating-linear-gradient(45deg, ${t.a} 0 11px, ${t.b} 11px 22px)`;
  }

  function ambassadorChipHTML() {
    return `<span class="ac-amb-chip" title="Acumen Ambassador"><svg viewBox="0 0 12 12" fill="none" width="12" height="12"><circle cx="6" cy="6" r="5.4" fill="currentColor"/><path d="M3.6 6.2l1.7 1.6 3.1-3.4" stroke="#fff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>Ambassador</span>`;
  }

  function playIconHTML() {
    return `<svg width="16" height="16" viewBox="0 0 16 16"><path d="M5 3.5v9l7-4.5-7-4.5z" fill="currentColor"/></svg>`;
  }
  function heartIconHTML() {
    return `<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 13.5s-5-3.2-5-7a3 3 0 0 1 5-2.2A3 3 0 0 1 13 6.5c0 3.8-5 7-5 7z" stroke="currentColor" stroke-width="1.3"/></svg>`;
  }
  function eyeIconHTML() {
    return `<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.3"/></svg>`;
  }
  function commentIconHTML() {
    return `<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2.5 4a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 13.5 4v5A1.5 1.5 0 0 1 12 10.5H6.5L3.5 13V10.5H4A1.5 1.5 0 0 1 2.5 9V4z" stroke="currentColor" stroke-width="1.3"/></svg>`;
  }

  // ─── Render: Hero ───────────────────────────────────────
  function renderHero(root, data) {
    const stats = data?.stats || {};
    const tile = (num, label) =>
      `<div><div class="ac-stat-num">${escapeHTML(num)}</div><div class="ac-stat-label">${escapeHTML(label)}</div></div>`;

    const hero = el("section", { class: "ac-shell ac-hero" });
    hero.innerHTML = `
      <div class="ac-hero-grid">
        <div>
          <span class="ac-eyebrow">Acumen Community</span>
          <h1>Real footage from real drivers.<br /><em>Filed by the road.</em></h1>
        </div>
        <div class="ac-hero-meta">
          ${tile(formatCount(stats.total_clips || 0), "clips shared")}
          ${tile(formatCount(stats.total_curated || 0), "featured posts")}
          ${tile(String(stats.ambassadors || 0), "community ambassadors")}
        </div>
      </div>
    `;
    root.appendChild(hero);
  }

  // ─── Render: Ambassador Rail ────────────────────────────
  function renderAmbassadorRail(root, ambassadors) {
    if (!ambassadors || !ambassadors.length) return;
    const section = el("section", { class: "ac-shell" });
    const inner = el("div", { class: "ac-amb-section" });

    const head = el("div", { class: "ac-amb-head" });
    head.innerHTML = `
      <div>
        <h2 class="ac-amb-title">Community <em>Ambassadors</em></h2>
        <p class="ac-amb-sub">Verified storytellers who shape what gets shared here. Drivers, installers, overlanders — vetted by the editorial team.</p>
      </div>
    `;
    inner.appendChild(head);

    const rail = el("div", { class: "ac-amb-rail" });
    for (const a of ambassadors) {
      const card = el("article", { class: "ac-amb-card" });
      const portraitHTML = a.profile_pic_url
        ? `<img src="${escapeHTML(a.profile_pic_url)}" alt="${escapeHTML(a.display_name)}" loading="lazy"/>`
        : `<div style="position:absolute;inset:0;background:${stripeBackground((a.scenarios && a.scenarios[0]) || "driving")};opacity:.55;"></div>`;
      card.innerHTML = `
        <div class="ac-amb-portrait">
          ${portraitHTML}
          <span class="ac-amb-badge-tag">Ambassador</span>
        </div>
        <div>
          <h3 class="ac-amb-name">${escapeHTML(a.display_name || a.username)}</h3>
          ${a.role ? `<span class="ac-amb-role">${escapeHTML(a.role)}</span>` : ""}
        </div>
        ${a.quote ? `<p class="ac-amb-quote">${escapeHTML(a.quote)}</p>` : ""}
        <div class="ac-amb-meta">
          ${a.setup ? `<div class="row"><span class="k">Setup</span><span class="v">${escapeHTML(a.setup)}</span></div>` : ""}
          ${a.base ? `<div class="row"><span class="k">Based</span><span class="v">${escapeHTML(a.base)}</span></div>` : ""}
        </div>
        <div class="ac-amb-foot">
          <span class="clips">${a.clips || 0} clips${a.joined_year ? ` · joined ${a.joined_year}` : ""}</span>
        </div>
      `;
      rail.appendChild(card);
    }
    inner.appendChild(rail);
    section.appendChild(inner);
    root.appendChild(section);
  }

  // ─── Render: Scenario tabs (primary) ────────────────────
  function renderScenarioTabs(root) {
    const wrap = el("div", { class: "ac-shell" });
    const row = el("div", { class: "ac-tabs-row" });
    const tabs = el("div", { class: "ac-tabs" });

    for (const s of SCENARIOS) {
      const count = state.data?.counts?.[s.id]?.posts ?? 0;
      const btn = el("button", {
        class: "ac-tab" + (state.scenario === s.id ? " is-active" : ""),
        onclick: () => { state.scenario = s.id; render(); },
      });
      btn.innerHTML = `${escapeHTML(s.label)} <span class="count">${count}</span>`;
      tabs.appendChild(btn);
    }

    row.appendChild(tabs);
    wrap.appendChild(row);
    root.appendChild(wrap);
  }

  function truncate(s, n) {
    if (!s) return "";
    const flat = String(s).replace(/\s+/g, " ").trim();
    return flat.length > n ? flat.slice(0, n - 1) + "…" : flat;
  }

  // ─── Render: Posts view (photo cards) ───────────────────
  function postCardHTML(p) {
    const ambHTML = p.is_ambassador ? ambassadorChipHTML() : "";
    const img = p.thumbnail_url || p.media_url || "";
    const imgInner = img
      ? `<img src="${escapeHTML(img)}" loading="lazy" alt=""/>`
      : `<div style="aspect-ratio:4/5;background:${stripeBackground(p.category)};opacity:.55;"></div>`;
    return `
      <article class="ac-p-card">
        <a class="ac-p-img" href="${escapeHTML(p.permalink || "#")}" target="_blank" rel="noopener">
          ${imgInner}
          <span class="ac-v-tag">${escapeHTML(scenarioLabel(p.category))}</span>
        </a>
        <div class="ac-p-body">
          <h3 class="ac-p-title">${escapeHTML(truncate(p.caption || "Untitled post", 80))}</h3>
          ${p.caption ? `<p class="ac-p-excerpt">${escapeHTML(truncate(p.caption, 200))}</p>` : ""}
        </div>
        <div class="ac-p-foot">
          <span class="ac-avatar">${p.profile_pic_url
            ? `<img src="${escapeHTML(p.profile_pic_url)}" alt=""/>`
            : escapeHTML(initialsOf(p.display_name || p.username))}</span>
          <div>
            <div style="font-size:13px;color:var(--ink);display:inline-flex;align-items:center;gap:6px;">
              ${escapeHTML(p.display_name || p.username)}${ambHTML}
            </div>
            <div style="font-size:11px;color:var(--muted);">${escapeHTML(timeAgo(p.timestamp))}</div>
          </div>
          <div class="ac-v-stats">
            <span>${heartIconHTML()} ${formatCount(p.like_count)}</span>
            <span>${commentIconHTML()} ${formatCount(p.comments_count)}</span>
          </div>
        </div>
      </article>
    `;
  }

  function renderPosts(root) {
    const wrap = el("div", { class: "ac-shell" });
    if (state.scenario === "all") {
      for (const s of SCENARIOS.filter((x) => x.id !== "all")) {
        const items = state.data.by_scenario[s.id]?.posts || [];
        if (!items.length) continue;
        const section = el("section", { class: "ac-section" });
        section.innerHTML = `
          <div class="ac-section-head">
            <div>
              <h2 class="ac-section-title">${escapeHTML(s.label)}.</h2>
              <div class="ac-section-sub">${escapeHTML(SCENARIO_BLURB[s.id] || "")}</div>
            </div>
          </div>
          <div class="ac-masonry">${items.map(postCardHTML).join("")}</div>
        `;
        wrap.appendChild(section);
      }
    } else {
      const items = state.data.by_scenario[state.scenario]?.posts || [];
      if (!items.length) {
        wrap.appendChild(emptyState("No posts in this scenario yet."));
      } else {
        const masonry = el("div", { class: "ac-masonry" });
        masonry.style.marginTop = "8px";
        masonry.innerHTML = items.map(postCardHTML).join("");
        wrap.appendChild(masonry);
      }
    }
    root.appendChild(wrap);
  }

  function emptyState(msg) {
    const d = el("div", { class: "ac-empty" });
    d.textContent = msg;
    return d;
  }

  // ─── Render: Submit CTA ────────────────────────────────
  function renderSubmitCTA(root) {
    const wrap = el("div", { class: "ac-shell" });
    wrap.innerHTML = `
      <section class="ac-submit-cta">
        <div>
          <h2>Got a clip <em>worth sharing?</em></h2>
          <p>Drop your raw footage, a few photos, or a long-form write-up. Approved submissions earn community credits — redeemable on hardware, swap, or charitable donations.</p>
          <div class="ac-actions">
            <a class="ac-btn" href="mailto:community@acumen-camera.com?subject=Clip%20submission">Email submission</a>
            <a class="ac-btn ghost" href="https://www.instagram.com/explore/tags/acumencamera/" target="_blank" rel="noopener">Tag #acumencamera on Instagram</a>
          </div>
        </div>
        <div class="ac-submit-aside">
          <b>Submission rules</b><br/>
          · Original footage only<br/>
          · No identifying minors<br/>
          · Plates auto-blurred on review<br/>
          · Tag <span class="ac-mono">#acumencamera</span> or <span class="ac-mono">@acumen.camera</span> on Instagram so we can find it
        </div>
      </section>
      <div class="ac-foot">
        <span>© ${new Date().getFullYear()} Acumen · Community</span>
        <span class="ac-mono">build · community/${new Date().getFullYear()}.${String(new Date().getMonth() + 1).padStart(2, "0")}</span>
      </div>
    `;
    root.appendChild(wrap);
  }

  // ─── Master render ──────────────────────────────────────
  function render() {
    const mount = state.mount;
    if (!mount) return;
    mount.classList.add("ac-community");
    mount.innerHTML = "";

    if (state.error) {
      const err = el("div", { class: "ac-shell" });
      err.innerHTML = `<div class="ac-empty">Couldn't load community right now.</div>`;
      mount.appendChild(err);
      return;
    }
    if (!state.data) {
      const loading = el("div", { class: "ac-shell" });
      loading.innerHTML = `<div class="ac-loading">Loading community…</div>`;
      mount.appendChild(loading);
      return;
    }

    renderHero(mount, state.data);
    renderAmbassadorRail(mount, state.ambassadors);
    renderScenarioTabs(mount);

    const main = el("main");
    main.style.paddingTop = "28px";
    main.style.paddingBottom = "16px";
    mount.appendChild(main);
    renderPosts(main);

    renderSubmitCTA(mount);
  }

  // ─── Fetch + boot ───────────────────────────────────────
  async function loadData() {
    try {
      const [communityRes, ambRes] = await Promise.all([
        fetch(BASE + "/api-community"),
        fetch(BASE + "/api-ambassadors"),
      ]);
      if (!communityRes.ok) throw new Error("community " + communityRes.status);
      const community = await communityRes.json();
      const amb = ambRes.ok ? await ambRes.json() : { ambassadors: [] };
      state.data = community;
      state.ambassadors = amb.ambassadors || [];
    } catch (e) {
      console.error("[acumen-community] load failed", e);
      state.error = e;
    }
    render();
  }

  function boot() {
    const mount = document.getElementById("acumen-community-root")
      || document.querySelector("[data-acumen-community]");
    if (!mount) {
      console.warn("[acumen-community] no mount element found (#acumen-community-root or [data-acumen-community])");
      return;
    }
    state.mount = mount;
    injectFontLink();
    injectStyles();
    render();      // shows loading
    loadData();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
