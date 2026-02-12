// app/routes/api.customer-search.jsx
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();

  if (!q || q.length < 2) {
    return json({ customers: [] });
  }

  const response = await admin.graphql(
    `#graphql
      query searchCustomers($query: String!) {
        customers(first: 5, query: $query) {
          edges {
            node {
              id
              displayName
              email
            }
          }
        }
      }
    `,
    { variables: { query: q } },
  );

  const body = await response.json();
  const edges = body?.data?.customers?.edges || [];

  const customers = edges.map(({ node }) => ({
    customerId: node.id,
    displayName: node.displayName,
    email: node.email || "",
  }));

  return json({ customers });
}
