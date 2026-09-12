"""
services/briefing_service.py
สรุปข่าวเด่นประจำวัน — ให้ AI สรุปข่าว 24 ชั่วโมงล่าสุดของแต่ละหมวดเป็นประเด็นสั้น ๆ พร้อมลิงก์ไปข่าวต้นทาง
เก็บใน Firestore collection "briefings" (document ละวัน) และจำฉบับล่าสุดไว้ในหน่วยความจำ
"""

from __future__ import annotations
import threading
from datetime import datetime, timedelta, timezone

from services.firebase_service import latest_briefing, list_articles, save_briefing
from services.groq_service import GroqService
from services.rss_utils import clean_html

# ลำดับหมวดในหน้าสรุป + ชื่อหมวดที่ส่งให้ AI
CATEGORIES = [
    ("general", "ข่าวทั่วไป"), ("politics", "การเมือง"), ("business", "ธุรกิจ"),
    ("technology", "เทคโนโลยี"), ("sports", "กีฬา"), ("entertainment", "บันเทิง"),
]
# ส่งทุกหมวดให้ AI ในการเรียกครั้งเดียว (~5,000 token) — Groq แบบฟรีจำกัด 8,000 token ต่อนาที
# ถ้าแยกเรียกทีละหมวดจะเกินลิมิตต่อนาที
ARTICLES_PER_CATEGORY = 5
SNIPPET_CHARS = 250
WINDOW = timedelta(hours=24)
BANGKOK = timezone(timedelta(hours=7))

_cache: dict | None = None
_loaded = False
_lock = threading.Lock()


class BriefingBusyError(RuntimeError):
    """มีการสร้างสรุปข่าวเด่นอยู่แล้ว"""


def _published(article: dict) -> datetime | None:
    try:
        published = datetime.fromisoformat(article["published_at"])
    except (KeyError, TypeError, ValueError):
        return None
    # ข่าวเก่าที่บันทึกโดยไม่มี timezone — ถือเป็นเวลาไทย (ถ้าไม่ใส่ ลบกับเวลาปัจจุบันจะ error)
    return published if published.tzinfo else published.replace(tzinfo=BANGKOK)


def pick_articles(articles: list[dict], now: datetime) -> list[dict]:
    """ข่าวใน 24 ชั่วโมงล่าสุด ข่าวใหม่ก่อน และผลัดกันเลือกทีละสำนัก — ไม่ให้สำนักเดียวกินพื้นที่ทั้งหมวด"""
    recent = [a for a in articles if (t := _published(a)) and now - t <= WINDOW]
    recent.sort(key=_published, reverse=True)
    queues: dict[str, list[dict]] = {}
    for a in recent:
        queues.setdefault(a.get("source"), []).append(a)

    picked: list[dict] = []
    while len(picked) < ARTICLES_PER_CATEGORY and any(queues.values()):
        for queue in queues.values():
            if queue and len(picked) < ARTICLES_PER_CATEGORY:
                picked.append(queue.pop(0))
    return picked


def _ref(article: dict) -> dict:
    return {k: article.get(k) for k in ("id", "title", "source", "source_url")}


def build_briefing(groq: GroqService | None = None, now: datetime | None = None) -> dict | None:
    """สรุปข่าวเด่นทุกหมวด — คืน None ถ้าข่าวใน 24 ชั่วโมงล่าสุดยังไม่พอ (หมวดละอย่างน้อย 2 ข่าว)"""
    now = now or datetime.now(timezone.utc)
    groups, picked_all = [], []
    for key, label in CATEGORIES:
        picked = pick_articles(list_articles(key, limit=30), now)
        if len(picked) < 2:
            continue
        groups.append((key, label, [(a.get("title", ""), clean_html(a.get("full_content"))[:SNIPPET_CHARS])
                                    for a in picked]))
        picked_all += picked
    if not groups:
        return None

    sections = (groq or GroqService()).brief(groups)
    return {
        "date": now.astimezone(BANGKOK).date().isoformat(),
        "generated_at": now.isoformat(),
        "article_count": len(picked_all),
        "sections": [
            {"category": s["category"],
             "points": [{"text": p["text"], "articles": [_ref(picked_all[i]) for i in p["refs"]]}
                        for p in s["points"]]}
            for s in sections
        ],
    }


def generate(groq: GroqService | None = None, now: datetime | None = None) -> dict | None:
    """สร้างสรุปใหม่แล้วบันทึกลง Firestore — ถ้ามีการสร้างอยู่แล้วจะ raise BriefingBusyError
    now ใส่ได้ตอนเขียน test เพื่อไม่ให้ผลขึ้นกับเวลาจริง"""
    global _cache, _loaded
    if not _lock.acquire(blocking=False):
        raise BriefingBusyError
    try:
        briefing = build_briefing(groq, now)
        if briefing:
            save_briefing(briefing)
            _cache, _loaded = briefing, True
        return briefing
    finally:
        _lock.release()


def latest() -> dict | None:
    """ฉบับล่าสุด — อ่าน Firestore แค่ครั้งแรก หลังจากนั้นใช้ของในหน่วยความจำ"""
    global _cache, _loaded
    if not _loaded:
        _cache, _loaded = latest_briefing(), True
    return _cache


def is_stale(max_age_hours: float) -> bool:
    current = latest()
    try:
        made = datetime.fromisoformat(current["generated_at"])
    except (TypeError, KeyError, ValueError):
        return True
    return datetime.now(timezone.utc) - made >= timedelta(hours=max_age_hours)
