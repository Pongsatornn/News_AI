from __future__ import annotations
import logging
import os
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

if not __package__:
    # รันเป็นไฟล์ตรง ๆ (python controllers/news_controller.py) — เพิ่มโฟลเดอร์ backend ให้ import models/services เจอ
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from groq import RateLimitError

from models.news_article import NewsArticle
from services import briefing_service
from services.firebase_service import delete_old_articles, insert_article, is_duplicate, update_summary
from services.groq_service import GroqService, InsufficientContentError
from services.logging_setup import setup_logging
from services.rss_utils import (SHORT_CONTENT, clean_html, extract_article_text, extract_image,
                                extract_og_image, fetch_feed, fetch_page)

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
MAX_READ_ERRORS = 5     # เช็กข่าวซ้ำใน Firestore พลาดครบเท่านี้ในรอบเดียว = Firestore น่าจะล่ม หยุดรอบนี้

# ให้ AI สรุปข่าวใหม่รอไว้ — Groq แบบฟรีจำกัด 1,000 ครั้ง/วัน และ 8,000 token/นาที
# 5 ข่าว × 48 รอบ/วัน = 240 ครั้ง ที่เหลือไว้ให้ผู้ใช้กดสรุปเอง
AUTO_SUMMARY_PER_RUN = int(os.environ.get("AUTO_SUMMARY_PER_RUN", "5"))  # 0 = ปิด
AUTO_SUMMARY_INPUT = 3000   # ตัวอักษร (~1,000 token)
AUTO_SUMMARY_DELAY = 20     # วินาทีระหว่างแต่ละข่าว — เหลือโควตาต่อนาทีให้ผู้ใช้กดสรุปได้ระหว่างนั้น
BRIEFING_INTERVAL_HOURS = float(os.environ.get("BRIEFING_INTERVAL_HOURS", "3"))  # 0 = ไม่สร้างเอง

# ลบข่าวเก่า — หน้าหลักแสดงแค่ 100 ข่าวล่าสุดและสรุปข่าวเด่นใช้แค่ 24 ชั่วโมง ไม่ต้องเก็บทุกข่าวไว้ตลอดไป
RETENTION_DAYS = float(os.environ.get("RETENTION_DAYS", "30"))  # 0 = เก็บไว้ตลอด
MAX_DELETE_PER_RUN = 500  # batch ของ Firestore ลบได้ครั้งละไม่เกิน 500 — ที่เหลือลบรอบถัดไป

# URL ที่รู้แล้วว่ามีใน Firestore — รอบถัดไปไม่ต้องอ่าน Firestore ซ้ำ (ประหยัดโควตาตอนดึงอัตโนมัติ)
_known_urls: set[str] = set()
_MAX_KNOWN_URLS = 20_000

# สถานะรอบล่าสุด — /api/status ส่งให้ frontend รู้ว่ามีข่าวใหม่เข้ามาแล้ว
LAST_RUN = {"running": False, "finished_at": None, "new_count": 0, "summarized": 0}


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


def _newest_first_by_category(articles: list[NewsArticle]) -> list[NewsArticle]:
    """เรียงข่าวใหม่ก่อน แล้วสลับหมวดทีละข่าว — ทุกหมวดได้สรุปก่อนที่หมวดไหนจะได้ข่าวที่สอง"""
    oldest = datetime.min.replace(tzinfo=timezone.utc)
    queues: dict[str, list[NewsArticle]] = {}
    for a in sorted(articles, key=lambda a: a.published_at or oldest, reverse=True):
        queues.setdefault(a.category, []).append(a)
    ordered = []
    while any(queues.values()):
        for queue in queues.values():
            if queue:
                ordered.append(queue.pop(0))
    return ordered


class NewsController:
    def __init__(self):
        self._new_articles: list[NewsArticle] = []
        self._read_errors = 0

    def run(self) -> int:
        LAST_RUN["running"] = True
        total_new = summarized = 0
        try:
            # feed ทั่วไปมีข่าวทุกหมวดปนอยู่ — ดึงหมวดเฉพาะก่อน ข่าวที่อยู่หลาย feed จะได้หมวดที่ตรงที่สุด
            categories = sorted(dict.fromkeys(f["category"] for f in RSS_FEEDS), key=lambda c: c == "general")
            for category in categories:
                feeds = [f for f in RSS_FEEDS if f["category"] == category]
                total_new += self._process_category(category, feeds)
            summarized = self._auto_summarise()
        finally:
            LAST_RUN.update(running=False, new_count=total_new, summarized=summarized,
                            finished_at=datetime.now(timezone.utc).isoformat())
        logger.info("เสร็จสิ้น — บันทึกข่าวใหม่ %d ข่าว, AI สรุปรอไว้ %d ข่าว", total_new, summarized)
        return total_new

    def _auto_summarise(self) -> int:
        """ให้ AI สรุปข่าวใหม่รอไว้ ผู้ใช้กดแล้วอ่านได้ทันที — สลับหมวดทีละข่าว ข่าวใหม่ก่อน
        จำกัดรอบละ AUTO_SUMMARY_PER_RUN ข่าวและเว้นระยะ ไม่ให้ใช้โควตา Groq จนผู้ใช้กดสรุปเองไม่ได้"""
        candidates = [a for a in self._new_articles if len(a.full_content or "") >= GroqService.MIN_CONTENT_LENGTH]
        if AUTO_SUMMARY_PER_RUN <= 0 or not candidates:
            return 0
        try:
            groq = GroqService()
        except EnvironmentError:
            logger.warning("ยังไม่ได้ตั้ง GROQ_API_KEY — ข้ามการสรุปรอไว้")
            return 0

        done = 0
        for i, article in enumerate(_newest_first_by_category(candidates)[:AUTO_SUMMARY_PER_RUN]):
            if i:
                time.sleep(AUTO_SUMMARY_DELAY)
            try:
                summary = groq.summarise(f"{article.title}\n{article.full_content}"[:AUTO_SUMMARY_INPUT])
            except InsufficientContentError:
                continue
            except RateLimitError:
                logger.warning("โควตา Groq เต็ม — หยุดสรุปรอไว้รอบนี้")
                break
            except Exception:
                logger.exception("สรุปรอไว้ไม่สำเร็จ: %s", article.title[:60])
                continue
            if update_summary(article.id, summary):
                done += 1
        return done

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
            if article is None:
                continue
            try:
                known = _is_known(article.source_url)
            except Exception as e:
                # อ่าน Firestore พลาด — ข้ามข่าวนี้ไปก่อน (ยังไม่จำ URL ไว้ รอบหน้าจะลองใหม่)
                # ถ้าพลาดหลายครั้งแปลว่า Firestore น่าจะล่ม หยุดรอบนี้เลย ไม่ต้องรอ timeout ทีละข่าว
                self._read_errors += 1
                logger.error("เช็กข่าวซ้ำไม่สำเร็จ: %s", e)
                if self._read_errors >= MAX_READ_ERRORS:
                    raise
                continue
            if not known:
                return article
        return None

    def _fill_from_page(self, article) -> None:
        """RSS ไม่มีรูปหรือมีแค่เกริ่นนำ (เช่นไทยรัฐ) → เปิดหน้าข่าวครั้งเดียว เอาทั้งรูปและเนื้อหาเต็ม
        ทำเฉพาะข่าวใหม่ที่กำลังจะบันทึก จะได้ไม่ช้า"""
        short = len(article.full_content or "") < SHORT_CONTENT
        if article.image_url and not short:
            return
        page = fetch_page(article.source_url)
        if not page:
            return
        if not article.image_url:
            article.image_url = extract_og_image(page)
        if short:
            text = extract_article_text(page)
            if len(text) > len(article.full_content or ""):
                article.full_content = text

    def _save(self, article) -> bool:
        self._fill_from_page(article)
        try:
            created = insert_article(article.to_dict())
        except Exception as e:
            logger.error("Insert error: %s", e)
            return False
        _remember(article.source_url)
        if created:
            logger.info("บันทึก: [%s] %s", article.source, article.title[:60])
            self._new_articles.append(article)
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


def _refresh_briefing() -> None:
    """สร้างสรุปข่าวเด่นใหม่ถ้าของเดิมเก่ากว่า BRIEFING_INTERVAL_HOURS (หรือยังไม่มี)"""
    if BRIEFING_INTERVAL_HOURS <= 0 or not briefing_service.is_stale(BRIEFING_INTERVAL_HOURS):
        return
    if LAST_RUN.get("summarized"):
        time.sleep(60)  # เพิ่งสรุปรอไว้ไป — รอให้โควตา token ต่อนาทีของ Groq ฟื้นก่อน
    try:
        briefing_service.generate()
    except briefing_service.BriefingBusyError:
        pass


def purge_old_articles() -> int:
    """ลบข่าวที่บันทึกไว้เกิน RETENTION_DAYS วัน — ข่าวที่ผู้ใช้กดบันทึกเองจะไม่ถูกลบ"""
    if RETENTION_DAYS <= 0:
        return 0
    before = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    deleted = delete_old_articles(before.isoformat(), MAX_DELETE_PER_RUN)
    if deleted:
        logger.info("ลบข่าวที่เก่ากว่า %g วันแล้ว %d ข่าว", RETENTION_DAYS, deleted)
    return deleted


def start_auto_fetch(interval_minutes: float) -> threading.Thread:
    """ดึงข่าวทันที แล้วดึงซ้ำทุก interval_minutes นาทีใน background thread (daemon — ปิดไปพร้อม server)"""
    def loop():
        while True:
            try:
                NewsController().run()
            except Exception:
                logger.exception("ดึงข่าวอัตโนมัติไม่สำเร็จ — จะลองใหม่รอบหน้า")
            try:
                purge_old_articles()
            except Exception:
                logger.exception("ลบข่าวเก่าไม่สำเร็จ — จะลองใหม่รอบหน้า")
            try:
                _refresh_briefing()
            except Exception:
                logger.exception("สร้างสรุปข่าวเด่นไม่สำเร็จ — จะลองใหม่รอบหน้า")
            time.sleep(interval_minutes * 60)

    thread = threading.Thread(target=loop, name="auto-fetch", daemon=True)
    thread.start()
    logger.info("เปิดการดึงข่าวอัตโนมัติทุก %g นาที", interval_minutes)
    return thread


if __name__ == "__main__":
    setup_logging()
    NewsController().run()
