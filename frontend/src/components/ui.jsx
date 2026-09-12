import React from "react";
import { BTN_SM, CATEGORY_BY_KEY, GHOST_BTN, INK_BTN } from "../lib/ui";
import { sourceName, timeAgo } from "../lib/format";

function SpeakerIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 shrink-0">
      <path d="M9.5 4 5.5 7.5H3v5h2.5l4 3.5V4Z" fill="currentColor"/>
      <path d="M12.5 7.5a3.5 3.5 0 0 1 0 5M14.5 5.5a6.5 6.5 0 0 1 0 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  );
}

export function SpeakButton({ speech, speechKey, parts, notify, label = "ฟังสรุป" }) {
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
export function AiTag() {
  return <span className="whitespace-nowrap rounded-sm bg-marker px-1.5 py-px font-sans text-xs font-semibold text-ink">✦ สรุปโดย AI</span>;
}

// หัวข้อย่อยของสรุป — ขีดปากกาเน้นข้อความสั้น ๆ แทนตัวเลข เพราะข้อสรุปไม่ได้เรียงลำดับ
export function Dash() {
  return <span aria-hidden="true" className="mt-[0.6em] h-1.5 w-3 shrink-0 rounded-sm bg-marker"/>;
}

export function ArticleMeta({ article, isNew = false }) {
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

export function EmptyState({ title, children }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong px-6 py-14 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {children && <p className="mt-1 text-sm text-muted">{children}</p>}
    </div>
  );
}

export function SkeletonCards({ count = 6 }) {
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

// แจ้งผลแบบหายเอง แทน alert() ที่ต้องกดปิดทุกครั้ง
export function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div role="status"
      className={`fixed bottom-5 left-1/2 z-60 w-max max-w-[calc(100%-32px)] -translate-x-1/2 rounded-lg px-4 py-2.5
        text-sm leading-normal text-white shadow-lift ${toast.type === "error" ? "bg-red-deep" : "bg-ink"}`}>
      {toast.message}
    </div>
  );
}
