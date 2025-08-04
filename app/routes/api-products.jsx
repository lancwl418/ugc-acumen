import { json } from "@remix-run/node";
import fs from "fs/promises";
import path from "path";

export async function loader() {
  const filePath = path.resolve("public/products.json");
  const rawData = await fs.readFile(filePath, "utf-8");
  const products = JSON.parse(rawData);

  return json({ products }, {
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  }
  });
}
