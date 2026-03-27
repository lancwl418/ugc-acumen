// app/routes/api-products.jsx
import { json } from "@remix-run/node";
import prisma from "../db.server.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  const products = await prisma.product.findMany();
  return json({ products }, { headers: CORS });
}
