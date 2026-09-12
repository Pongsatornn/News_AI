import { useState, useEffect, useCallback, useRef } from "react";
import { apiGet } from "../lib/api";

// ข่าวในหน้าหลัก — เปลี่ยนหมวดหรือกดโหลดเพิ่มแล้วดึงใหม่
export function useNews(category = null, limit = 100) {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const shownCategory = useRef(undefined);

  useEffect(() => {
    let cancelled = false;
    async function fetchArticles() {
      // เปลี่ยนหมวด → ล้างรายการเก่า / รีเฟรชหมวดเดิม → แสดงข่าวเดิมไว้ระหว่างโหลด หน้าจะได้ไม่กระพริบ
      if (shownCategory.current !== category) setArticles([]);
      shownCategory.current = category;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit });
        if (category) params.set("category", category);
        const data = await apiGet(`/news?${params}`);
        if (!cancelled) setArticles(data.results);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchArticles();
    return () => { cancelled = true; };
  }, [category, limit, reloadKey]);

  const reload = useCallback(() => setReloadKey(k => k + 1), []);

  return { articles, setArticles, loading, error, reload };
}
