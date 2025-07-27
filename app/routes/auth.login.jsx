import shopify from "../shopify.server";

export async function loader({ request }) {
  // 启动 OAuth 登录
  return shopify.auth.begin({ shopify, request });
}
