import logging
import tempfile
import unittest
from logging.handlers import RotatingFileHandler

from services.logging_setup import setup_logging


class LoggingSetupTest(unittest.TestCase):
    """เขียน log ลงไฟล์ในโฟลเดอร์ชั่วคราว — ไม่แตะ backend/logs จริง"""

    def setUp(self):
        root = logging.getLogger()
        saved_handlers, saved_level = root.handlers[:], root.level
        saved_disable = logging.root.manager.disable
        logging.disable(logging.NOTSET)  # test อื่นปิด logging ไว้ทั้งหมด — เปิดคืนเฉพาะใน test นี้
        root.handlers = [logging.NullHandler()]  # basicConfig จะได้ไม่พิมพ์ log ของ test ออกหน้าจอ
        self.tmp = tempfile.TemporaryDirectory()

        def restore():
            for h in root.handlers:
                h.close()  # Windows ลบไฟล์ที่ยังเปิดอยู่ไม่ได้
            root.handlers = saved_handlers
            root.setLevel(saved_level)
            logging.disable(saved_disable)
            self.tmp.cleanup()
        self.addCleanup(restore)

    def _read(self, path):
        return path.read_text(encoding="utf-8")

    def test_writes_thai_messages_to_file(self):
        path = setup_logging(self.tmp.name)
        logging.getLogger("controllers.news_controller").error("ดึงข่าวไม่สำเร็จ")
        self.assertIn("[ERROR] controllers.news_controller — ดึงข่าวไม่สำเร็จ", self._read(path))

    def test_request_lines_are_not_written(self):
        path = setup_logging(self.tmp.name)
        logging.getLogger("werkzeug").info('"GET /api/status HTTP/1.1" 200 -')
        logging.getLogger("werkzeug").warning("port ถูกใช้อยู่")
        text = self._read(path)
        self.assertNotIn("/api/status", text)
        self.assertIn("port ถูกใช้อยู่", text)

    def test_calling_twice_adds_one_file_handler(self):
        setup_logging(self.tmp.name)
        setup_logging(self.tmp.name)
        handlers = [h for h in logging.getLogger().handlers if isinstance(h, RotatingFileHandler)]
        self.assertEqual(len(handlers), 1)


if __name__ == "__main__":
    unittest.main()
