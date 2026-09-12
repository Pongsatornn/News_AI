import { useState } from "react";
import { apiPost } from "../lib/api";
import { articleKey } from "../lib/format";

// สรุปผ่าน backend (API key อยู่ใน backend/.env) — ถ้ามี id จะบันทึกสรุปลง Firebase ด้วย
// เก็บว่าข่าวไหนกำลังสรุปอยู่ไว้ที่เดียว การ์ดกับหน้าต่างข่าวจะได้แสดงสถานะตรงกันและกดซ้ำไม่ได้
export function useSummariser(onDone, notify) {
  const [pending, setPending] = useState(() => new Set());

  async function summarise(article) {
    const key = articleKey(article);
    setPending(prev => new Set(prev).add(key));
    try {
      const data = await apiPost("/summarize", {
        id: article.id, title: article.title, content: article.full_content, source_url: article.source_url,
      });
      onDone(key, data.summary);
    } catch (err) {
      notify("สรุปไม่สำเร็จ: " + err.message, "error");
    } finally {
      setPending(prev => { const next = new Set(prev); next.delete(key); return next; });
    }
  }

  return { summarise, isSummarising: a => pending.has(articleKey(a)) };
}
