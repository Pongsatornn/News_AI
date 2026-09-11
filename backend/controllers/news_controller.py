from __future__ import annotations
import logging
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

if not __package__:
    # รันเป็นไฟล์ตรง ๆ (python controllers/news_controller.py) — เพิ่มโฟลเดอร์ backend ให้ import models/services เจอ
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models.news_article import NewsArticle
from services.firebase_service import is_duplicate, insert_article
from services.rss_utils import clean_html, extract_image, fetch_feed, fetch_og_image

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s — %(message)s")
logger = logging.getLogger(__name__)

RSS_FEEDS = [
    {"source": "matichon",       "url": "https://www.matichon.co.th/feed",                 "category": "general"},
    {"source": "thairath",       "url": "https://www.thairath.co.th/rss/news",              "category": "general"},
    {"source": "khaosod",        "url": "https://www.khaosod.co.th/feed",                   "category": "general"},
    {"source": "matichon_pol",   "url": "https://www.matichon.co.th/politics/feed",         "category": "politics"},
    {"source": "khaosod_pol",    "url": "https://www.khaosod.co.th/politics/feed",          "category": "politics"},
    {"source": "prachachat_pol", "url": "https://www.prachachat.net/politics/feed",         "category": "politics"},
    {"source": "thairath_sport", "url": "https://www.thairath.co.th/rss/sport",             "category": "sports"},
    {"source": "khaosod_sport",  "url": "https://www.khaosod.co.th/sports/feed",            "category": "sports"},
    {"source": "matichon_sport", "url": "https://www.matichon.co.th/sport/feed",            "category": "sports"},
    {"source": "blognone",       "url": "https://www.blognone.com/node/feed",               "category": "technology"},
    {"source": "beartai",        "url": "https://www.beartai.com/feed",                     "category": "technology"},
    {"source": "thairath_ent",   "url": "https://www.thairath.co.th/rss/entertain",         "category": "entertainment"},
    {"source": "khaosod_ent",    "url": "https://www.khaosod.co.th/entertainment/feed",     "category": "entertainment"},
    {"source": "matichon_ent",   "url": "https://www.matichon.co.th/entertainment/feed",    "category": "entertainment"},
    {"source": "matichon_econ",  "url": "https://www.matichon.co.th/economy/feed",          "category": "business"},
    {"source": "khaosod_econ",   "url": "https://www.khaosod.co.th/economics/feed",         "category": "business"},
]

MAX_PER_CATEGORY = 20   # ข่าวใหม่สูงสุดต่อหมวดต่อรอบ — ทุกสำนักในหมวดผลัดกันได้ทีละข่าว

# URL ที่รู้แล้วว่ามีใน Firestore — รอบถัดไปไม่ต้องอ่าน Firestore ซ้ำ (ประหยัดโควตาตอนดึงอัตโนมัติ)
_known_urls: set[str] = set()
_MAX_KNOWN_URLS = 20_000

# สถานะรอบล่าสุด — /api/status ส่งให้ frontend รู้ว่ามีข่าวใหม่เข้ามาแล้ว
LAST_RUN = {"running": False, "finished_at": None, "new_count": 0}


def _remember(url: str) -> None:
    if len(_known_urls) >= _MAX_KNOWN_URLS:
        _known_urls.clear()
    _known_urls.add(url)


def _is_known(url: str) -> bool:
    if url in _known_urls:
        return True
    if is_duplicate(url):
        _remember(url)
        return True
    return False


class NewsController:
    def run(self) -> int:
        LAST_RUN["running"] = True
        total_new = 0
        try:
            for category in dict.fromkeys(f["category"] for f in RSS_FEEDS):
                feeds = [f for f in RSS_FEEDS if f["category"] == category]
                total_new += self._process_category(category, feeds)
        finally:
            LAST_RUN.update(running=False, new_count=total_new,
                            finished_at=datetime.now(timezone.utc).isoformat())
        logger.info("เสร็จสิ้น — บันทึกข่าวใหม่ %d ข่าว", total_new)
        return total_new

    def _process_category(self, category, feeds):
        """ดึงทุก feed ในหมวดแล้วผลัดกันเอาข่าวใหม่ทีละข่าว — ถ้าวนทีละ feed สำนักแรกจะใช้โควตาหมวดหมดทุกรอบ"""
        queues = []
        for cfg in feeds:
            logger.info("กำลังดึง: %s", cfg["url"])
            queues.append((cfg, iter(fetch_feed(cfg["url"], timeout=15))))

        per_source = {cfg["source"]: 0 for cfg in feeds}
        new_count = 0
        while queues and new_count < MAX_PER_CATEGORY:
            for item in list(queues):
                if new_count >= MAX_PER_CATEGORY:
                    break
                cfg, entries = item
                article = self._next_new_article(entries, cfg)
                if article is None:  # feed นี้ไม่มีข่าวใหม่เหลือแล้ว
                    queues.remove(item)
                    continue
                if self._save(article):
                    new_count += 1
                    per_source[cfg["source"]] += 1

        logger.info("  → [%s] %d ข่าวใหม่ %s", category, new_count, per_source)
        return new_count

    def _next_new_article(self, entries, cfg):
        for entry in entries:
            article = self._entry_to_article(entry, cfg["source"], cfg["category"])
            if article is not None and not _is_known(article.source_url):
                return article
        return None

    def _save(self, article) -> bool:
        if not article.image_url:  # เปิดหน้าข่าวเฉพาะข่าวใหม่ที่ RSS ไม่มีรูป จะได้ไม่ช้า
            article.image_url = fetch_og_image(article.source_url)
        try:
            created = insert_article(article.to_dict())
        except Exception as e:
            logger.error("Insert error: %s", e)
            return False
        _remember(article.source_url)
        if created:
            logger.info("บันทึก: [%s] %s", article.source, article.title[:60])
        return created

    def _entry_to_article(self, entry, source, category):
        try:
            title = entry.get("title", "").strip()
            url   = entry.get("link",  "").strip()
            if not title or not url:
                return None
            content = clean_html(entry.get("content", [{}])[0].get("value") or entry.get("summary") or "")
            pub_dt = None
            if hasattr(entry, "published_parsed") and entry.published_parsed:
                pub_dt = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)
            return NewsArticle(title=title, source=source, source_url=url, category=category,
                               full_content=content or None, image_url=extract_image(entry),
                               published_at=pub_dt)
        except Exception as e:
            logger.error("Parse error: %s", e)
            return None


def start_auto_fetch(interval_minutes: float) -> threading.Thread:
    """ดึงข่าวทันที แล้วดึงซ้ำทุก interval_minutes นาทีใน background thread (daemon — ปิดไปพร้อม server)"""
    def loop():
        while True:
            try:
                NewsController().run()
            except Exception:
                logger.exception("ดึงข่าวอัตโนมัติไม่สำเร็จ — จะลองใหม่รอบหน้า")
            time.sleep(interval_minutes * 60)

    thread = threading.Thread(target=loop, name="auto-fetch", daemon=True)
    thread.start()
    logger.info("เปิดการดึงข่าวอัตโนมัติทุก %g นาที", interval_minutes)
    return thread


if __name__ == "__main__":
    NewsController().run()
