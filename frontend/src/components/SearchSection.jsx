import { useState, useEffect } from "react";
import { apiGet } from "../lib/api";
import { BTN_MD, ERROR_BOX, H1, INK_BTN, INPUT, MAIN, NEWS_GRID } from "../lib/ui";
import { EmptyState, SkeletonCards } from "./ui";
import { LiveResults } from "./LiveResults";

const SLOW_SEARCH_MS = 4000;  // ค้นนานกว่านี้ค่อยบอกว่ากำลังทำอะไรอยู่ ผู้ใช้จะได้ไม่คิดว่าเว็บค้าง

export function SearchSection({ notify, onSaved, speech, visible = true }) {
  const [keyword, setKeyword]   = useState("");
  const [results, setResults]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [empty, setEmpty]       = useState(null);   // คำค้นที่หาแล้วไม่เจอ — "ไม่เจอ" ไม่ใช่ "ผิดพลาด"
  const [slow, setSlow]         = useState(false);
  const [searchId, setSearchId] = useState(0);      // เปลี่ยนทุกครั้งที่ค้นใหม่ — ผลชุดใหม่เริ่มแสดงจาก 20 ข่าวแรก

  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setSlow(true), SLOW_SEARCH_MS);
    return () => clearTimeout(timer);
  }, [loading]);

  async function handleSearch(e) {
    e.preventDefault();
    if (!keyword.trim()) return;
    setLoading(true); setError(null); setEmpty(null); setSlow(false); setResults([]); setSearchId(id => id + 1);
    try {
      const data = await apiGet(`/search?q=${encodeURIComponent(keyword)}`);
      setResults(data.results);
      if (data.results.length === 0) setEmpty(keyword.trim());
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
        {loading && (
          <>
            {slow && <p className="mb-3 text-sm text-muted" aria-live="polite">กำลังค้นจากทุกสำนักข่าวและ Google News อีกสักครู่…</p>}
            <div className={NEWS_GRID}><SkeletonCards/></div>
          </>
        )}
        {empty && !loading && (
          <EmptyState title={`ไม่พบข่าวที่มีคำว่า "${empty}"`}>
            ลองใช้คำสั้นลง หรือพิมพ์คำเดียวก่อน — ระบบจะหาข่าวที่มีครบทุกคำที่พิมพ์
          </EmptyState>
        )}
        {results.length > 0 && (
          <>
            <p className="mb-3 text-sm text-muted">พบ {results.length} ข่าว เรียงจากใหม่ไปเก่า</p>
            <LiveResults key={searchId} results={results} notify={notify} onSaved={onSaved} speech={speech} visible={visible}/>
          </>
        )}
      </div>
    </main>
  );
}
