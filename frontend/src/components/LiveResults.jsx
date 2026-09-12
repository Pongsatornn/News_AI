import { useState } from "react";
import { apiPost } from "../lib/api";
import { articleKey } from "../lib/format";
import { BTN_MD, NEWS_GRID, OUTLINE_BTN, SEARCH_PAGE_SIZE } from "../lib/ui";
import { useSummariser } from "../hooks/useSummariser";
import { NewsCard } from "./NewsCard";
import { ArticleModal } from "./ArticleModal";

// การ์ดข่าวสดจาก RSS/Google ที่ยังไม่ได้บันทึก — ใช้ร่วมกันระหว่างหน้าค้นหาและหน้าติดตามหัวข้อ
// สรุป/บันทึก/เปิดหน้าต่างข่าวได้ และแสดงทีละ 20 ข่าว
// visible = หน้านี้กำลังแสดงอยู่ไหม — หน้าค้นหาถูกซ่อนไว้ (ไม่ได้ถอดออก) เพื่อให้ผลค้นหาอยู่ครบตอนกลับมา
// ถ้าไม่เช็ก หน้าต่างข่าวที่เปิดค้างไว้จะยังล็อกไม่ให้หน้าอื่นเลื่อนทั้งที่มองไม่เห็นแล้ว
export function LiveResults({ results, notify, onSaved, speech, isNew, visible = true }) {
  const [savedUrls, setSavedUrls] = useState(new Set());
  const [activeKey, setActiveKey] = useState(null);
  const [summaries, setSummaries] = useState({});
  const [visibleCount, setVisibleCount] = useState(SEARCH_PAGE_SIZE);
  const { summarise, isSummarising } = useSummariser(
    (key, summary) => setSummaries(prev => ({ ...prev, [key]: summary })),
    notify,
  );

  async function handleSave(article) {
    try {
      const data = await apiPost("/save", article);
      setSavedUrls(prev => new Set([...prev, article.source_url]));
      notify(data.duplicate ? "มีข่าวนี้ในหน้าหลักอยู่แล้ว" : "✓ บันทึกลงหน้าหลักแล้ว");
      if (!data.duplicate) onSaved();
    } catch (err) { notify("บันทึกไม่สำเร็จ: " + err.message, "error"); }
  }

  const enriched = results.map(a => ({ ...a, summary: summaries[articleKey(a)] || a.summary }));
  const active = enriched.find(a => articleKey(a) === activeKey);

  return (
    <>
      <div className={NEWS_GRID}>
        {enriched.slice(0, visibleCount).map(a => (
          <NewsCard key={articleKey(a)} article={a} onOpen={a => setActiveKey(articleKey(a))}
            onSummarise={summarise} summarising={isSummarising(a)} showSave
            onSave={handleSave} saved={savedUrls.has(a.source_url)} isNew={isNew?.(a) ?? false}/>
        ))}
      </div>
      {enriched.length > visibleCount && (
        <div className="mt-6 text-center">
          <button onClick={() => setVisibleCount(v => v + SEARCH_PAGE_SIZE)} className={`${BTN_MD} ${OUTLINE_BTN}`}>
            แสดงเพิ่ม (เหลืออีก {enriched.length - visibleCount} ข่าว)
          </button>
        </div>
      )}
      {visible && active && <ArticleModal article={active} onClose={() => { speech.stop(); setActiveKey(null); }}
        onSummarise={summarise} summarising={isSummarising(active)} speech={speech} notify={notify}/>}
    </>
  );
}
