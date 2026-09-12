import { useState, useEffect, useCallback } from "react";
import { apiGet } from "../lib/api";
import { cleanTopic, isAfter } from "../lib/format";

const TOPICS_KEY = "newsai.topics";
const TOPIC_POLL_MS = 5 * 60_000;
export const DEFAULT_MAX_TOPICS = 10;  // ใช้ตอนยังไม่ได้ค่าจาก /api/status

function loadTopics() {
  try {
    const saved = JSON.parse(localStorage.getItem(TOPICS_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter(t => typeof t?.name === "string" && t.name) : [];
  } catch {
    return [];
  }
}

// หัวข้อที่ติดตาม — เก็บในเบราว์เซอร์ (ไม่ต้อง login) และเช็กข่าวใหม่ทุก 5 นาที
// /api/topics ค้นจาก cache ของ feed ใน backend จึงไม่อ่าน Firestore และไม่ยิงไป Google
// จำนวนหัวข้อสูงสุดมาจาก backend (/api/status) จะได้ไม่ต้องตั้งค่าเดียวกันไว้สองที่
export function useTopics(maxTopics = DEFAULT_MAX_TOPICS) {
  const [topics, setTopics]   = useState(loadTopics);
  const [matches, setMatches] = useState({});

  useEffect(() => {
    try { localStorage.setItem(TOPICS_KEY, JSON.stringify(topics)); } catch { /* โหมดส่วนตัว — จำได้แค่รอบนี้ */ }
  }, [topics]);

  const names = topics.map(t => t.name).join("\n");
  useEffect(() => {
    if (!names) return;
    let cancelled = false;
    async function check() {
      try {
        const qs = names.split("\n").map(n => `q=${encodeURIComponent(n)}`).join("&");
        const data = await apiGet(`/topics?${qs}`);
        if (!cancelled) setMatches(data.results);
      } catch { /* backend ปิดอยู่ — ลองใหม่รอบหน้า */ }
    }
    check();
    const timer = setInterval(check, TOPIC_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [names]);

  // คืนข้อความปัญหา หรือ null ถ้าเพิ่มสำเร็จ
  function add(raw) {
    const name = cleanTopic(raw);
    if (!name) return "กรุณาพิมพ์หัวข้อ";
    if (topics.some(t => t.name.toLowerCase() === name.toLowerCase())) return `ติดตาม "${name}" อยู่แล้ว`;
    if (topics.length >= maxTopics) return `ติดตามได้สูงสุด ${maxTopics} หัวข้อ`;
    setTopics(prev => [...prev, { name, lastSeenAt: new Date().toISOString() }]);
    return null;
  }
  const remove = name => setTopics(prev => prev.filter(t => t.name !== name));
  const markAllSeen = useCallback(() => {
    const now = new Date().toISOString();
    setTopics(prev => prev.map(t => ({ ...t, lastSeenAt: now })));
  }, []);
  const totalNew = topics.reduce(
    (sum, t) => sum + (matches[t.name] ?? []).filter(a => isAfter(a.published_at, t.lastSeenAt)).length, 0);

  return { topics, matches, add, remove, markAllSeen, totalNew, maxTopics };
}
