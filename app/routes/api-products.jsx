import { json } from "@remix-run/node";
import shopify from "../shopify.server";

export async function loader({ request }) {
  try {
    // 获取管理员权限
    const { session } = await shopify.authenticate.admin(request);

    const client = new shopify.api.clients.Rest({ session });

    // 获取所有 active 产品
    const response = await client.get({
      path: "products",
      query: { status: "active", limit: 250 },
    });

    // 返回产品列表
    return json({ products: response.body.products });
  } catch (error) {
    console.error("Error fetching products:", error);
    return json({ error: "Failed to fetch products" }, { status: 500 });
  }
}
