"""
api_server.py
Flask REST API — ดึงข่าวจาก Firebase, ค้นหาข่าว, สรุปด้วย AI และบันทึก/ลบข่าว
พร้อมดึงข่าวใหม่จาก RSS อัตโนมัติทุก FETCH_INTERVAL_MINUTES นาที (ค่าเริ่มต้น 30)
รัน: python api_server.py  (ค่าเริ่มต้นเปิดให้เข้าได้เฉพาะเครื่องตัวเองที่ 127.0.0.1:5000)
"""

from __future__ import annotations
import hmac
import logging
import os
from datetime import datetime
from functools import wraps
from urllib.parse import urlparse

from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from groq import RateLimitError

load_dotenv()

from controllers.news_controller import LAST_RUN, RSS_FEEDS, start_auto_fetch
from models.news_article import NewsArticle
from services.search_service import search_news
from services.firebase_service import insert_article, is_duplicate, delete_article, list_articles, update_summary
from services.groq_service import GroqService, InsufficientContentError
from services.rss_utils import clean_html

logger = logging.getLogger(__name__)

app = Flask(__name__)
# อนุญาตเฉพาะ React frontend (Vite dev server) — เพิ่ม origin อื่นได้ใน CORS_ORIGINS คั่นด้วย ,
CORS(app, origins=os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","))

API_TOKEN = os.environ.get("API_TOKEN", "")
CATEGORIES = {f["category"] for f in RSS_FEEDS}
MAX_SUMMARY_INPUT = 20_000  # ตัวอักษร — กันข้อความยาวผิดปกติเผาโควตา Groq
FETCH_INTERVAL_MINUTES = float(os.environ.get("FETCH_INTERVAL_MINUTES", "30"))  # 0 = ไม่ดึงข่าวอัตโนมัติ

_groq: GroqService | None = None


def get_groq() -> GroqService:
    global _groq
    if _groq is None:
        _groq = GroqService()
    return _groq


def require_token(view):
    """endpoint ที่แก้ข้อมูลหรือใช้โควตา Groq ต้องส่ง header X-API-Token ให้ตรงกับ API_TOKEN ใน .env"""
    @wraps(view)
    def wrapper(*args, **kwargs):
        sent = request.headers.get("X-API-Token", "").encode()
        if API_TOKEN and not hmac.compare_digest(sent, API_TOKEN.encode()):
            return jsonify({"error": "ไม่ได้รับอนุญาต — VITE_API_TOKEN ใน frontend/.env ต้องตรงกับ API_TOKEN ใน backend/.env"}), 401
        return view(*args, **kwargs)
    return wrapper


def _text(value, max_len: int) -> str:
    return value.strip()[:max_len] if isinstance(value, str) else ""


def _http_url(value) -> str | None:
    url = _text(value, 2000)
    return url if urlparse(url).scheme in ("http", "https") else None


def _with_summary_flag(articles: list[dict]) -> list[dict]:
    """บอก frontend ว่าข่าวไหนมีเนื้อหาพอให้ AI สรุป (เช่นข่าว Google News มีแค่หัวข้อ) จะได้ซ่อนปุ่มสรุป"""
    for a in articles:
        a["can_summarize"] = len(clean_html(a.get("full_content"))) >= GroqService.MIN_CONTENT_LENGTH
    return articles


def _article_from_request(data: dict) -> NewsArticle:
    """สร้างข่าวจากข้อมูลที่ client ส่งมา — เก็บเฉพาะฟิลด์ที่รู้จักและจำกัดความยาว ไม่บันทึก JSON จาก client ตรง ๆ"""
    title = _text(data.get("title"), 500)
    source_url = _http_url(data.get("source_url"))
    if not title:
        raise ValueError("ไม่มีหัวข่าว")
    if not source_url:
        raise ValueError("ลิงก์ข่าวต้องขึ้นต้นด้วย http:// หรือ https://")

    summary = data.get("summary")
    if not isinstance(summary, list):
        summary = []
    category = data.get("category")
    try:
        published_at = datetime.fromisoformat(data["published_at"])
    except (KeyError, TypeError, ValueError):
        published_at = None

    return NewsArticle(
        title         = title,
        source        = _text(data.get("source"), 100) or "unknown",
        source_url    = source_url,
        category      = category if isinstance(category, str) and category in CATEGORIES else "general",
        full_content  = clean_html(_text(data.get("full_content"), 50_000)) or None,
        image_url     = _http_url(data.get("image_url")),
        publisher_url = _http_url(data.get("publisher_url")),
        summary       = [_text(s, 500) for s in summary[:5] if isinstance(s, str)],
        published_at  = published_at,
    )


# ── GET /api/news?category=sports ─────────────────────────────────────────────
@app.route("/api/news")
def news():
    category = request.args.get("category") or None
    try:
        return jsonify({"results": _with_summary_flag(list_articles(category))})
    except Exception:
        logger.exception("โหลดข่าวจาก Firestore ไม่สำเร็จ")
        return jsonify({"error": "โหลดข่าวไม่สำเร็จ ลองใหม่อีกครั้ง"}), 500


# ── GET /api/status ───────────────────────────────────────────────────────────
# ไม่อ่าน Firestore — frontend เช็กบ่อย ๆ ได้ว่าการดึงข่าวรอบใหม่เสร็จหรือยัง
@app.route("/api/status")
def status():
    return jsonify({"auto_fetch_minutes": FETCH_INTERVAL_MINUTES, "last_fetch": LAST_RUN})


# ── GET /api/search?q=keyword ─────────────────────────────────────────────────
@app.route("/api/search")
def search():
    keyword = request.args.get("q", "").strip()
    if not keyword:
        return jsonify({"error": "กรุณาพิมพ์คำที่ต้องการค้นหา"}), 400

    results = _with_summary_flag(search_news(keyword, max_results=20))
    return jsonify({"results": results, "count": len(results)})


# ── POST /api/summarize ───────────────────────────────────────────────────────
# body: {"title": ..., "content": ..., "id": <doc_id ถ้าเป็นข่าวที่บันทึกแล้ว>}
@app.route("/api/summarize", methods=["POST"])
@require_token
def summarize():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        data = {}
    parts = [data.get("title"), data.get("content")]
    # ข่าวเก่าใน Firestore ยังมี HTML ปนอยู่ — ตัดทิ้งก่อนส่งให้ AI
    text = clean_html("\n\n".join(p for p in parts if isinstance(p, str) and p))[:MAX_SUMMARY_INPUT]

    try:
        groq = get_groq()
    except EnvironmentError:
        return jsonify({"error": "ยังไม่ได้ตั้ง GROQ_API_KEY ใน backend/.env"}), 500
    try:
        summary = groq.summarise(text)
    except InsufficientContentError:
        return jsonify({"error": "ข่าวนี้มีเนื้อหาไม่พอให้ AI สรุป"}), 422
    except RateLimitError:
        return jsonify({"error": "ใช้โควตา AI เต็มแล้ว รอสักครู่แล้วลองใหม่"}), 429
    except Exception:
        logger.exception("สรุปข่าวด้วย Groq ไม่สำเร็จ")
        return jsonify({"error": "AI สรุปข่าวไม่สำเร็จ ลองใหม่อีกครั้ง"}), 502

    if isinstance(data.get("id"), str) and data["id"]:
        update_summary(data["id"], summary)
    return jsonify({"summary": summary})


# ── POST /api/save ────────────────────────────────────────────────────────────
@app.route("/api/save", methods=["POST"])
@require_token
def save():
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data:
        return jsonify({"error": "ไม่มีข้อมูลข่าว"}), 400

    try:
        article = _article_from_request(data)
    except ValueError as e:
        return jsonify({"error": f"ข้อมูลข่าวไม่ถูกต้อง: {e}"}), 400

    try:
        created = not is_duplicate(article.source_url) and insert_article(article.to_dict())
    except Exception:
        logger.exception("บันทึกข่าวลง Firestore ไม่สำเร็จ")
        return jsonify({"error": "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง"}), 500

    if not created:
        return jsonify({"message": "มีข่าวนี้อยู่แล้ว", "duplicate": True}), 200
    return jsonify({"message": "บันทึกสำเร็จ", "duplicate": False}), 201


# ── DELETE /api/delete/<doc_id> ───────────────────────────────────────────────
@app.route("/api/delete/<doc_id>", methods=["DELETE"])
@require_token
def delete(doc_id):
    if delete_article(doc_id):
        return jsonify({"message": "ลบสำเร็จ"}), 200
    return jsonify({"error": "ลบไม่สำเร็จ"}), 500


if __name__ == "__main__":
    if not API_TOKEN:
        print("⚠️  ยังไม่ได้ตั้ง API_TOKEN ใน backend/.env — endpoint บันทึก/ลบ/สรุปจะไม่เช็ก token")
    # debug=True เปิด Werkzeug debugger ที่สั่งรันโค้ดบนเครื่องได้ — เปิดเฉพาะตอนพัฒนาด้วย FLASK_DEBUG=1
    # และห้ามใช้คู่กับ API_HOST=0.0.0.0 (คนในวงแลนเดียวกันจะเข้าถึง debugger ได้)
    debug = os.environ.get("FLASK_DEBUG") == "1"
    # debug mode รันไฟล์นี้ 2 โปรเซส (ตัวเฝ้าไฟล์ + ตัวรับ request) — เริ่มตัวดึงข่าวเฉพาะตัวรับ request จะได้ไม่ดึงซ้ำ
    if FETCH_INTERVAL_MINUTES > 0 and (not debug or os.environ.get("WERKZEUG_RUN_MAIN") == "true"):
        start_auto_fetch(FETCH_INTERVAL_MINUTES)
    app.run(
        host=os.environ.get("API_HOST", "127.0.0.1"),
        port=5000,
        debug=debug,
    )
