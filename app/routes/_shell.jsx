// app/routes/_shell.jsx
import { json } from "@remix-run/node";
import { Outlet, useLocation, useLoaderData, useNavigate } from "@remix-run/react";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-remix/react";
import { Frame, Navigation } from "@shopify/polaris";
import { useMemo } from "react";

export const loader = async () => {
  return json({ apiKey: process.env.SHOPIFY_API_KEY || "" });
};

export default function ShellLayout() {
  const { apiKey } = useLoaderData();
  const location = useLocation();
  const navigate = useNavigate();

  // 左侧导航
  const items = useMemo(
    () => [
      { label: "Home", url: "/app", match: /^\/app\/?$/ },
      { label: "UGC — Hashtags (#)", url: "/admin/hashtagugc", match: /^\/admin\/hashtagugc/ },
      { label: "UGC — Mentions (@)", url: "/admin/mentionsugc", match: /^\/admin\/mentionsugc/ },
    ],
    []
  );

  // Polaris Navigation 支持 onClick；我们用 client 跳转更顺滑
  const navItems = items.map((it) => ({
    label: it.label,
    url: it.url,
    selected: it.match.test(location.pathname),
    onClick: () => navigate(it.url),
  }));

  return (
    <ShopifyAppProvider isEmbeddedApp apiKey={apiKey}>
      <Frame
        navigation={
          <Navigation location={location.pathname}>
            <Navigation.Section title="UGC Console" items={navItems} />
          </Navigation>
        }
      >
        {/* 悬停预取，提升点击响应 */}
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
        <div style={{ padding: 16 }}>
          <Outlet />
        </div>
      </Frame>
    </ShopifyAppProvider>
  );
}
