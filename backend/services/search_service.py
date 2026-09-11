"""
services/search_service.py
ค้นข่าวสดจาก RSS ของสำนักข่าวที่ใช้อยู่ + Google News (ไม่ได้ค้นจาก Firestore)
และหาข่าวของหัวข้อที่ผู้ใช้ติดตาม (เฉพาะ feed ของเรา)
"""

from __future__ import annotations
import re
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime, timezone

from controllers.news_controller import RSS_FEEDS
from services.rss_utils import clean_html, extract_image, fetch_feed

FEED_CACHE_TTL = 300   # วินาที — cache เก่ากว่านี้จะดึงใหม่เบื้องหลัง ระหว่างนั้นค้นจากของเดิมไปก่อน
SEARCH_DEADLINE = 12   # วินาที — feed ไหนตอบไม่ทันก็ข้ามไป ไม่ให้ทั้งหน้าค้นหารอ
MAX_RESULTS = 60

# url → (เวลาที่ดึง, [(entry, ข้อความที่ใช้ค้น)]) — ตัด HTML ไว้ตั้งแต่ตอนดึง ไม่ต้องทำซ้ำทุกครั้งที่ค้น
_feed_cache: dict[str, tuple[float, list]] = {}
_refreshing: set[str] = set()
_lock = threading.Lock()
# ใช้ pool เดียวทุกคำค้น — feed ที่โหลดไม่ทันกำหนดเวลาจะโหลดต่อจนเสร็จ แล้วเก็บเข้า cache ให้คำค้นถัดไป
_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="search-feed")
_ASCII_WORD = re.compile(r"[a-z0-9]+")


def _load(url: str) -> list:
    try:
        entries = fetch_feed(url)
        if not entries:  # ดึงไม่สำเร็จ — ใช้ของเดิมใน cache ไปก่อน ครั้งหน้าจะลองใหม่
            hit = _feed_cache.get(url)
            return hit[1] if hit else []
        indexed = [(e, f"{e.get('title', '')}\n{clean_html(e.get('summary', ''))}".lower()) for e in entries]
        _feed_cache[url] = (time.monotonic(), indexed)
        return indexed
    finally:
        with _lock:
            _refreshing.discard(url)


def _fetch_cached(url: str) -> list:
    """คืนข่าวจาก cache ทันที ถ้าเก่าแล้วสั่งดึงใหม่เบื้องหลัง — มีแค่ครั้งแรกที่ต้องรอโหลดจริง"""
    hit = _feed_cache.get(url)
    if hit is None:
        return _load(url)
    if time.monotonic() - hit[0] > FEED_CACHE_TTL:
        with _lock:
            already = url in _refreshing
            _refreshing.add(url)
        if not already:
            _pool.submit(_load, url)
    return hit[1]


def warm_cache() -> None:
    """โหลด feed ทั้งหมดเข้า cache ตอนเปิด server — คนแรกที่ค้นจะได้ไม่ต้องรอ"""
    for cfg in RSS_FEEDS:
        _pool.submit(_fetch_cached, cfg["url"])


def _term_matcher(term: str):
    # คำภาษาอังกฤษ/ตัวเลขต้องตรงทั้งคำ ("ai" ไม่ควรเจอใน "thailand")
    # ภาษาไทยไม่มีช่องว่างคั่นคำ จึงนับว่าเจอถ้ามีคำนี้อยู่ตรงไหนก็ได้
    if _ASCII_WORD.fullmatch(term):
        pattern = re.compile(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])")
        return lambda text: pattern.search(text) is not None
    return lambda text: term in text


def _matchers(keyword: str) -> list:
    return [_term_matcher(t) for t in keyword.lower().split()]


def _result(future) -> list:
    return future.result() if future.done() and future.exception() is None else []


def _our_feeds(timeout: float) -> list[tuple[dict, list]]:
    """[(feed, [(entry, ข้อความที่ใช้ค้น)])] ของทุก feed — feed หมวดเฉพาะก่อน "general"
    ข่าวที่อยู่หลาย feed จะได้หมวดที่ตรงที่สุด"""
    futures = [_pool.submit(_fetch_cached, cfg["url"]) for cfg in RSS_FEEDS]
    wait(futures, timeout=timeout)
    return sorted(zip(RSS_FEEDS, (_result(f) for f in futures)), key=lambda p: p[0]["category"] == "general")


class _Seen:
    """ตัดข่าวซ้ำ — URL เดียวกันหรือหัวข่าวเดียวกัน (เทียบทั้งหัวข่าว)"""

    def __init__(self):
        self._urls: set[str] = set()
        self._titles: set[str] = set()

    def first_time(self, article: dict) -> bool:
        title = " ".join(article["title"].lower().split())
        if not article["source_url"] or article["source_url"] in self._urls or title in self._titles:
            return False
        self._urls.add(article["source_url"])
        self._titles.add(title)
        return True


def _match_ours(matchers: list, feeds: list[tuple[dict, list]], seen: _Seen) -> list[dict]:
    found = []
    for cfg, indexed in feeds:
        for entry, text in indexed:
            if all(match(text) for match in matchers):
                article = _entry_to_dict(entry, cfg["source"], cfg["category"])
                if seen.first_time(article):
                    found.append(article)
    return found


def _newest_first(articles: list[dict]) -> list[dict]:
    return sorted(articles, key=lambda a: a["published_at"] or "", reverse=True)


def search_news(keyword: str, max_results: int = MAX_RESULTS) -> list[dict]:
    """ข่าวที่มีครบทุกคำที่พิมพ์ (คั่นด้วยเว้นวรรค) จาก feed ของเรา + ผลจาก Google News เรียงจากใหม่ไปเก่า"""
    matchers = _matchers(keyword)
    if not matchers:
        return []

    deadline = time.monotonic() + SEARCH_DEADLINE
    # ผล Google ไม่ cache เพราะเปลี่ยนตามคำค้น — ส่งเข้าคิวก่อน จะได้ไม่ต้องรอหลัง feed
    google_url = f"https://news.google.com/rss/search?q={urllib.parse.quote(keyword)}&hl=th&gl=TH&ceid=TH:th"
    google = _pool.submit(fetch_feed, google_url)
    seen = _Seen()
    ours = _match_ours(matchers, _our_feeds(SEARCH_DEADLINE), seen)
    wait([google], timeout=max(0.0, deadline - time.monotonic()))
    # ข่าว Google ที่ซ้ำกับข่าวจาก feed ของเรา (URL หรือหัวข่าวเดียวกัน) จะถูกข้าม
    from_google = [a for a in (_entry_to_dict(e, "google_news", "general") for e in _result(google))
                   if seen.first_time(a)]

    # เก็บข่าวจาก feed ของเราไว้ทั้งหมดก่อน แล้วเติมช่องที่เหลือด้วยผล Google
    # (ถ้าเรียงวันที่แล้วตัดทีเดียว ข่าว Google ที่ใหม่กว่าจะเบียดข่าวของเราตกไปเกือบหมด)
    results = _newest_first(ours)[:max_results]
    results += from_google[: max_results - len(results)]
    return _newest_first(results)


def match_feeds(keyword: str, max_results: int = 30) -> list[dict]:
    """ข่าวของหัวข้อที่ติดตาม — ค้นเฉพาะ feed ของเราจาก cache (ไม่เรียก Google) จึงเช็กบ่อย ๆ ได้โดยไม่เปลืองอะไร"""
    matchers = _matchers(keyword)
    if not matchers:
        return []
    return _newest_first(_match_ours(matchers, _our_feeds(SEARCH_DEADLINE), _Seen()))[:max_results]


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
