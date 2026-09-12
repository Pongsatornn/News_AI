import { useState, useEffect } from "react";
import { cleanTopic, isAfter } from "../lib/format";
import { BTN_MD, COUNT_BADGE, H1, INK_BTN, INPUT, MAIN } from "../lib/ui";
import { EmptyState } from "./ui";
import { LiveResults } from "./LiveResults";

const TOPIC_SUGGESTIONS = ["ราคาทอง", "เอเชียนเกมส์", "AI", "น้ำท่วม", "ค่าเงินบาท"];

export function TopicsSection({ topicsApi, notify, onSaved, speech }) {
  const { topics, matches, add, remove, markAllSeen, maxTopics } = topicsApi;
  const [draft, setDraft]       = useState("");
  const [selected, setSelected] = useState(null);
  // เวลาที่ดูแต่ละหัวข้อครั้งก่อน (ก่อนเปิดหน้านี้) — ข่าวที่ใหม่กว่านี้ติดป้าย "ใหม่"
  const [seenBefore] = useState(() => Object.fromEntries(topics.map(t => [t.name, t.lastSeenAt])));

  // อยู่หน้านี้ถือว่าเห็นข่าวแล้ว — ตัวเลขบนแท็บจะหายไป
  useEffect(() => { markAllSeen(); }, [matches, markAllSeen]);

  const current = topics.some(t => t.name === selected) ? selected : topics[0]?.name;
  const since = name => seenBefore[name] ?? topics.find(t => t.name === name)?.lastSeenAt;
  const newIn = name => (matches[name] ?? []).filter(a => isAfter(a.published_at, since(name))).length;
  const results = matches[current] ?? [];

  function handleAdd(value) {
    const problem = add(value);
    if (problem) return notify(problem, "error");
    setDraft("");
    setSelected(cleanTopic(value));
    notify(`🔔 ติดตาม "${cleanTopic(value)}" แล้ว`);
  }

  return (
    <main className={MAIN}>
      <h1 className={H1}>ติดตามหัวข้อ</h1>
      <p className="mt-1 text-sm text-muted">
        เพิ่มคำที่สนใจ (สูงสุด {maxTopics} หัวข้อ) ระบบจะหาข่าวใหม่จากทุกสำนักให้ทุก 5 นาที และขึ้นจำนวนข่าวใหม่ที่แท็บ "ติดตาม"
      </p>
      <form onSubmit={e => { e.preventDefault(); handleAdd(draft); }} className="mt-5 flex max-w-2xl gap-2">
        <input value={draft} onChange={e => setDraft(e.target.value)} maxLength={50} aria-label="หัวข้อที่ต้องการติดตาม"
          placeholder="เช่น ราคาทอง, เอเชียนเกมส์, AI" className={INPUT}/>
        <button type="submit" className={`${BTN_MD} ${INK_BTN}`}>＋ ติดตาม</button>
      </form>
      {topics.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {topics.map(t => {
            const active = t.name === current;
            const fresh = newIn(t.name);
            return (
              <div key={t.name}
                className={`flex items-center rounded-full border transition-colors ${active ? "border-ink bg-ink text-white" : "border-line-strong bg-white text-ink"}`}>
                <button onClick={() => setSelected(t.name)} aria-pressed={active}
                  className="flex items-center gap-1.5 py-1.5 pl-3.5 pr-1 text-sm font-medium">
                  {t.name}
                  <span className={active ? "text-white/60" : "text-faint"}>{(matches[t.name] ?? []).length}</span>
                  {fresh > 0 && <span className={COUNT_BADGE}>+{fresh}</span>}
                </button>
                <button onClick={() => remove(t.name)} title="เลิกติดตาม" aria-label={`เลิกติดตาม ${t.name}`}
                  className={`py-1.5 pl-1 pr-3 text-xs ${active ? "text-white/60 hover:text-white" : "text-faint hover:text-ink"}`}>
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-sm text-muted">ลองเริ่มจาก:</span>
          {TOPIC_SUGGESTIONS.map(s => (
            <button key={s} onClick={() => handleAdd(s)}
              className="rounded-full border border-dashed border-line-strong px-3 py-1.5 text-[13px] text-muted transition-colors hover:border-ink hover:text-ink">
              ＋ {s}
            </button>
          ))}
        </div>
      )}
      <div className="mt-6">
        {topics.length === 0 && (
          <EmptyState title="ยังไม่ได้ติดตามหัวข้อไหน">พิมพ์คำที่สนใจด้านบน หรือเลือกจากคำแนะนำ แล้วข่าวที่มีคำนั้นจะขึ้นที่นี่</EmptyState>
        )}
        {current && (results.length > 0 ? (
          <>
            <p className="mb-3 text-sm text-muted">
              ข่าวล่าสุดที่มีคำว่า <strong className="text-ink">"{current}"</strong> {results.length} ข่าว จากทุกสำนักที่เราดึงข่าว
              {newIn(current) > 0 && ` · ใหม่ ${newIn(current)} ข่าว`}
            </p>
            <LiveResults key={current} results={results} notify={notify} onSaved={onSaved} speech={speech}
              isNew={a => isAfter(a.published_at, since(current))}/>
          </>
        ) : current in matches ? (
          <EmptyState title={`ยังไม่มีข่าวที่มีคำว่า "${current}"`}>เมื่อมีข่าวใหม่ จำนวนข่าวจะขึ้นที่แท็บ "ติดตาม"</EmptyState>
        ) : (
          <p className="py-10 text-center text-sm text-muted">กำลังหาข่าว…</p>
        ))}
      </div>
      {topics.length > 0 && (
        <p className="mt-6 text-xs text-faint">
          หัวข้อที่ติดตามเก็บไว้ในเบราว์เซอร์เครื่องนี้เท่านั้น — ล้างข้อมูลเบราว์เซอร์หรือเปิดจากเครื่องอื่นจะไม่เห็นรายการนี้
        </p>
      )}
    </main>
  );
}
