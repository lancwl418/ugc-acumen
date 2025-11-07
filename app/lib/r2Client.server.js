// app/lib/r2Client.server.js
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

/**
 * 依赖的环境变量：
 * CF_R2_ACCOUNT_ID, CF_R2_ACCESS_KEY_ID, CF_R2_SECRET_ACCESS_KEY,
 * CF_R2_BUCKET, CF_R2_PUBLIC_BASE (eg. https://<account>.r2.cloudflarestorage.com)
 */
const client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CF_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CF_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY,
  },
});

export async function r2PutObject(key, body, contentType = "application/octet-stream") {
  const bucket = process.env.CF_R2_BUCKET;
  if (!bucket) throw new Error("Missing CF_R2_BUCKET");

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));

  const base = (process.env.CF_R2_PUBLIC_BASE || "").replace(/\/+$/, "");
  if (!base) throw new Error("Missing CF_R2_PUBLIC_BASE");
  return `${base}/${key}`;
}
