"""
services/logging_setup.py
เขียน log ทั้งบนหน้าจอและลงไฟล์ backend/logs/newsai.log — ปิด terminal แล้วยังย้อนดูได้ว่าตัวดึงข่าวหรือ Groq error ตอนไหน
เรียกจากจุดเริ่มโปรแกรมเท่านั้น (api_server.py / news_controller.py) — import เฉย ๆ เช่นตอนรัน test จะไม่เขียนไฟล์
"""

from __future__ import annotations
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s — %(message)s"
MAX_BYTES = 1_000_000   # ไฟล์ละ ~1 MB
BACKUP_COUNT = 5        # เก็บไฟล์เก่าไว้ 5 ไฟล์ (newsai.log.1 … .5) รวมไม่เกินราว 6 MB
_FILE_HANDLER = "newsai-file"


def _skip_request_lines(record: logging.LogRecord) -> bool:
    """ไม่เขียน log ของแต่ละ request ลงไฟล์ — หน้าเว็บเช็ก /api/status ทุกนาที ไฟล์จะเต็มไปด้วยบรรทัดพวกนี้"""
    return record.name != "werkzeug" or record.levelno >= logging.WARNING


def setup_logging(log_dir: Path = LOG_DIR) -> Path:
    """log ระดับ INFO ขึ้นไปออกหน้าจอและลงไฟล์ — เรียกซ้ำได้ ไม่เพิ่มไฟล์ซ้ำ"""
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT)
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    path = Path(log_dir) / "newsai.log"
    if any(h.get_name() == _FILE_HANDLER for h in root.handlers):
        return path

    path.parent.mkdir(parents=True, exist_ok=True)
    # delay=True เปิดไฟล์ตอนเขียนครั้งแรก — FLASK_DEBUG=1 มี 2 โปรเซส ตัวเฝ้าไฟล์ที่ไม่ได้เขียนอะไรจะไม่ถือไฟล์ค้างไว้
    handler = RotatingFileHandler(path, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8", delay=True)
    handler.set_name(_FILE_HANDLER)
    handler.setFormatter(logging.Formatter(LOG_FORMAT))
    handler.addFilter(_skip_request_lines)
    root.addHandler(handler)
    return path
