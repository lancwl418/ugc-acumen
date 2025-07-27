import { json } from "@remix-run/node";
import shopify from "../shopify.server"; // 确保引入你的 shopify 实例

export async function loader({ request }) {
  try {
    // 尝试获取 Shopify session
    const { session } = await shopify.authenticate.admin(request);

    console.log(">>> Shopify session:", session);

    const client = new shopify.api.clients.Rest({ session });

    // 尝试获取 active 产品
    const response = await client.get({
      path: "products",
      query: { status: "active", limit: 50 },
    });

    console.log(">>> Shopify API Response:", response.body);

    return json({ products: response.body.products || [] });
  } catch (error) {
    // 输出错误信息到日志
    console.error(">>> Error fetching products:", error);

    // fallback 假数据
    return json(
      {
        products: [
          { id: 1, title: "Fallback Product A" },
          { id: 2, title: "Fallback Product B" },
        ],
        error: "Failed to fetch products, fallback used",
      },
      { status: 200 }
    );
  }
}
