// app/root.jsx
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLocation } from "@remix-run/react";
import { Frame, Navigation } from "@shopify/polaris";

export default function App() {
  const location = useLocation();
  const showShell = location.pathname.startsWith("/app") || location.pathname.startsWith("/admin");

  const items = [
    { label: "Home", url: "/app", match: /^\/app\/?$/ },
    { label: "UGC — Hashtags (#)", url: "/admin/hashtagUGC", match: /^\/admin\/hashtagUGC/ },
    { label: "UGC — Mentions (@)", url: "/admin/mentionsugc", match: /^\/admin\/mentionsugc/ },
  ];
  const navItems = items.map(it => ({ label: it.label, url: it.url, selected: it.match.test(location.pathname) }));

  return (
    <html lang="en">
      <head><Meta /><Links /></head>
      <body>
        {showShell ? (
          <Frame navigation={<Navigation location={location.pathname}>
            <Navigation.Section title="UGC Acumen" items={navItems} />
          </Navigation>}>
            <div style={{ padding: 16 }}>
              <Outlet />
            </div>
          </Frame>
        ) : (
          <Outlet />
        )}
        <ScrollRestoration /><Scripts />
      </body>
    </html>
  );
}
