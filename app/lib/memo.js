// app/lib/memo.js
const store = new Map();

/** Cache async fn() result by key for ttlMs */
export async function memo(key, ttlMs, fn) {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.t < ttlMs) return hit.v;
  const v = await fn();
  store.set(key, { t: now, v });
  return v;
}
