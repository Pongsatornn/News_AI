from __future__ import annotations
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime, timezone

from controllers.news_controller import RSS_FEEDS
from services.rss_utils import clean_html, extract_image, fetch_feed

FEED_CACHE_TTL = 300   # วินาที — feed ของสำนักข่าวไม่ได้เปลี่ยนทุกวินาที ไม่ต้องดึงใหม่ทุกครั้งที่ค้น
SEARCH_DEADLINE = 12   # วินาที — feed ไหนตอบไม่ทันก็ข้ามไป ไม่ให้ทั้งหน้าค้นหารอ

_feed_cache: dict[str, tuple[float, list]] = {}


def _fetch_cached(url: str) -> list:
    hit = _feed_cache.get(url)
    if hit and time.monotonic() - hit[0] < FEED_CACHE_TTL:
        return hit[1]
    entries = fetch_feed(url)
    if entries:  # ไม่ cache ตอนดึงไม่สำเร็จ ครั้งหน้าจะได้ลองใหม่
        _feed_cache[url] = (time.monotonic(), entries)
    return entries


def search_news(keyword: str, max_results: int = 20) -> list[dict]:
    results = []
    seen_urls = set()
    seen_titles = set()
    kw = keyword.lower()

    def add(entry, source, category):
        link = entry.get("link", "")
        title_clean = entry.get("title", "").strip()[:30]
        if link and link not in seen_urls and title_clean not in seen_titles:
            seen_urls.add(link)
            seen_titles.add(title_clean)
            results.append(_entry_to_dict(entry, source, category))

    encoded = urllib.parse.quote(keyword)
    google_url = f"https://news.google.com/rss/search?q={encoded}&hl=th&gl=TH&ceid=TH:th"

    # ดึงทุก feed พร้อมกัน — ทำทีละ feed จะช้าเกินไปสำหรับหน้าค้นหา
    pool = ThreadPoolExecutor(max_workers=8)
    futures = [pool.submit(_fetch_cached, f["url"]) for f in RSS_FEEDS] + [pool.submit(fetch_feed, google_url)]
    wait(futures, timeout=SEARCH_DEADLINE)
    pool.shutdown(wait=False, cancel_futures=True)
    *feed_entries, google_entries = [f.result() if f.done() and not f.cancelled() else [] for f in futures]

    # 1. ค้นจาก RSS feeds ของเรา (มีรูป + รู้หมวดหมู่) — feed หมวดเฉพาะก่อน "general"
    #    ข่าวที่อยู่หลาย feed จะได้หมวดที่ตรงที่สุด
    pairs = sorted(zip(RSS_FEEDS, feed_entries), key=lambda p: p[0]["category"] == "general")
    for cfg, entries in pairs:
        for entry in entries:
            if kw in entry.get("title", "").lower() or kw in clean_html(entry.get("summary", "")).lower():
                add(entry, cfg["source"], cfg["category"])

    # 2. เติมจาก Google News RSS (ไม่มีรูป — frontend จะแสดงโลโก้สำนักข่าวแทน)
    for entry in google_entries:
        add(entry, "google_news", "general")

    return results[:max_results]


def _entry_to_dict(entry, source: str, category: str) -> dict:
    title   = entry.get("title", "").strip()
    link    = entry.get("link",  "").strip()
    content = clean_html(
        entry.get("content", [{}])[0].get("value")
        or entry.get("summary")
        or entry.get("description")
        or ""
    )

    pub_dt = None
    if hasattr(entry, "published_parsed") and entry.published_parsed:
        pub_dt = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc).isoformat()

    publisher_url = None
    if source == "google_news":
        # Google News: ชื่อสำนักข่าวจริงอยู่ใน <source> และต่อท้ายหัวข่าวเป็น " - ชื่อสำนักข่าว"
        publisher = entry.get("source") or {}
        if publisher.get("title"):
            source = publisher["title"]
            if title.endswith(f" - {source}"):
                title = title[: -len(f" - {source}")].strip()
        publisher_url = publisher.get("href")
        content = ""  # description ของ Google News มีแค่ลิงก์หัวข่าวกับชื่อสำนักข่าว ไม่ใช่เนื้อข่าว — AI สรุปไม่ได้

    return {
        "title":         title,
        "source":        source,
        "source_url":    link,
        "publisher_url": publisher_url,
        "full_content":  content or None,
        "image_url":     extract_image(entry),
        "summary":       [],
        "category":      category,
        "published_at":  pub_dt,
    }
