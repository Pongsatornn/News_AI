"""
services/firebase_service.py
เชื่อมต่อ Firebase Firestore — เก็บข่าวไว้ใน collection "news_articles"
"""

from __future__ import annotations
import logging
import os
import firebase_admin
from firebase_admin import credentials, firestore
from google.api_core.exceptions import AlreadyExists, FailedPrecondition
from google.cloud.firestore_v1.base_query import FieldFilter

from models.news_article import article_id

logger = logging.getLogger(__name__)

_db = None

def get_db():
    global _db
    if _db is None:
        if not firebase_admin._apps:
            cred = credentials.Certificate(
                os.path.join(os.path.dirname(__file__), "..", "serviceAccountKey.json")
            )
            firebase_admin.initialize_app(cred)
        _db = firestore.client()
    return _db

def _articles():
    return get_db().collection("news_articles")

def is_duplicate(source_url: str) -> bool:
    if _articles().document(article_id(source_url)).get().exists:
        return True
    # ข่าวที่บันทึกก่อนเปลี่ยนมาใช้ hash เป็น document id มี id แบบสุ่ม ต้องค้นจากฟิลด์แทน
    docs = _articles().where(filter=FieldFilter("source_url", "==", source_url)).limit(1).get()
    return len(docs) > 0

def insert_article(article_dict: dict) -> bool:
    """บันทึกข่าวโดยใช้ hash ของ source_url เป็น document id — คืน False ถ้ามีข่าวนี้อยู่แล้ว
    create() จะ error ถ้า document มีอยู่แล้ว จึงกันข่าวซ้ำได้แม้มีสองโปรเซสบันทึกข่าวเดียวกันพร้อมกัน"""
    try:
        _articles().document(article_id(article_dict["source_url"])).create(article_dict)
        return True
    except AlreadyExists:
        return False

def delete_article(doc_id: str) -> bool:
    try:
        _articles().document(doc_id).delete()
        return True
    except Exception as e:
        print(f"Delete error: {e}")
        return False

def update_summary(doc_id: str, summary: list[str]) -> bool:
    try:
        _articles().document(doc_id).update({"summary": summary})
        return True
    except Exception as e:
        print(f"Update error: {e}")
        return False

def list_articles(category: str | None = None, limit: int = 100) -> list[dict]:
    """ข่าวล่าสุดเรียงตาม published_at ไม่เกิน limit ข่าว"""
    query = _articles()
    if category:
        query = query.where(filter=FieldFilter("category", "==", category))
    try:
        docs = query.order_by("published_at", direction=firestore.Query.DESCENDING).limit(limit).get()
    except FailedPrecondition as e:
        # กรอง category + เรียง published_at ต้องมี composite index — ถ้ายังไม่มีให้ดึงทั้งหมวดมาเรียงเอง
        # ใน error จะมีลิงก์สำหรับสร้าง index บน Firebase console
        logger.warning("ยังไม่มี Firestore index สำหรับกรองหมวด: %s", e)
        docs = query.get()

    articles = [{**d.to_dict(), "id": d.id} for d in docs]
    articles.sort(key=lambda a: a.get("published_at") or "", reverse=True)
    return articles[:limit]

def _briefings():
    return get_db().collection("briefings")

def save_briefing(briefing: dict) -> None:
    """สรุปข่าวเด่นเก็บ document ละวัน — สร้างใหม่ในวันเดียวกันจะเขียนทับของเดิม"""
    _briefings().document(briefing["date"]).set(briefing)

def latest_briefing() -> dict | None:
    docs = _briefings().order_by("generated_at", direction=firestore.Query.DESCENDING).limit(1).get()
    return docs[0].to_dict() if docs else None
