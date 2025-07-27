import { json } from "@remix-run/node";
import shopify from "../shopify.server";

export async function loader({ request }) {
  try {
    console.log(">>> Entering api-products loader");

    const { session } = await shopify.authenticate.admin(request);
    console.log(">>> Shopify session:", session);

    if (!session) {
      throw new Error("Shopify session not found. Possibly not authenticated.");
    }

    const client = new shopify.api.clients.Rest({ session });
    const response = await client.get({
      path: "products",
      query: { status: "active", limit: 50 },
    });

    console.log(">>> Shopify API response:", response.body);

    return json({ products: response.body.products || [] });
  } catch (error) {
    console.error(">>> Error fetching products:", error);
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
