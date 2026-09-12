import { useState, useEffect, useRef } from "react";
import { articleKey, excerptOf, hasSummary, sourceName } from "../lib/format";
import { AI_BTN, BTN_MD, BTN_SM, DANGER_BTN, INK_BTN, SWEEP_DELAY } from "../lib/ui";
import { AiTag, ArticleMeta, SpeakButton } from "./ui";
import { AskSection } from "./AskSection";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])';

export function ArticleModal({ article, onClose, onSummarise, summarising, speech, notify, onDelete }) {
  const [imgFailed, setImgFailed] = useState(false);
  const panelRef = useRef(null);
  // เก็บ onClose ล่าสุดไว้ใน ref — effect ด้านล่างต้องทำงานแค่ตอนเปิด/ปิด ถ้าใส่ onClose เป็น dependency
  // โฟกัสจะเด้งกลับมาที่หน้าต่างทุกครั้งที่ parent เรนเดอร์ใหม่ (เช่นตอน AI สรุปเสร็จ) แล้วแย่งเคอร์เซอร์จากช่องถาม
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  // ใช้คีย์บอร์ดแล้วต้องวนอยู่ในหน้าต่างข่าว (focus trap) — Tab ไม่หลุดไปโดนการ์ดที่อยู่ข้างหลัง
  // และปิดแล้วโฟกัสกลับไปที่ปุ่มเดิม ผู้ใช้ screen reader จะได้ไม่หลงทาง
  useEffect(() => {
    const opener = document.activeElement;
    const panel = panelRef.current;
    panel?.focus();
    function onKey(e) {
      if (e.key === "Escape") return closeRef.current();
      if (e.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  // หน้าต่างข่าวเปิดอยู่ — ไม่ให้หน้าด้านหลังเลื่อนตาม
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  if (!article) return null;
  const bullets = hasSummary(article) ? article.summary : [];
  const excerpt = excerptOf(article.full_content);
  const showImage = article.image_url && !imgFailed;

  function handleDelete() {
    if (window.confirm(`ลบข่าว "${article.title}" ออกจากหน้าหลัก?`)) onDelete(article);
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4">
      {/* มือถือเลื่อนขึ้นจากด้านล่าง (bottom sheet) จอใหญ่อยู่กลางจอ */}
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="article-title"
        className="relative flex max-h-[92vh] w-full max-w-xl flex-col overflow-y-auto rounded-t-2xl bg-white outline-none sm:rounded-2xl">
        <button onClick={onClose} aria-label="ปิด"
          className="absolute right-3 top-3 z-10 flex size-9 items-center justify-center rounded-full bg-white/90 text-ink shadow-sm hover:bg-white">
          ✕
        </button>
        {showImage && <img src={article.image_url} alt="" referrerPolicy="no-referrer" onError={() => setImgFailed(true)}
          className="aspect-video w-full shrink-0 object-cover"/>}
        <div className={`px-5 pt-5 sm:px-7 sm:pt-6 ${showImage ? "" : "pr-14 sm:pr-16"}`}>
          <ArticleMeta article={article}/>
          <h2 id="article-title" className="mt-2 text-xl font-bold leading-snug text-ink sm:text-2xl">{article.title}</h2>
        </div>

        <section className="px-5 py-5 sm:px-7">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3><AiTag/></h3>
            {bullets.length > 0 && <SpeakButton speech={speech} speechKey={`article:${articleKey(article)}`}
              parts={[article.title, ...bullets]} notify={notify}/>}
          </div>
          {bullets.length > 0 ? (
            <ul className="space-y-3 font-read text-[15px] leading-[1.8] text-graphite">
              {bullets.map((b, i) => (
                <li key={i}>
                  <span className={`highlight motion-safe:animate-marker ${SWEEP_DELAY[i] ?? ""}`}>{b}</span>
                </li>
              ))}
            </ul>
          ) : summarising ? (
            <div className="space-y-2.5" aria-live="polite">
              <p className="text-sm text-muted">AI กำลังอ่านข่าวและสรุป…</p>
              {["w-[92%]", "w-[78%]", "w-[85%]"].map(w => (
                <div key={w} className={`h-3.5 rounded bg-wash motion-safe:animate-pulse ${w}`}/>
              ))}
            </div>
          ) : article.can_summarize ? (
            <div className="space-y-4">
              {excerpt && <p className="font-read text-[15px] leading-relaxed text-muted">{excerpt}</p>}
              <button onClick={() => onSummarise(article)} className={`${BTN_MD} ${AI_BTN}`}>✦ สรุปด้วย AI</button>
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-muted">
              ข่าวนี้มีแค่หัวข้อ ไม่มีเนื้อหาให้ AI สรุป — อ่านรายละเอียดได้จากข่าวต้นฉบับด้านล่าง
            </p>
          )}
        </section>
        {article.can_summarize && <AskSection article={article} speech={speech} notify={notify}/>}
        <div className="sticky bottom-0 mt-auto border-t border-line bg-white px-5 py-4 sm:px-7">
          <a href={article.source_url} target="_blank" rel="noopener noreferrer" className={`${BTN_MD} ${INK_BTN} w-full`}>
            อ่านข่าวเต็มที่ {sourceName(article.source)} ↗
          </a>
          {/* ลบได้เฉพาะข่าวที่บันทึกอยู่ในหน้าหลัก (มี document id) */}
          {onDelete && (
            <div className="mt-1 text-center">
              <button onClick={handleDelete} className={`${BTN_SM} ${DANGER_BTN}`}>ลบข่าวนี้ออกจากหน้าหลัก</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
