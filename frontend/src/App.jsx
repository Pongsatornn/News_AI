import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNews, apiGet, apiPost } from "./hooks/useNews";

const CATEGORIES = [
  { key: null,            label: "ทั้งหมด",    icon: "📰" },
  { key: "general",       label: "ทั่วไป",      icon: "🌐" },
  { key: "politics",      label: "การเมือง",    icon: "🏛️" },
  { key: "sports",        label: "กีฬา",        icon: "⚽" },
  { key: "technology",    label: "เทคโนโลยี",   icon: "💻" },
  { key: "entertainment", label: "บันเทิง",     icon: "🎬" },
  { key: "business",      label: "ธุรกิจ",      icon: "💼" },
];

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
      const data = await apiPost("/summarize", { id: article.id, title: article.title, content: article.full_content });
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
  if (lastFetch?.finished_at) return `ดึงข่าวใหม่ล่าสุด ${timeAgo(lastFetch.finished_at)}`;
  return "";
}

function NewsCard({ article, onOpen, onSummarise, summarising, showSave = false, onSave, saved }) {
  const [imgFailed, setImgFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const cat = CATEGORIES.find(c => c.key === article.category);
  const logo = article.publisher_url && !logoFailed ? logoUrl(article.publisher_url) : null;
  const done = hasSummary(article);

  // เปิดหน้าต่างข่าวทันที แล้วสรุปจะขึ้นในนั้นเมื่อ AI ตอบกลับ
  function handleSummarise() {
    onOpen(article);
    onSummarise(article);
  }

  return (
    <div style={{background:"#fff",borderRadius:16,overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,0.08)",border:"1px solid #f0f0f0",display:"flex",flexDirection:"column"}}>
      <div onClick={() => onOpen(article)}
        style={{aspectRatio:"16/9",overflow:"hidden",background:"#f3f4f6",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:36}}>
        {article.image_url && !imgFailed
          ? <img src={article.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImgFailed(true)}
              style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
          : logo
            ? <img src={logo} alt="" referrerPolicy="no-referrer" onError={() => setLogoFailed(true)}
                style={{width:56,height:56,borderRadius:14,background:"#fff",padding:6,boxShadow:"0 1px 3px rgba(0,0,0,0.1)"}}/>
            : <span style={{opacity:0.35}}>{cat?.icon ?? "📰"}</span>}
      </div>

      <div style={{padding:16,display:"flex",flexDirection:"column",gap:10,flex:1}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
        <span style={{background:"#e8f0fe",color:"#1a73e8",borderRadius:20,padding:"2px 10px",fontSize:12,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{sourceName(article.source)}</span>
        <span style={{fontSize:11,color:"#999",whiteSpace:"nowrap"}}>
          {cat ? `${cat.icon} ${cat.label}` : article.category}
          {article.published_at && ` · ${timeAgo(article.published_at)}`}
        </span>
      </div>

      <div onClick={() => onOpen(article)} style={{fontWeight:600,fontSize:15,lineHeight:1.5,color:"#1a1a1a",cursor:"pointer"}}
        onMouseEnter={e=>e.currentTarget.style.color="#1a73e8"}
        onMouseLeave={e=>e.currentTarget.style.color="#1a1a1a"}>
        {article.title}
      </div>

      <div style={{display:"flex",gap:8,marginTop:"auto",paddingTop:4,flexWrap:"wrap"}}>
        <button onClick={() => onOpen(article)}
          style={{flex:1,minWidth:80,padding:"7px 0",borderRadius:10,fontSize:12,cursor:"pointer",
            border:done?"none":"1px solid #e0e0e0",background:done?"#f0faf3":"#fff",
            color:done?"#34a853":"#555",fontWeight:done?600:500}}>
          {done ? "✦ อ่านสรุป" : "ดูข่าว"}
        </button>
        {/* ข่าวที่ไม่มีเนื้อหา (เช่น Google News มีแค่หัวข้อ) ไม่แสดงปุ่มสรุป */}
        {!done && article.can_summarize && (
          <button onClick={handleSummarise} disabled={summarising}
            style={{flex:1,minWidth:80,padding:"7px 0",borderRadius:10,border:"none",
              background:summarising?"#f5f5f5":"#1a1a1a",color:summarising?"#aaa":"#fff",
              fontSize:12,fontWeight:600,cursor:summarising?"default":"pointer"}}>
            {summarising ? "⏳ กำลังสรุป..." : "✦ สรุปด้วย AI"}
          </button>
        )}
        {showSave && (
          <button onClick={() => onSave(article)} disabled={saved}
            style={{flex:1,minWidth:80,padding:"7px 0",borderRadius:10,border:"none",
              background:saved?"#e8f0fe":"#1a73e8",color:saved?"#1a73e8":"#fff",
              fontSize:12,fontWeight:600,cursor:saved?"default":"pointer"}}>
            {saved?"✓ บันทึกแล้ว":"💾 บันทึก"}
          </button>
        )}
      </div>
      </div>
    </div>
  );
}

function ArticleModal({ article, onClose, onSummarise, summarising }) {
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!article) return null;
  const bullets = hasSummary(article) ? article.summary : [];
  const cat = CATEGORIES.find(c => c.key === article.category);
  return (
    <div onClick={e=>{if(e.target===e.currentTarget)onClose()}}
      style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:50,padding:16}}>
      <div style={{background:"#fff",borderRadius:24,width:"100%",maxWidth:520,maxHeight:"90vh",overflowY:"auto",display:"flex",flexDirection:"column"}}>
        <div style={{padding:"24px 24px 16px",borderBottom:"1px solid #f0f0f0"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div style={{flex:1,paddingRight:12}}>
              <div style={{display:"flex",gap:8,marginBottom:6,flexWrap:"wrap"}}>
                <span style={{fontSize:11,color:"#1a73e8",fontWeight:600}}>{sourceName(article.source)}</span>
                {article.published_at&&<span style={{fontSize:11,color:"#999"}}>{timeAgo(article.published_at)}</span>}
                {cat&&<span style={{fontSize:11,color:"#666",background:"#f5f5f5",borderRadius:20,padding:"1px 8px"}}>{cat.icon} {cat.label}</span>}
              </div>
              <div style={{fontWeight:700,fontSize:16,lineHeight:1.5}}>{article.title}</div>
            </div>
            <button onClick={onClose} style={{background:"#f5f5f5",border:"none",borderRadius:"50%",width:32,height:32,cursor:"pointer",fontSize:14,flexShrink:0}}>✕</button>
          </div>
        </div>
        <div style={{padding:24,flex:1}}>
          <div style={{fontWeight:700,marginBottom:12,fontSize:14}}>✦ สรุปข่าวโดย AI</div>
          {bullets.length > 0 ? (
            <ul style={{listStyle:"none",padding:0,margin:0,display:"flex",flexDirection:"column",gap:10}}>
              {bullets.map((b,i)=>(
                <li key={i} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                  <span style={{background:"#e8f0fe",color:"#1a73e8",borderRadius:"50%",width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,flexShrink:0}}>{i+1}</span>
                  <span style={{fontSize:14,lineHeight:1.6,color:"#333"}}>{b}</span>
                </li>
              ))}
            </ul>
          ) : summarising ? (
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <div style={{color:"#888",fontSize:14}}>⏳ AI กำลังสรุปข่าว...</div>
              {[92, 78, 85].map((w, i) => (
                <div key={i} style={{height:14,background:"#f0f0f0",borderRadius:6,width:`${w}%`}}/>
              ))}
            </div>
          ) : article.can_summarize ? (
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-start",gap:12}}>
              <div style={{color:"#888",fontSize:14}}>ยังไม่มีสรุปของข่าวนี้</div>
              <button onClick={() => onSummarise(article)}
                style={{padding:"9px 18px",borderRadius:10,border:"none",background:"#1a1a1a",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>
                ✦ สรุปด้วย AI
              </button>
            </div>
          ) : (
            <div style={{color:"#888",fontSize:14,lineHeight:1.6}}>
              ข่าวนี้มีแค่หัวข้อ ไม่มีเนื้อหาให้ AI สรุป — อ่านรายละเอียดได้จากข่าวต้นฉบับด้านล่าง
            </div>
          )}
        </div>
        <div style={{padding:"16px 24px",borderTop:"1px solid #f0f0f0"}}>
          <a href={article.source_url} target="_blank" rel="noopener noreferrer"
            style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,background:"#1a1a1a",color:"#fff",borderRadius:16,padding:"12px 24px",textDecoration:"none",fontSize:14,fontWeight:600}}>
            อ่านข่าวต้นฉบับ ↗
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
      style={{position:"fixed",left:"50%",bottom:24,transform:"translateX(-50%)",zIndex:60,
        width:"max-content",maxWidth:"calc(100% - 32px)",padding:"10px 16px",borderRadius:12,
        background:toast.type==="error"?"#c62828":"#1a1a1a",color:"#fff",fontSize:14,lineHeight:1.5,
        boxShadow:"0 4px 12px rgba(0,0,0,0.2)"}}>
      {toast.message}
    </div>
  );
}

function SearchSection({ notify, onSaved }) {
  const [keyword, setKeyword]     = useState("");
  const [results, setResults]     = useState([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [savedUrls, setSavedUrls] = useState(new Set());
  const [activeKey, setActiveKey] = useState(null);
  const [summaries, setSummaries] = useState({});
  const { summarise, isSummarising } = useSummariser(
    (key, summary) => setSummaries(prev => ({ ...prev, [key]: summary })),
    notify,
  );

  async function handleSearch(e) {
    e.preventDefault();
    if (!keyword.trim()) return;
    setLoading(true); setError(null); setResults([]);
    try {
      const data = await apiGet(`/search?q=${encodeURIComponent(keyword)}`);
      setResults(data.results);
      if (data.results.length === 0) setError("ไม่พบข่าวที่เกี่ยวข้อง");
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

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
    <div className="page">
      <div style={{background:"#fff",borderRadius:16,padding:20,marginBottom:20,boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
        <div style={{fontWeight:700,fontSize:15,marginBottom:12}}>🔍 ค้นหาข่าว</div>
        <form onSubmit={handleSearch} style={{display:"flex",gap:8}}>
          <input value={keyword} onChange={e=>setKeyword(e.target.value)}
            placeholder="พิมพ์คีย์เวิร์ด เช่น เลือกตั้ง, AI, ฟุตบอล..."
            style={{flex:1,minWidth:0,padding:"10px 14px",borderRadius:10,border:"1.5px solid #e0e0e0",fontSize:14,outline:"none"}}
            onFocus={e=>e.target.style.borderColor="#1a73e8"}
            onBlur={e=>e.target.style.borderColor="#e0e0e0"}/>
          <button type="submit" disabled={loading}
            style={{padding:"10px 20px",borderRadius:10,border:"none",background:"#1a73e8",color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>
            {loading?"กำลังค้น...":"ค้นหา"}
          </button>
        </form>
      </div>
      {error && <div style={{background:"#fce8e6",color:"#c62828",padding:12,borderRadius:12,marginBottom:16,fontSize:14}}>{error}</div>}
      {enriched.length > 0 && (
        <>
          <div style={{fontSize:13,color:"#666",marginBottom:12}}>พบ {enriched.length} ข่าว — กด <strong>💾 บันทึก</strong> เพื่อเพิ่มลงหน้าหลัก</div>
          <div className="news-grid">
            {enriched.map(a=>(
              <NewsCard key={articleKey(a)} article={a} onOpen={a => setActiveKey(articleKey(a))}
                onSummarise={summarise} summarising={isSummarising(a)} showSave
                onSave={handleSave} saved={savedUrls.has(a.source_url)}/>
            ))}
          </div>
        </>
      )}
      {active && <ArticleModal article={active} onClose={() => setActiveKey(null)}
        onSummarise={summarise} summarising={isSummarising(active)}/>}
    </div>
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
    <div style={{minHeight:"100vh"}}>
      <div style={{background:"#fff",borderBottom:"1px solid #f0f0f0",position:"sticky",top:0,zIndex:40}}>
        <div className="header-inner">
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12,marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:24}}>📰</span>
              <div>
                <div style={{fontWeight:800,fontSize:20}}>NewsAI</div>
                <div style={{fontSize:12,color:"#aaa"}}>สรุปข่าวไทยด้วย AI</div>
              </div>
            </div>
            <div style={{display:"flex",gap:4}}>
              {[{key:"home",label:"🏠 หน้าหลัก"},{key:"search",label:"🔍 ค้นหา"}].map(t=>(
                <button key={t.key} onClick={()=>setTab(t.key)}
                  style={{padding:"7px 14px",borderRadius:20,border:"none",
                    background:tab===t.key?"#1a1a1a":"#f0f0f0",
                    color:tab===t.key?"#fff":"#555",
                    fontSize:13,fontWeight:500,cursor:"pointer"}}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          {tab==="home" && (
            <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:12}}>
              {CATEGORIES.map(cat=>(
                <button key={cat.key??"all"} onClick={()=>setSelectedCategory(cat.key)}
                  style={{flexShrink:0,padding:"6px 14px",borderRadius:20,
                    border:`1.5px solid ${cat.key===selectedCategory?"#1a1a1a":"#e0e0e0"}`,
                    background:cat.key===selectedCategory?"#1a1a1a":"#fff",
                    color:cat.key===selectedCategory?"#fff":"#555",
                    fontSize:13,fontWeight:500,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
                  {cat.icon} {cat.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ซ่อนแทนการถอดออก — สลับแท็บไปมาแล้วผลค้นหาและสรุปที่ทำไว้ยังอยู่ */}
      <div hidden={tab !== "search"}>
        <SearchSection notify={notify} onSaved={reload}/>
      </div>

      {tab === "home" && (
        <div className="page">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12,marginBottom:16}}>
            <div style={{fontSize:12,color:"#999"}}>{fetchStatusText(lastFetch)}</div>
            <button onClick={reload} disabled={loading}
              style={{padding:"6px 14px",borderRadius:20,border:"1px solid #e0e0e0",background:"#fff",color:"#555",fontSize:13,cursor:loading?"default":"pointer"}}>
              {loading ? "กำลังโหลด..." : "🔄 รีเฟรช"}
            </button>
          </div>
          {error&&<div style={{background:"#fce8e6",color:"#c62828",padding:12,borderRadius:12,marginBottom:16,fontSize:14}}>เกิดข้อผิดพลาด: {error}</div>}
          <div className="news-grid">
            {articles.map(a=>(
              <NewsCard key={a.id} article={a} onOpen={a => setActiveKey(articleKey(a))}
                onSummarise={summarise} summarising={isSummarising(a)}/>
            ))}
            {loading&&articles.length===0&&Array.from({length:6}).map((_,i)=>(
              <div key={i} style={{background:"#fff",borderRadius:16,padding:20,border:"1px solid #f0f0f0"}}>
                <div style={{height:12,background:"#f0f0f0",borderRadius:6,marginBottom:12,width:"40%"}}/>
                <div style={{height:14,background:"#f0f0f0",borderRadius:6,marginBottom:8}}/>
                <div style={{height:14,background:"#f0f0f0",borderRadius:6,width:"80%"}}/>
              </div>
            ))}
          </div>
          {!loading&&articles.length===0&&!error&&(
            <div style={{textAlign:"center",padding:"80px 0",color:"#aaa"}}>
              <div style={{fontSize:40,marginBottom:8}}>🗞️</div>
              <div style={{fontSize:14}}>ยังไม่มีข่าวในหมวดนี้</div>
            </div>
          )}
        </div>
      )}

      {active&&<ArticleModal article={active} onClose={()=>setActiveKey(null)}
        onSummarise={summarise} summarising={isSummarising(active)}/>}
      <Toast toast={toast}/>
    </div>
  );
}
