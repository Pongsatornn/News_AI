import { useState, useEffect, useCallback, useRef } from "react";

// ใช้ 127.0.0.1 ตรง ๆ — backend เปิดเฉพาะ IPv4 loopback ส่วน "localhost" บางเครื่องจะวิ่งไป ::1 ก่อน
export const API_BASE = "http://127.0.0.1:5000/api";
const API_TOKEN = import.meta.env.VITE_API_TOKEN;

// เรียก backend แล้วคืน JSON — error ทุกแบบกลายเป็นข้อความภาษาไทยที่แสดงให้ผู้ใช้ได้เลย
async function request(path, options) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, options);
  } catch {
    throw new Error("เชื่อมต่อ backend ไม่ได้ — รัน python api_server.py หรือยัง?");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `เซิร์ฟเวอร์ตอบกลับผิดพลาด (HTTP ${res.status})`);
  return data;
}

export function apiGet(path) {
  return request(path);
}

// endpoint ที่แก้ข้อมูล (สรุป/บันทึก) ต้องแนบ token ให้ตรงกับ API_TOKEN ใน backend/.env
export function apiPost(path, body) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(API_TOKEN && { "X-API-Token": API_TOKEN }) },
    body: JSON.stringify(body),
  });
}

export function useNews(category = null) {
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
        const qs = category ? `?category=${encodeURIComponent(category)}` : "";
        const data = await apiGet(`/news${qs}`);
        if (!cancelled) setArticles(data.results);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchArticles();
    return () => { cancelled = true; };
  }, [category, reloadKey]);

  const reload = useCallback(() => setReloadKey(k => k + 1), []);

  return { articles, setArticles, loading, error, reload };
}
