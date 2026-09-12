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

# ไม่มี composite index → ดึงมาเรียงในเครื่องได้ไม่เกิน limit เท่านี้เท่า (ข่าวที่เก่ากว่านั้นยอมตกหล่นดีกว่าเผาโควตา)
FALLBACK_FACTOR = 5

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
    except Exception:
        logger.exception("ลบข่าวไม่สำเร็จ: %s", doc_id)
        return False

def update_summary(doc_id: str, summary: list[str]) -> bool:
    try:
        _articles().document(doc_id).update({"summary": summary})
        return True
    except Exception:
        logger.exception("บันทึกสรุปไม่สำเร็จ: %s", doc_id)
        return False

def delete_old_articles(before: str, limit: int = 500) -> int:
    """ลบข่าวที่บันทึกก่อน before (ISO แบบ UTC เทียบกับ created_at) ไม่เกิน limit ข่าว — คืนจำนวนที่ลบ
    ข้ามข่าวที่ผู้ใช้กดบันทึกเอง (saved_by_user) และข่าวจาก Google News (มี publisher_url — ได้มาจากการกดบันทึกเท่านั้น)
    อ่านเฉพาะสองฟิลด์นี้ ไม่ดาวน์โหลดเนื้อข่าว / batch ของ Firestore ลบได้ครั้งละไม่เกิน 500"""
    query = _articles().where(filter=FieldFilter("created_at", "<", before)).select(["saved_by_user", "publisher_url"])
    batch, deleted = get_db().batch(), 0
    for doc in query.stream():
        if deleted >= limit:
            break
        data = doc.to_dict()
        if data.get("saved_by_user") or data.get("publisher_url"):
            continue
        batch.delete(doc.reference)
        deleted += 1
    if deleted:
        batch.commit()
    return deleted

def article_exists(doc_id: str) -> bool:
    return _articles().document(doc_id).get().exists

def article_source_url(doc_id: str) -> str | None:
    """ลิงก์ข่าวของ document นี้ — ใช้ยืนยันว่า id ที่ client ส่งมาเป็นของข่าวเดียวกันจริง"""
    doc = _articles().document(doc_id).get()
    return (doc.to_dict() or {}).get("source_url") if doc.exists else None

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
        # ไม่มี index ก็เรียงเองไม่ได้ ต้องดึงมาเรียงในเครื่อง — จำกัดจำนวนไว้ ไม่งั้นหมวดใหญ่ ๆ จะกินโควตาอ่านทีละพัน
        docs = query.limit(limit * FALLBACK_FACTOR).get()

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
