export async function loader({ request }) {
    if (!token) {
      return json(
        { error: "Missing INSTAGRAM_ACCESS_TOKEN" },
        {
          status: 500,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        }
      );
    }
  
    const url = new URL(request.url);
    const filterCategory = url.searchParams.get("category");
    const limit = Number(url.searchParams.get("limit") || 0);
    const offset = Number(url.searchParams.get("offset") || 0);
  
    await ensureVisibleHashtagFile();
    const visible = await readJsonSafe(VISIBLE_HASHTAG_PATH, "[]");
  
    // 先按 category 过滤
    let toFetch = filterCategory
      ? visible.filter((v) => v.category === filterCategory)
      : visible.slice();
  
    const total = toFetch.length;
  
    if (limit > 0) {
      toFetch = toFetch.slice(offset, offset + limit);
    }
  
    const fields =
      "id,media_url,permalink,caption,media_type,timestamp,thumbnail_url";
    const concurrency = 6;
  
    const failed = [];
    const results = await mapWithConcurrency(toFetch, concurrency, async (entry) => {
      try {
        const res = await fetch(
          `https://graph.facebook.com/v23.0/${entry.id}?fields=${fields}&access_token=${token}`
        );
        const data = await res.json();
  
        if (!data || data.error) {
          failed.push({
            id: entry.id,
            category: entry.category || null,
            reason: data?.error?.message || "unknown_error",
            code: data?.error?.code || null,
          });
          return null;
        }
  
        return {
          id: data.id,
          media_url: data.media_url,
          media_type: data.media_type,
          caption: data.caption || "",
          permalink: data.permalink,
          timestamp: data.timestamp || "",
          category: entry.category || null, // 保存时的分类
          products: entry.products || [],
          thumbnail_url: data.thumbnail_url || null,
        };
      } catch (e) {
        failed.push({
          id: entry.id,
          category: entry.category || null,
          reason: e?.message || "fetch_failed",
          code: null,
        });
        return null;
      }
    });
  
    const ok = results.filter(Boolean);
    ok.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
  
    return json(
      { media: ok, total, failed }, // 多了 failed
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Cache-Control": "public, max-age=60",
        },
      }
    );
  }
  