import { useState, useEffect, useCallback, useRef } from "react";
import { apiDelete, apiGet } from "./lib/api";
import { articleKey, timeAgo } from "./lib/format";
import { BTN_MD, BTN_SM, CATEGORIES, CATEGORY_BY_KEY, CONTAINER, COUNT_BADGE, ERROR_BOX,
         H1, MAIN, NEWS_GRID, OUTLINE_BTN, TABS } from "./lib/ui";
import { useNews } from "./hooks/useNews";
import { useSpeech } from "./hooks/useSpeech";
import { useSummariser } from "./hooks/useSummariser";
import { useTopics, DEFAULT_MAX_TOPICS } from "./hooks/useTopics";
import { EmptyState, SkeletonCards, Toast } from "./components/ui";
import { NewsCard } from "./components/NewsCard";
import { ArticleModal } from "./components/ArticleModal";
import { SearchSection } from "./components/SearchSection";
import { TopicsSection } from "./components/TopicsSection";
import { BriefingSection } from "./components/BriefingSection";

// backend ดึงข่าวเองทุก ~30 นาที — เช็กทุก 1 นาทีว่ารอบใหม่เสร็จหรือยัง (/status ไม่อ่าน Firestore)
const STATUS_POLL_MS = 60_000;
const PAGE_SIZE = 100;           // ข่าวที่โหลดครั้งแรกและที่เพิ่มทีละครั้งเมื่อกด "ดูข่าวเก่ากว่านี้"
const DEFAULT_MAX_NEWS = 300;    // เพดานของ backend — ใช้ค่านี้ไปก่อนจนกว่า /api/status จะตอบ
const BASE_TITLE = "NewsAI — สรุปข่าวไทยด้วย AI";

function fetchStatusText(lastFetch) {
  if (lastFetch?.running) return "⏳ กำลังดึงข่าวใหม่...";
  if (!lastFetch?.finished_at) return "";
  const summarized = lastFetch.summarized ? ` · AI สรุปรอไว้ ${lastFetch.summarized} ข่าว` : "";
  return `ดึงข่าวใหม่ล่าสุด ${timeAgo(lastFetch.finished_at)}${summarized}`;
}

export default function App() {
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [limit, setLimit]                       = useState(PAGE_SIZE);
  const [activeArticle, setActiveArticle]       = useState(null);
  const [tab, setTab]                           = useState("home");
  const [toast, setToast]                       = useState(null);
  const [status, setStatus]                     = useState(null);
  const toastTimer = useRef(null);
  const { articles, setArticles, loading, error, reload } = useNews(selectedCategory, limit);

  const notify = useCallback((message, type = "info") => {
    clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const speech = useSpeech();
  // จำนวนหัวข้อสูงสุดมาจาก backend จะได้ไม่ต้องแก้ค่าเดียวกันสองที่เวลาปรับ
  const topicsApi = useTopics(status?.max_topics ?? DEFAULT_MAX_TOPICS);
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
        const data = await apiGet("/status");
        setStatus(data);
        const finished = data.last_fetch?.finished_at ?? null;
        if (lastSeen !== undefined && finished !== lastSeen && data.last_fetch?.new_count > 0) reload();
        lastSeen = finished;
      } catch { /* backend ปิดอยู่ — หน้าหลักแสดง error ของตัวเองอยู่แล้ว */ }
    }
    check();
    const timer = setInterval(check, STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);

  function chooseCategory(key) {
    setSelectedCategory(key);
    setLimit(PAGE_SIZE);   // เปลี่ยนหมวดแล้วเริ่มนับใหม่จากหน้าแรก
  }

  async function handleDelete(article) {
    try {
      await apiDelete(`/delete/${encodeURIComponent(article.id)}`);
      setArticles(prev => prev.filter(a => a.id !== article.id));
      speech.stop();
      setActiveArticle(null);
      notify("✓ ลบข่าวออกจากหน้าหลักแล้ว");
    } catch (err) {
      notify("ลบไม่สำเร็จ: " + err.message, "error");
    }
  }

  // ใช้ข่าวฉบับล่าสุดจากรายการ (จะได้เห็นสรุปที่เพิ่งทำเสร็จ) แต่ถ้ารายการถูกโหลดใหม่ระหว่างอ่าน
  // ก็ยังเปิดค้างไว้ด้วยข้อมูลเดิม — ไม่ใช่ปิดหน้าต่างใส่หน้าผู้ใช้กลางคัน
  const active = activeArticle && (articles.find(a => articleKey(a) === articleKey(activeArticle)) ?? activeArticle);
  const maxNews = status?.max_news_limit ?? DEFAULT_MAX_NEWS;
  const canLoadMore = !loading && articles.length >= limit && limit < maxNews;

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
                  <button key={cat.key ?? "all"} onClick={() => chooseCategory(cat.key)} aria-pressed={isActive}
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
        <SearchSection notify={notify} onSaved={reload} speech={speech} visible={tab === "search"}/>
      </div>

      {tab === "briefing" && <BriefingSection notify={notify} speech={speech}/>}
      {tab === "topics" && <TopicsSection topicsApi={topicsApi} notify={notify} onSaved={reload} speech={speech}/>}

      {tab === "home" && (
        <main className={MAIN}>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className={H1}>{selectedCategory ? `ข่าว${CATEGORY_BY_KEY[selectedCategory].label}` : "ข่าวล่าสุด"}</h1>
              <p className="mt-1 min-h-5 text-sm text-muted">{fetchStatusText(status?.last_fetch)}</p>
            </div>
            <button onClick={reload} disabled={loading} className={`${BTN_SM} ${OUTLINE_BTN}`}>
              ↻ {loading ? "กำลังโหลด..." : "รีเฟรช"}
            </button>
          </div>
          {error && <div className={ERROR_BOX}>เกิดข้อผิดพลาด: {error}</div>}
          <div className={NEWS_GRID}>
            {articles.map((a, i) => (
              <NewsCard key={a.id} article={a} lead={i === 0} onOpen={setActiveArticle}
                onSummarise={summarise} summarising={isSummarising(a)}/>
            ))}
            {loading && articles.length === 0 && <SkeletonCards/>}
          </div>
          {canLoadMore && (
            <div className="mt-6 text-center">
              <button onClick={() => setLimit(n => Math.min(n + PAGE_SIZE, maxNews))} className={`${BTN_MD} ${OUTLINE_BTN}`}>
                ดูข่าวเก่ากว่านี้
              </button>
            </div>
          )}
          {!loading && articles.length === 0 && !error && (
            <EmptyState title="ยังไม่มีข่าวในหมวดนี้">ลองเลือกหมวดอื่น หรือกดรีเฟรช</EmptyState>
          )}
        </main>
      )}

      {active && <ArticleModal article={active} onClose={() => { speech.stop(); setActiveArticle(null); }}
        onSummarise={summarise} summarising={isSummarising(active)} speech={speech} notify={notify}
        onDelete={active.id ? handleDelete : undefined}/>}
      <Toast toast={toast}/>
    </div>
  );
}
