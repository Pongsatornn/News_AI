import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNews, apiGet, apiPost } from "./hooks/useNews";

const CATEGORIES = [
  { key: null,            label: "ทั้งหมด" },
  { key: "general",       label: "ทั่วไป" },
  { key: "politics",      label: "การเมือง" },
  { key: "sports",        label: "กีฬา" },
  { key: "technology",    label: "เทคโนโลยี" },
  { key: "entertainment", label: "บันเทิง" },
  { key: "business",      label: "ธุรกิจ" },
];
const CATEGORY_BY_KEY = Object.fromEntries(CATEGORIES.filter(c => c.key).map(c => [c.key, c]));

const TABS = [
  { key: "home",     label: "หน้าหลัก" },
  { key: "briefing", label: "สรุปวันนี้" },
  { key: "topics",   label: "ติดตาม" },
  { key: "search",   label: "ค้นหา" },
];

// ── class ของ Tailwind ที่ใช้ซ้ำ — สีตั้งไว้ใน index.css (ink = หมึกปากกาน้ำเงิน, marker = ปากกาเน้นข้อความ) ──
const CONTAINER   = "mx-auto w-full max-w-7xl px-4 sm:px-6";
const MAIN        = `${CONTAINER} py-6 sm:py-8`;
const H1          = "text-2xl font-bold tracking-tight text-ink sm:text-3xl";
const NEWS_GRID   = "grid gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4";
const INPUT       = "min-w-0 flex-1 rounded-lg border border-line-strong bg-white px-3.5 py-2.5 text-[15px] text-graphite placeholder:text-faint outline-none transition-colors focus:border-pen focus:ring-3 focus:ring-pen/15";
const ERROR_BOX   = "mb-4 rounded-lg border border-red/20 bg-red-soft px-4 py-3 text-sm text-red-deep";
const COUNT_BADGE = "rounded-full bg-red px-1.5 text-[11px] font-bold leading-4 text-white";
const BTN         = "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition-colors disabled:cursor-default";
const BTN_SM      = `${BTN} px-3 py-1.5 text-[13px]`;
const BTN_MD      = `${BTN} px-4 py-2.5 text-sm`;
// สีเหลืองของปากกาเน้นข้อความ = ปุ่มที่สั่งให้ AI ทำงาน (สรุป, ถาม, สร้างสรุปข่าวเด่น)
const AI_BTN      = "bg-marker text-ink hover:bg-marker-deep disabled:bg-wash disabled:text-faint";
const INK_BTN     = "bg-ink text-white hover:bg-ink-deep disabled:bg-wash disabled:text-faint";
const OUTLINE_BTN = "border border-line-strong bg-white text-ink hover:border-ink disabled:border-line disabled:text-faint";
const GHOST_BTN   = "text-muted hover:bg-wash hover:text-ink";
// ไฮไลต์ข้อสรุปปาดตามกันทีละข้อ
const SWEEP_DELAY = ["", "[animation-delay:150ms]", "[animation-delay:300ms]", "[animation-delay:450ms]", "[animation-delay:600ms]"];

// source ใน DB เป็น key เช่น "thairath_sport" → แสดงชื่อสำนักข่าวภาษาไทย
const SOURCE_NAMES = {
  matichon: "มติชน", thairath: "ไทยรัฐ", khaosod: "ข่าวสด", prachachat: "ประชาชาติ",
  sanook: "Sanook", blognone: "Blognone", beartai: "แบไต๋", google_news: "Google News",
};
function sourceName(source) {
  return SOURCE_NAMES[source] || SOURCE_NAMES[source?.split("_")[0]] || source;
}

// ข่าวจาก Google News ไม่มีรูป → ใช้โลโก้ของสำนักข่าวแทน
function logoUrl(publisherUrl) {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(publisherUrl).hostname}&sz=128`;
  } catch {
    return null;
  }
}

// ตัวอย่างเนื้อข่าว — ข่าวเก่าใน Firestore ยังมี HTML ปน จึงตัดแท็กออกก่อน
function excerptOf(text, max = 280) {
  const plain = (text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max).trimEnd()}…` : plain;
}

const rtf = new Intl.RelativeTimeFormat("th", { numeric: "auto" });
function timeAgo(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return "";
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1)       return "เมื่อสักครู่";
  if (mins < 60)      return rtf.format(-mins, "minute");
  if (mins < 1440)    return rtf.format(-Math.round(mins / 60), "hour");
  if (mins < 1440 * 7) return rtf.format(-Math.round(mins / 1440), "day");
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
}

// backend ดึงข่าวเองทุก ~30 นาที — เช็กทุก 1 นาทีว่ารอบใหม่เสร็จหรือยัง (/status ไม่อ่าน Firestore)
const STATUS_POLL_MS = 60_000;

// ข่าวในหน้าหลักมี document id ส่วนผลค้นหายังไม่ได้บันทึกจึงใช้ URL แทน
const articleKey = a => a.id || a.source_url;
const hasSummary = a => Array.isArray(a.summary) && a.summary.length > 0;

// สรุปผ่าน backend (API key อยู่ใน backend/.env) — ถ้ามี id จะบันทึกสรุปลง Firebase ด้วย
// เก็บว่าข่าวไหนกำลังสรุปอยู่ไว้ที่เดียว การ์ดกับหน้าต่างข่าวจะได้แสดงสถานะตรงกันและกดซ้ำไม่ได้
function useSummariser(onDone, notify) {
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

function fetchStatusText(lastFetch) {
  if (lastFetch?.running) return "⏳ กำลังดึงข่าวใหม่...";
  if (!lastFetch?.finished_at) return "";
  const summarized = lastFetch.summarized ? ` · AI สรุปรอไว้ ${lastFetch.summarized} ข่าว` : "";
  return `ดึงข่าวใหม่ล่าสุด ${timeAgo(lastFetch.finished_at)}${summarized}`;
}

// อ่านออกเสียงด้วยเสียงภาษาไทยที่มีในเครื่อง (Web Speech API ของเบราว์เซอร์) — ไม่ใช้ backend และไม่ใช้โควตา AI
function useSpeech() {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [speakingKey, setSpeakingKey] = useState(null);

  useEffect(() => () => { if (supported) window.speechSynthesis.cancel(); }, [supported]);

  const stop = useCallback(() => {
    if (supported) window.speechSynthesis.cancel();
    setSpeakingKey(null);
  }, [supported]);

  // คืน true ถ้าเครื่องนี้ไม่มีเสียงภาษาไทย จะได้บอกผู้ใช้
  function speak(key, parts) {
    const synth = window.speechSynthesis;
    synth.cancel();
    const voices = synth.getVoices();
    const thai = voices.find(v => v.lang?.toLowerCase().replace("_", "-").startsWith("th"));
    const done = () => setSpeakingKey(k => (k === key ? null : k));
    // อ่านทีละข้อ — Chrome ตัดเสียงเองถ้าข้อความเดียวยาวเกินราว 15 วินาที
    parts.filter(Boolean).forEach((text, i, all) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "th-TH";
      if (thai) utterance.voice = thai;
      if (i === all.length - 1) utterance.onend = done;
      utterance.onerror = done;
      synth.speak(utterance);
    });
    setSpeakingKey(key);
    return voices.length > 0 && !thai;
  }

  return { supported, speakingKey, speak, stop };
}

function SpeakerIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 shrink-0">
      <path d="M9.5 4 5.5 7.5H3v5h2.5l4 3.5V4Z" fill="currentColor"/>
      <path d="M12.5 7.5a3.5 3.5 0 0 1 0 5M14.5 5.5a6.5 6.5 0 0 1 0 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  );
}

function SpeakButton({ speech, speechKey, parts, notify, label = "ฟังสรุป" }) {
  if (!speech.supported || parts.length === 0) return null;
  const active = speech.speakingKey === speechKey;
  function toggle() {
    if (active) return speech.stop();
    if (speech.speak(speechKey, parts)) {
      notify("เครื่องนี้ยังไม่มีเสียงอ่านภาษาไทย — ใช้ Microsoft Edge หรือเพิ่มเสียงไทยที่ Settings › Time & language › Speech", "error");
    }
  }
  return (
    <button onClick={toggle} aria-pressed={active} className={`${BTN_SM} ${active ? INK_BTN : GHOST_BTN}`}>
      <SpeakerIcon/>{active ? "หยุดอ่าน" : label}
    </button>
  );
}

// ป้ายสีเหลือง = ข้อความนี้ AI เป็นคนสรุป
function AiTag() {
  return <span className="whitespace-nowrap rounded-sm bg-marker px-1.5 py-px font-sans text-xs font-semibold text-ink">✦ สรุปโดย AI</span>;
}

// หัวข้อย่อยของสรุป — ขีดปากกาเน้นข้อความสั้น ๆ แทนตัวเลข เพราะข้อสรุปไม่ได้เรียงลำดับ
function Dash() {
  return <span aria-hidden="true" className="mt-[0.6em] h-1.5 w-3 shrink-0 rounded-sm bg-marker"/>;
}

function ArticleMeta({ article, isNew = false }) {
  const cat = CATEGORY_BY_KEY[article.category];
  const details = [cat?.label ?? article.category, timeAgo(article.published_at)].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-faint">
      {isNew && <span className="rounded bg-red px-1.5 py-px font-semibold text-white">ใหม่</span>}
      <span className="font-semibold text-ink">{sourceName(article.source)}</span>
      {details.map(text => (
        <React.Fragment key={text}><span aria-hidden="true">·</span><span>{text}</span></React.Fragment>
      ))}
    </div>
  );
}

function EmptyState({ title, children }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong px-6 py-14 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {children && <p className="mt-1 text-sm text-muted">{children}</p>}
    </div>
  );
}

const SEARCH_PAGE_SIZE = 20;

function SkeletonCards({ count = 6 }) {
  return Array.from({ length: count }).map((_, i) => (
    <div key={i} className="flex gap-3 overflow-hidden rounded-xl border border-line bg-white p-3 motion-safe:animate-pulse sm:flex-col sm:gap-0 sm:p-0">
      <div className="size-24 shrink-0 rounded-lg bg-wash sm:aspect-video sm:size-auto sm:w-full sm:rounded-none"/>
      <div className="flex-1 space-y-2.5 sm:p-4">
        <div className="h-3 w-2/5 rounded bg-wash"/>
        <div className="h-4 rounded bg-wash"/>
        <div className="h-4 w-4/5 rounded bg-wash"/>
      </div>
    </div>
  ));
}

// ใจความจากสรุปของ AI บนการ์ด — การ์ดทั่วไปโชว์ข้อแรก การ์ดข่าวเด่นโชว์ 3 ข้อ
function SummaryPreview({ bullets, lead }) {
  if (!lead) {
    return (
      <p className="line-clamp-2 font-read text-sm leading-relaxed text-graphite sm:line-clamp-3">
        <AiTag/> {bullets[0]}
      </p>
    );
  }
  return (
    <div className="mt-1">
      <AiTag/>
      <ul className="mt-2.5 space-y-2 font-read text-[15px] leading-relaxed text-graphite">
        {bullets.slice(0, 3).map((b, i) => (
          <li key={i} className="flex gap-2.5"><Dash/><span>{b}</span></li>
        ))}
      </ul>
    </div>
  );
}

// lead = การ์ดใหญ่ของข่าวล่าสุด บนมือถือการ์ดอื่นเป็นแถว (รูปเล็กซ้าย) จะได้เห็นหลายข่าวต่อจอ
function NewsCard({ article, lead = false, onOpen, onSummarise, summarising, showSave = false, onSave, saved, isNew = false }) {
  const [imgFailed, setImgFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const logo = article.publisher_url && !logoFailed ? logoUrl(article.publisher_url) : null;
  const done = hasSummary(article);
  const canSummarise = !done && article.can_summarize;
  const excerpt = lead && !done ? excerptOf(article.full_content, 220) : "";

  // เปิดหน้าต่างข่าวทันที แล้วสรุปจะขึ้นในนั้นเมื่อ AI ตอบกลับ
  function handleSummarise() {
    onOpen(article);
    onSummarise(article);
  }

  return (
    <article className={`group relative flex overflow-hidden rounded-xl border border-line bg-white transition-colors hover:border-line-strong
      ${lead ? "flex-col sm:col-span-2 sm:row-span-2" : "gap-3 p-3 sm:flex-col sm:gap-0 sm:p-0"}`}>
      <div className={`flex shrink-0 items-center justify-center overflow-hidden bg-wash
        ${lead ? "aspect-video" : "size-24 rounded-lg sm:aspect-video sm:size-auto sm:w-full sm:rounded-none"}`}>
        {article.image_url && !imgFailed
          ? <img src={article.image_url} alt="" loading={lead ? "eager" : "lazy"} referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)} className="h-full w-full object-cover"/>
          : logo
            ? <img src={logo} alt="" referrerPolicy="no-referrer" onError={() => setLogoFailed(true)}
                className="size-12 rounded-lg bg-white p-1 shadow-sm"/>
            : <span className="px-2 text-center text-sm font-semibold text-faint">{sourceName(article.source)}</span>}
      </div>

      <div className={`flex min-w-0 flex-1 flex-col gap-1.5 ${lead ? "p-4 sm:p-6" : "sm:p-4"}`}>
        <ArticleMeta article={article} isNew={isNew}/>
        <h3 className={lead ? "text-xl font-bold leading-snug sm:text-[26px]" : "text-[15px] font-semibold leading-snug sm:text-base"}>
          {/* ปุ่มหัวข่าวขยายเต็มการ์ด (after:inset-0) — กดตรงไหนของการ์ดก็เปิดข่าว และกดด้วยคีย์บอร์ดได้ */}
          <button onClick={() => onOpen(article)}
            className="block w-full text-left text-ink transition-colors group-hover:text-pen focus-visible:outline-none
              after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-pen">
            <span className={lead ? "" : "line-clamp-3"}>{article.title}</span>
          </button>
        </h3>
        {done && <SummaryPreview bullets={article.summary} lead={lead}/>}
        {excerpt && <p className="line-clamp-3 font-read text-[15px] leading-relaxed text-muted">{excerpt}</p>}
        {/* ข่าวที่ไม่มีเนื้อหา (เช่น Google News มีแค่หัวข้อ) ไม่แสดงปุ่มสรุป */}
        {(canSummarise || showSave) && (
          <div className="relative z-10 mt-auto flex flex-wrap gap-2 pt-2">
            {canSummarise && (
              <button onClick={handleSummarise} disabled={summarising} className={`${BTN_SM} ${AI_BTN}`}>
                {summarising ? "กำลังสรุป…" : "✦ สรุปด้วย AI"}
              </button>
            )}
            {showSave && (
              <button onClick={() => onSave(article)} disabled={saved} className={`${BTN_SM} ${OUTLINE_BTN}`}>
                {saved ? "✓ บันทึกแล้ว" : "บันทึกลงหน้าหลัก"}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

const ASK_SUGGESTIONS = ["สรุปสั้น ๆ ใน 1 ประโยค", "ใครได้รับผลกระทบบ้าง?", "ทำไมเรื่องนี้ถึงสำคัญ?", "มีตัวเลขสำคัญอะไรบ้าง?"];

// ถาม AI เกี่ยวกับข่าว — AI ตอบจากเนื้อข่าวเท่านั้น และส่ง 2 คำถามล่าสุดไปด้วยเพื่อให้ถามต่อเนื่องได้
function AskSection({ article, speech, notify }) {
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

function ArticleModal({ article, onClose, onSummarise, summarising, speech, notify }) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4">
      {/* มือถือเลื่อนขึ้นจากด้านล่าง (bottom sheet) จอใหญ่อยู่กลางจอ */}
      <div role="dialog" aria-modal="true" aria-labelledby="article-title"
        className="relative flex max-h-[92vh] w-full max-w-xl flex-col overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl">
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
        </div>
      </div>
    </div>
  );
}

// แจ้งผลแบบหายเอง แทน alert() ที่ต้องกดปิดทุกครั้ง
function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div role="status"
      className={`fixed bottom-5 left-1/2 z-60 w-max max-w-[calc(100%-32px)] -translate-x-1/2 rounded-lg px-4 py-2.5
        text-sm leading-normal text-white shadow-lift ${toast.type === "error" ? "bg-red-deep" : "bg-ink"}`}>
      {toast.message}
    </div>
  );
}

// การ์ดข่าวสดจาก RSS/Google ที่ยังไม่ได้บันทึก — ใช้ร่วมกันระหว่างหน้าค้นหาและหน้าติดตามหัวข้อ
// สรุป/บันทึก/เปิดหน้าต่างข่าวได้ และแสดงทีละ 20 ข่าว
function LiveResults({ results, notify, onSaved, speech, isNew }) {
  const [savedUrls, setSavedUrls] = useState(new Set());
  const [activeKey, setActiveKey] = useState(null);
  const [summaries, setSummaries] = useState({});
  const [visible, setVisible]     = useState(SEARCH_PAGE_SIZE);
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
        {enriched.slice(0, visible).map(a => (
          <NewsCard key={articleKey(a)} article={a} onOpen={a => setActiveKey(articleKey(a))}
            onSummarise={summarise} summarising={isSummarising(a)} showSave
            onSave={handleSave} saved={savedUrls.has(a.source_url)} isNew={isNew?.(a) ?? false}/>
        ))}
      </div>
      {enriched.length > visible && (
        <div className="mt-6 text-center">
          <button onClick={() => setVisible(v => v + SEARCH_PAGE_SIZE)} className={`${BTN_MD} ${OUTLINE_BTN}`}>
            แสดงเพิ่ม (เหลืออีก {enriched.length - visible} ข่าว)
          </button>
        </div>
      )}
      {active && <ArticleModal article={active} onClose={() => { speech.stop(); setActiveKey(null); }}
        onSummarise={summarise} summarising={isSummarising(active)} speech={speech} notify={notify}/>}
    </>
  );
}

function SearchSection({ notify, onSaved, speech }) {
  const [keyword, setKeyword]   = useState("");
  const [results, setResults]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [searchId, setSearchId] = useState(0);  // เปลี่ยนทุกครั้งที่ค้นใหม่ — ผลชุดใหม่เริ่มแสดงจาก 20 ข่าวแรก

  async function handleSearch(e) {
    e.preventDefault();
    if (!keyword.trim()) return;
    setLoading(true); setError(null); setResults([]); setSearchId(id => id + 1);
    try {
      const data = await apiGet(`/search?q=${encodeURIComponent(keyword)}`);
      setResults(data.results);
      if (data.results.length === 0) setError("ไม่พบข่าวที่เกี่ยวข้อง");
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <main className={MAIN}>
      <h1 className={H1}>ค้นหาข่าว</h1>
      <p className="mt-1 text-sm text-muted">ค้นจากทุกสำนักที่เราดึงข่าวและ Google News — พิมพ์หลายคำคั่นด้วยเว้นวรรค จะได้ข่าวที่มีครบทุกคำ</p>
      <form onSubmit={handleSearch} className="mt-5 flex max-w-2xl gap-2">
        <input value={keyword} onChange={e => setKeyword(e.target.value)} aria-label="คำค้นหา"
          placeholder="พิมพ์คีย์เวิร์ด เช่น เลือกตั้ง, AI, ฟุตบอล..." className={INPUT}/>
        <button type="submit" disabled={loading} className={`${BTN_MD} ${INK_BTN}`}>
          {loading ? "กำลังค้น..." : "ค้นหา"}
        </button>
      </form>
      <div className="mt-6">
        {error && <div className={ERROR_BOX}>{error}</div>}
        {loading && <div className={NEWS_GRID}><SkeletonCards/></div>}
        {results.length > 0 && (
          <>
            <p className="mb-3 text-sm text-muted">พบ {results.length} ข่าว เรียงจากใหม่ไปเก่า</p>
            <LiveResults key={searchId} results={results} notify={notify} onSaved={onSaved} speech={speech}/>
          </>
        )}
      </div>
    </main>
  );
}

const TOPICS_KEY = "newsai.topics";
const TOPIC_POLL_MS = 5 * 60_000;
const MAX_TOPICS = 10;
const TOPIC_SUGGESTIONS = ["ราคาทอง", "เอเชียนเกมส์", "AI", "น้ำท่วม", "ค่าเงินบาท"];
const BASE_TITLE = "NewsAI — สรุปข่าวไทยด้วย AI";

const isAfter = (iso, since) => Boolean(iso) && new Date(iso) > new Date(since ?? 0);
const cleanTopic = raw => raw.trim().replace(/\s+/g, " ").slice(0, 50);

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
function useTopics() {
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
    if (topics.length >= MAX_TOPICS) return `ติดตามได้สูงสุด ${MAX_TOPICS} หัวข้อ`;
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

  return { topics, matches, add, remove, markAllSeen, totalNew };
}

function TopicsSection({ topicsApi, notify, onSaved, speech }) {
  const { topics, matches, add, remove, markAllSeen } = topicsApi;
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
      <p className="mt-1 text-sm text-muted">เพิ่มคำที่สนใจ ระบบจะหาข่าวใหม่จากทุกสำนักให้ทุก 5 นาที และขึ้นจำนวนข่าวใหม่ที่แท็บ "ติดตาม"</p>
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
    </main>
  );
}

function formatThaiDate(date) {
  const d = new Date(`${date}T12:00:00+07:00`);
  return isNaN(d) ? "" : d.toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function BriefingCard({ section, speech, notify }) {
  const label = CATEGORY_BY_KEY[section.category]?.label ?? section.category;
  return (
    <section className="rounded-xl border border-line bg-white p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">{label}</h2>
        <SpeakButton speech={speech} speechKey={`briefing:${section.category}`}
          parts={[`หมวด${label}`, ...section.points.map(p => p.text)]} notify={notify}/>
      </div>
      <ul className="space-y-4">
        {section.points.map((p, i) => (
          <li key={i} className="flex gap-3">
            <Dash/>
            <div>
              <p className="font-read text-[15px] leading-[1.75] text-graphite">{p.text}</p>
              {p.articles?.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
                  {p.articles.map(a => (
                    <a key={a.source_url} href={a.source_url} target="_blank" rel="noopener noreferrer" title={a.title}
                      className="font-medium text-pen hover:underline">
                      {sourceName(a.source)} ↗
                    </a>
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// สรุปข่าวเด่นวันนี้ — backend สร้างเองทุก ~3 ชั่วโมงหลังดึงข่าว หรือกดสร้างใหม่ได้
function BriefingSection({ notify, speech }) {
  const [briefing, setBriefing]     = useState(null);
  const [loading, setLoading]       = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError]           = useState(null);

  useEffect(() => {
    let cancelled = false;
    apiGet("/briefing")
      .then(data => { if (!cancelled) setBriefing(data.briefing); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function generate() {
    setGenerating(true);
    try {
      const data = await apiPost("/briefing", {});
      setBriefing(data.briefing);
      setError(null);
      notify("✓ สร้างสรุปข่าวเด่นใหม่แล้ว");
    } catch (err) {
      notify("สร้างสรุปไม่สำเร็จ: " + err.message, "error");
    } finally {
      setGenerating(false);
    }
  }

  const sections = briefing?.sections ?? [];
  const speakAll = sections.flatMap(s => [`หมวด${CATEGORY_BY_KEY[s.category]?.label ?? s.category}`, ...s.points.map(p => p.text)]);

  return (
    <main className={MAIN}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {briefing && <p className="mb-1 text-sm font-medium text-muted">{formatThaiDate(briefing.date)}</p>}
          <h1 className={H1}>สรุปข่าวเด่นวันนี้</h1>
          <p className="mt-1 text-sm text-muted">
            {briefing
              ? `อัปเดต ${timeAgo(briefing.generated_at)} · AI สรุปประเด็นสำคัญของแต่ละหมวดจากข่าว 24 ชั่วโมงล่าสุด`
              : "AI สรุปประเด็นสำคัญของแต่ละหมวดจากข่าว 24 ชั่วโมงล่าสุด"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SpeakButton speech={speech} speechKey="briefing:all" parts={speakAll} notify={notify} label="ฟังทั้งหมด"/>
          <button onClick={generate} disabled={generating} className={`${BTN_SM} ${AI_BTN}`}>
            {generating ? "กำลังสร้าง…" : briefing ? "✦ สร้างใหม่" : "✦ สร้างสรุปตอนนี้"}
          </button>
        </div>
      </div>
      <div className="mt-6">
        {error && <div className={ERROR_BOX}>{error}</div>}
        {generating && <p className="mb-4 text-sm text-muted" aria-live="polite">AI กำลังอ่านข่าวทุกหมวด ใช้เวลาประมาณ 10–30 วินาที</p>}
        {loading ? (
          <div className="grid gap-5 lg:grid-cols-2">
            {[0, 1, 2, 3].map(i => <div key={i} className="h-56 rounded-xl border border-line bg-white motion-safe:animate-pulse"/>)}
          </div>
        ) : sections.length === 0 && !error ? (
          <EmptyState title="ยังไม่มีสรุปข่าวเด่น">ระบบจะสร้างให้เองหลังดึงข่าว หรือกด "สร้างสรุปตอนนี้"</EmptyState>
        ) : (
          <div className="grid items-start gap-5 lg:grid-cols-2">
            {sections.map(s => <BriefingCard key={s.category} section={s} speech={speech} notify={notify}/>)}
          </div>
        )}
      </div>
    </main>
  );
}

export default function App() {
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [activeKey, setActiveKey]               = useState(null);
  const [tab, setTab]                           = useState("home");
  const [toast, setToast]                       = useState(null);
  const [lastFetch, setLastFetch]               = useState(null);
  const toastTimer = useRef(null);
  const { articles, setArticles, loading, error, reload } = useNews(selectedCategory);

  const notify = useCallback((message, type = "info") => {
    clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const speech = useSpeech();
  const topicsApi = useTopics();
  const { totalNew } = topicsApi;
  useEffect(() => { document.title = totalNew ? `(${totalNew}) ${BASE_TITLE}` : BASE_TITLE; }, [totalNew]);

  const { summarise, isSummarising } = useSummariser(
    (key, summary) => setArticles(prev => prev.map(a => articleKey(a) === key ? { ...a, summary } : a)),
    notify,
  );

  // พอ backend ดึงข่าวรอบใหม่เสร็จและได้ข่าวใหม่ ก็โหลดรายการใหม่ให้เอง ไม่ต้องกดรีเฟรช
  useEffect(() => {
    let lastSeen;  // undefined = ยังไม่เคยเช็ก — ครั้งแรกแค่จำไว้ ข่าวเพิ่งโหลดมาแล้ว
    async function check() {
      try {
        const { last_fetch } = await apiGet("/status");
        setLastFetch(last_fetch);
        const finished = last_fetch?.finished_at ?? null;
        if (lastSeen !== undefined && finished !== lastSeen && last_fetch?.new_count > 0) reload();
        lastSeen = finished;
      } catch { /* backend ปิดอยู่ — หน้าหลักแสดง error ของตัวเองอยู่แล้ว */ }
    }
    check();
    const timer = setInterval(check, STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);

  const active = articles.find(a => articleKey(a) === activeKey);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur">
        <div className="border-b border-line">
          <div className={`${CONTAINER} flex flex-wrap items-end justify-between gap-x-6`}>
            <div className="flex items-baseline gap-3 py-3">
              <span className="text-2xl font-bold tracking-tight text-ink">News<span className="highlight px-0.5">AI</span></span>
              <span className="hidden text-sm text-muted sm:inline">สรุปข่าวไทยด้วย AI</span>
            </div>
            <nav aria-label="เมนูหลัก" className="-mb-px flex overflow-x-auto">
              {TABS.map(t => {
                const isActive = tab === t.key;
                const badge = t.key === "topics" ? totalNew : 0;
                return (
                  <button key={t.key} onClick={() => { speech.stop(); setTab(t.key); }} aria-current={isActive ? "page" : undefined}
                    className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-[15px] font-medium transition-colors
                      ${isActive ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`}>
                    {t.label}
                    {badge > 0 && <span className={COUNT_BADGE}>{badge}</span>}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
        {tab === "home" && (
          <div className="border-b border-line">
            <div role="group" aria-label="เลือกหมวดข่าว" className={`${CONTAINER} flex gap-1 overflow-x-auto py-2`}>
              {CATEGORIES.map(cat => {
                const isActive = cat.key === selectedCategory;
                return (
                  <button key={cat.key ?? "all"} onClick={() => setSelectedCategory(cat.key)} aria-pressed={isActive}
                    className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors
                      ${isActive ? "bg-ink text-white" : "text-muted hover:bg-wash hover:text-ink"}`}>
                    {cat.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {/* ซ่อนแทนการถอดออก — สลับแท็บไปมาแล้วผลค้นหาและสรุปที่ทำไว้ยังอยู่ */}
      <div hidden={tab !== "search"}>
        <SearchSection notify={notify} onSaved={reload} speech={speech}/>
      </div>

      {tab === "briefing" && <BriefingSection notify={notify} speech={speech}/>}
      {tab === "topics" && <TopicsSection topicsApi={topicsApi} notify={notify} onSaved={reload} speech={speech}/>}

      {tab === "home" && (
        <main className={MAIN}>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className={H1}>{selectedCategory ? `ข่าว${CATEGORY_BY_KEY[selectedCategory].label}` : "ข่าวล่าสุด"}</h1>
              <p className="mt-1 min-h-5 text-sm text-muted">{fetchStatusText(lastFetch)}</p>
            </div>
            <button onClick={reload} disabled={loading} className={`${BTN_SM} ${OUTLINE_BTN}`}>
              ↻ {loading ? "กำลังโหลด..." : "รีเฟรช"}
            </button>
          </div>
          {error && <div className={ERROR_BOX}>เกิดข้อผิดพลาด: {error}</div>}
          <div className={NEWS_GRID}>
            {articles.map((a, i) => (
              <NewsCard key={a.id} article={a} lead={i === 0} onOpen={a => setActiveKey(articleKey(a))}
                onSummarise={summarise} summarising={isSummarising(a)}/>
            ))}
            {loading && articles.length === 0 && <SkeletonCards/>}
          </div>
          {!loading && articles.length === 0 && !error && (
            <EmptyState title="ยังไม่มีข่าวในหมวดนี้">ลองเลือกหมวดอื่น หรือกดรีเฟรช</EmptyState>
          )}
        </main>
      )}

      {active && <ArticleModal article={active} onClose={() => { speech.stop(); setActiveKey(null); }}
        onSummarise={summarise} summarising={isSummarising(active)} speech={speech} notify={notify}/>}
      <Toast toast={toast}/>
    </div>
  );
}
