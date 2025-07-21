// routes/api-products.jsx
import { json } from "@remix-run/node";

export async function loader() {
    const res = await fetch("https://www.google.com");
    const text = await res.text();
    return new Response(text);
  }
