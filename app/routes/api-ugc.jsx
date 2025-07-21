import { json } from "@remix-run/node";
import fs from "fs/promises";
import path from "path";

export async function loader() {
  const filePath = path.resolve("public/ugc.json");
  const content = await fs.readFile(filePath, "utf-8");
  return json(JSON.parse(content));
}
