import { useState } from "react";
import { AI_BTN, BTN_SM, OUTLINE_BTN } from "../lib/ui";
import { excerptOf, hasSummary, logoUrl, sourceName } from "../lib/format";
import { AiTag, ArticleMeta, Dash } from "./ui";

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
export function NewsCard({ article, lead = false, onOpen, onSummarise, summarising, showSave = false, onSave, saved, isNew = false }) {
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
