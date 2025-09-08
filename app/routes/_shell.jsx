// app/routes/_shell.jsx
import { json } from "@remix-run/node";
import { Outlet, useLocation, useLoaderData, Link, useNavigation } from "@remix-run/react";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-remix/react";
import { Frame, Navigation, Loading } from "@shopify/polaris";
import { useMemo } from "react";

export const loader = async () => {
  return json({ apiKey: process.env.SHOPIFY_API_KEY || "" });
};

// 把 Polaris 的链接组件换成 Remix Link（带 prefetch）
function RemixPolarisLink({ url, children, external, ...rest }) {
  if (external) return <a href={url} {...rest}>{children}</a>;
  return (
    <Link to={url} prefetch="intent" {...rest}>
      {children}
    </Link>
  );
}

export default function ShellLayout() {
  const { apiKey } = useLoaderData();
  const location = useLocation();
  const navigation = useNavigation();

  const items = useMemo(
    () => [
      { label: "Home", url: "/app", match: /^\/app\/?$/ },
      { label: "UGC — Hashtags (#)", url: "/admin/hashtagugc", match: /^\/admin\/hashtagugc/ },
      { label: "UGC — Mentions (@)", url: "/admin/mentionsugc", match: /^\/admin\/mentionsugc/ },
      { label: "UGC — Import by Link", url: "/admin/linkimport", match: /^\/admin\/linkimport/ },
    ],
    []
  );

  const navItems = items.map((it) => ({
    label: it.label,
    url: it.url,
    selected: it.match.test(location.pathname),
  }));

  return (
    <ShopifyAppProvider isEmbeddedApp apiKey={apiKey} linkComponent={RemixPolarisLink}>
      <Frame
        navigation={
          <Navigation location={location.pathname}>
            <Navigation.Section title="UGC Console" items={navItems} />
          </Navigation>
        }
      >
        {/* 顶部细进度条：路由在加载时显示 */}
        {navigation.state !== "idle" && <Loading />}

        <div style={{ padding: 16 }}>
          <Outlet />
        </div>
      </Frame>
    </ShopifyAppProvider>
  );
}
