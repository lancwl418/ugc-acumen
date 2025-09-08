// app/routes/app.jsx
import { json } from "@remix-run/node";
import { Outlet, Link, useLocation, useLoaderData } from "@remix-run/react";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-remix/react";
import { Frame, Navigation } from "@shopify/polaris";
import { useMemo } from "react";

export const loader = async ({ request }) => {
  // 如果你需要鉴权，这里保持原有逻辑；这里只返回 apiKey
  return json({ apiKey: process.env.SHOPIFY_API_KEY || "" });
};

export default function App() {
  const { apiKey } = useLoaderData();
  const location = useLocation();

  // 统一定义菜单
  const items = useMemo(
    () => [
      { label: "Home", url: "/app", match: /^\/app\/?$/ },
      { label: "UGC 管理（Hashtags #）", url: "/admin/hashtagugc", match: /^\/admin\/hashtagugc/ },
      { label: "UGC 管理（Mentions @）", url: "/admin/mentionsugc", match: /^\/admin\/mentionsugc/ },
    ],
    []
  );

  // Polaris Navigation items 需要 selected
  const navItems = items.map((it) => ({
    label: it.label,
    url: it.url,
    selected: it.match.test(location.pathname),
  }));

  return (
    <ShopifyAppProvider isEmbeddedApp apiKey={apiKey}>
      <Frame
        navigation={
          <Navigation location={location.pathname}>
            <Navigation.Section title="UGC Acumen" items={navItems} />
          </Navigation>
        }
      >
        {/* --- 这个小脚本给 <a data-prefetch="intent"> 做 hover 预取，提升点击速度 --- */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              document.addEventListener('mouseover', (e) => {
                const a = e.target.closest('a[data-prefetch="intent"]');
                if (!a || a.__pf) return;
                a.__pf = true;
                const l = document.createElement('link');
                l.rel = 'prefetch';
                l.href = a.href;
                document.head.appendChild(l);
              }, {passive: true});
            `,
          }}
        />

        {/* 主体区域由各子路由渲染 */}
        <div style={{ padding: 16 }}>
          <Outlet />
        </div>
      </Frame>
    </ShopifyAppProvider>
  );
}
