import shopify from "../shopify.server";

export async function loader({ request }) {
  // 完成 OAuth 回调
  return shopify.auth.callback({ shopify, request });
}
