import { useState, useEffect, useRef } from "react";
import { apiPost } from "../lib/api";
import { articleKey } from "../lib/format";
import { AI_BTN, BTN_MD, INPUT } from "../lib/ui";
import { SpeakButton } from "./ui";

const ASK_SUGGESTIONS = ["สรุปสั้น ๆ ใน 1 ประโยค", "ใครได้รับผลกระทบบ้าง?", "ทำไมเรื่องนี้ถึงสำคัญ?", "มีตัวเลขสำคัญอะไรบ้าง?"];

// ถาม AI เกี่ยวกับข่าว — AI ตอบจากเนื้อข่าวเท่านั้น และส่ง 2 คำถามล่าสุดไปด้วยเพื่อให้ถามต่อเนื่องได้
export function AskSection({ article, speech, notify }) {
  const [qa, setQa]         = useState([]);
  const [draft, setDraft]   = useState("");
  const [asking, setAsking] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    if (qa.length) endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [qa]);

  async function ask(text) {
    const question = text.trim();
    if (!question || asking) return;
    const history = qa.filter(x => x.answer).slice(-2).map(({ question: q, answer: a }) => ({ question: q, answer: a }));
    setDraft("");
    setAsking(true);
    setQa(prev => [...prev, { question }]);
    const settle = patch => setQa(prev => prev.map((x, i) => (i === prev.length - 1 ? { ...x, ...patch } : x)));
    try {
      const data = await apiPost("/ask", {
        title: article.title, content: article.full_content, source_url: article.source_url, question, history,
      });
      settle({ answer: data.answer });
    } catch (err) {
      settle({ error: err.message });
    } finally {
      setAsking(false);
    }
  }

  return (
    <section className="border-t border-line px-5 py-5 sm:px-7">
      <h3 className="mb-3 text-sm font-semibold text-ink">ถาม AI เกี่ยวกับข่าวนี้</h3>
      {qa.length === 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {ASK_SUGGESTIONS.map(s => (
            <button key={s} onClick={() => ask(s)} disabled={asking}
              className="rounded-full border border-line-strong px-3 py-1.5 text-[13px] text-ink transition-colors hover:border-ink">
              {s}
            </button>
          ))}
        </div>
      )}
      {qa.length > 0 && (
        <div className="mb-3 flex flex-col gap-2.5" aria-live="polite">
          {qa.map((x, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-sm leading-normal text-white">
                {x.question}
              </div>
              {x.answer ? (
                <div className="max-w-[92%] self-start whitespace-pre-line rounded-2xl rounded-bl-md bg-wash px-3.5 py-2.5 font-read text-[15px] leading-relaxed text-graphite">
                  {x.answer}
                  <div className="-ml-2 mt-1.5">
                    <SpeakButton speech={speech} speechKey={`ask:${articleKey(article)}:${i}`} parts={[x.answer]} notify={notify} label="ฟัง"/>
                  </div>
                </div>
              ) : x.error ? (
                <div className="self-start text-sm text-red-deep">ตอบไม่สำเร็จ: {x.error}</div>
              ) : (
                <div className="self-start text-sm text-muted">AI กำลังตอบ…</div>
              )}
            </div>
          ))}
          <div ref={endRef}/>
        </div>
      )}
      <form onSubmit={e => { e.preventDefault(); ask(draft); }} className="flex gap-2">
        <input value={draft} onChange={e => setDraft(e.target.value)} maxLength={300} disabled={asking}
          placeholder="พิมพ์คำถาม เช่น เรื่องนี้กระทบใครบ้าง?" aria-label="คำถามเกี่ยวกับข่าวนี้" className={INPUT}/>
        <button type="submit" disabled={asking || !draft.trim()} className={`${BTN_MD} ${AI_BTN}`}>ถาม</button>
      </form>
      <p className="mt-2 text-xs text-faint">AI ตอบจากเนื้อหาข่าวนี้เท่านั้นและอาจผิดพลาดได้ ควรตรวจสอบกับข่าวต้นฉบับ</p>
    </section>
  );
}
