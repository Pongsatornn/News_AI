import { useState, useEffect } from "react";
import { apiGet, apiPost } from "../lib/api";
import { formatThaiDate, sourceName, timeAgo } from "../lib/format";
import { AI_BTN, BTN_SM, CATEGORY_BY_KEY, ERROR_BOX, H1, MAIN } from "../lib/ui";
import { Dash, EmptyState, SpeakButton } from "./ui";

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
export function BriefingSection({ notify, speech }) {
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
