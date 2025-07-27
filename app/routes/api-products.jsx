import { json } from "@remix-run/node";
import shopify from "../shopify.server";
import prisma from "../db.server";


export async function loader({ request }) {
  
  try {
    const sessionCount = await prisma.session.count();
    console.log("Session count:", sessionCount);
    return json({ success: true, sessionCount });
  } catch (err) {
    console.error("DB Error:", err);
    return json({ error: "Database connection failed" }, { status: 500 });
  }
}
