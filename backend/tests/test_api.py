import logging
import unittest
from unittest import mock

import httpx
from groq import RateLimitError

import api_server
from services.briefing_service import BriefingBusyError
from services.groq_service import InsufficientContentError

logging.disable(logging.CRITICAL)

TOKEN = "test-token"
SUMMARY = ["ข้อ 1", "ข้อ 2", "ข้อ 3"]
ARTICLE_TEXT = "เนื้อหาข่าว " * 30


class FakeGroq:
    def __init__(self, exc=None):
        self.exc, self.received = exc, None

    def summarise(self, text):
        self.received = text
        if self.exc:
            raise self.exc
        return SUMMARY

    def ask(self, title, content, question, history):
        self.asked = (title, content, question, history)
        if self.exc:
            raise self.exc
        return "คำตอบ"


class ApiTest(unittest.TestCase):
    """เรียก API ผ่าน Flask test client — Firestore และ Groq เป็นของจำลองทั้งหมด"""

    def setUp(self):
        self.client = api_server.app.test_client()
        for name, value in {"API_TOKEN": TOKEN, "_groq": FakeGroq()}.items():
            patcher = mock.patch.object(api_server, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def post(self, path, body, token=TOKEN):
        return self.client.post(path, json=body, headers={"X-API-Token": token} if token else {})

    # ── อ่านข่าว ──

    def test_news_flags_articles_that_can_be_summarised(self):
        articles = [{"id": "1", "full_content": "<p>" + "ก" * 150 + "</p>"},
                    {"id": "2", "full_content": None},
                    {"id": "3", "full_content": "<p>" + "ก" * 50 + '</p><img src="' + "x" * 200 + '">'}]
        with mock.patch.object(api_server, "list_articles", return_value=articles):
            results = self.client.get("/api/news").get_json()["results"]
        self.assertEqual([a["can_summarize"] for a in results], [True, False, False])

    def test_short_articles_from_our_sources_can_be_summarised(self):
        articles = [{"full_content": "สั้น", "source_url": "https://www.thairath.co.th/sport/x/1"},
                    {"full_content": "สั้น", "source_url": "https://news.google.com/rss/articles/abc"},
                    {"full_content": "สั้น", "source_url": "http://127.0.0.1:8080/admin"}]
        with mock.patch.object(api_server, "list_articles", return_value=articles):
            results = self.client.get("/api/news").get_json()["results"]
        self.assertEqual([a["can_summarize"] for a in results], [True, False, False])

    def test_news_error_hides_exception_details(self):
        with mock.patch.object(api_server, "list_articles", side_effect=RuntimeError("รายละเอียดภายใน")):
            res = self.client.get("/api/news")
        self.assertEqual(res.status_code, 500)
        self.assertNotIn("รายละเอียดภายใน", res.get_json()["error"])

    def test_status(self):
        data = self.client.get("/api/status").get_json()
        self.assertIn("auto_fetch_minutes", data)
        self.assertEqual(set(data["last_fetch"]), {"running", "finished_at", "new_count", "summarized"})

    # ── สรุปข่าวเด่น ──

    def test_get_briefing(self):
        with mock.patch.object(api_server.briefing_service, "latest", return_value={"date": "2026-09-11", "sections": []}):
            data = self.client.get("/api/briefing").get_json()
        self.assertEqual(data["briefing"]["date"], "2026-09-11")

    def test_create_briefing(self):
        rate_limited = RateLimitError("rate limited", body=None,
                                      response=httpx.Response(429, request=httpx.Request("POST", "https://api.groq.com")))
        cases = [({"return_value": {"date": "2026-09-11", "sections": []}}, 200),
                 ({"return_value": None}, 422),
                 ({"side_effect": BriefingBusyError()}, 409),
                 ({"side_effect": rate_limited}, 429),
                 ({"side_effect": EnvironmentError("no key")}, 500),
                 ({"side_effect": RuntimeError("boom")}, 502)]
        for kwargs, status in cases:
            with self.subTest(status=status), mock.patch.object(api_server.briefing_service, "generate", **kwargs):
                self.assertEqual(self.post("/api/briefing", {}).status_code, status)
        self.assertEqual(self.post("/api/briefing", {}, token=None).status_code, 401)

    def test_search_requires_keyword(self):
        self.assertEqual(self.client.get("/api/search?q=%20").status_code, 400)

    def test_search_adds_summary_flag(self):
        with mock.patch.object(api_server, "search_news", return_value=[{"full_content": None}]) as search:
            data = self.client.get("/api/search?q=AI").get_json()
        search.assert_called_once_with("AI")
        self.assertEqual(data["count"], 1)
        self.assertFalse(data["results"][0]["can_summarize"])

    # ── ติดตามหัวข้อ ──

    def test_topics(self):
        with mock.patch.object(api_server, "match_feeds", side_effect=lambda t: [{"title": t, "full_content": None}]):
            data = self.client.get("/api/topics", query_string={"q": [" ราคาทอง ", "", "AI", "AI"]}).get_json()
        self.assertEqual(set(data["results"]), {"ราคาทอง", "AI"})  # ตัดช่องว่าง/ค่าว่าง/ชื่อซ้ำ (Flask เรียง key เอง)
        self.assertIn("can_summarize", data["results"]["AI"][0])
        with mock.patch.object(api_server, "match_feeds", return_value=[]):
            data = self.client.get("/api/topics", query_string={"q": [f"หัวข้อ {i}" for i in range(15)]}).get_json()
        self.assertEqual(len(data["results"]), api_server.MAX_TOPICS)

    # ── ถาม AI ──

    def test_ask_answers_from_the_article(self):
        body = {"title": "หัว", "content": f"<p>{ARTICLE_TEXT}</p>", "question": " ใครได้รับผลกระทบ? ",
                "history": [{"question": "q1", "answer": "a1"}, {"question": "q2", "answer": "a2"},
                            {"question": "q3", "answer": "a3"}, {"question": "ยังไม่มีคำตอบ"}, "ไม่ใช่ object"]}
        res = self.post("/api/ask", body)
        self.assertEqual(res.get_json(), {"answer": "คำตอบ"})
        title, content, question, history = api_server._groq.asked
        self.assertEqual((title, content, question), ("หัว", ARTICLE_TEXT.strip(), "ใครได้รับผลกระทบ?"))
        self.assertEqual(history, [("q2", "a2"), ("q3", "a3")])  # ส่งแค่ 2 รอบล่าสุดที่มีคำตอบ

    def test_ask_validation(self):
        self.assertEqual(self.post("/api/ask", {"content": ARTICLE_TEXT, "question": "  "}).status_code, 400)
        res = self.post("/api/ask", {"content": "สั้น", "question": "อะไร"})
        self.assertEqual(res.status_code, 422)
        self.assertIn("เนื้อหาไม่พอ", res.get_json()["error"])
        self.assertEqual(self.post("/api/ask", {"question": "อะไร"}, token=None).status_code, 401)

    def test_ask_fetches_full_text_for_short_articles(self):
        url = "https://www.thairath.co.th/sport/x/1"
        with mock.patch.object(api_server, "fetch_article_text", return_value=ARTICLE_TEXT) as fetch:
            res = self.post("/api/ask", {"title": "หัว", "content": "เกริ่นนำ", "source_url": url, "question": "อะไร"})
        self.assertEqual(res.status_code, 200)
        fetch.assert_called_once_with(url)

    def test_ask_errors(self):
        rate_limited = RateLimitError("rate limited", body=None,
                                      response=httpx.Response(429, request=httpx.Request("POST", "https://api.groq.com")))
        for exc, status in ((rate_limited, 429), (RuntimeError("network"), 502)):
            with self.subTest(error=type(exc).__name__), mock.patch.object(api_server, "_groq", FakeGroq(exc)):
                res = self.post("/api/ask", {"content": ARTICLE_TEXT, "question": "อะไร"})
                self.assertEqual(res.status_code, status)

    # ── token ──

    def test_write_endpoints_require_token(self):
        for path in ("/api/summarize", "/api/save"):
            with self.subTest(path=path):
                self.assertEqual(self.post(path, {"title": "x"}, token=None).status_code, 401)
        self.assertEqual(self.client.delete("/api/delete/abc").status_code, 401)

    # ── สรุปด้วย AI ──

    def test_summarize_sends_text_without_html(self):
        res = self.post("/api/summarize", {"title": "หัว", "content": "<p>เนื้อ</p><p>หา</p>"})
        self.assertEqual(res.get_json(), {"summary": SUMMARY})
        self.assertEqual(api_server._groq.received, "หัว\nเนื้อ\nหา")

    def test_summarize_fetches_full_text_when_content_is_short(self):
        url = "https://www.thairath.co.th/sport/x/1"
        with mock.patch.object(api_server, "fetch_article_text", return_value="เนื้อหาเต็มจากหน้าข่าว") as fetch:
            self.post("/api/summarize", {"title": "หัว", "content": "เกริ่นนำ", "source_url": url})
        fetch.assert_called_once_with(url)
        self.assertEqual(api_server._groq.received, "หัว\nเนื้อหาเต็มจากหน้าข่าว")

    def test_summarize_does_not_fetch_other_sites_or_long_articles(self):
        requests = [{"content": "สั้น", "source_url": "http://127.0.0.1:8080/admin"},
                    {"content": "สั้น", "source_url": "https://news.google.com/a/1"},
                    {"content": "สั้น", "source_url": "file:///etc/passwd"},
                    {"content": "ยาว " * 200, "source_url": "https://www.thairath.co.th/news/1"}]
        with mock.patch.object(api_server, "fetch_article_text") as fetch:
            for body in requests:
                self.post("/api/summarize", {"title": "หัว", **body})
        fetch.assert_not_called()

    def test_summarize_saves_summary_when_id_given(self):
        with mock.patch.object(api_server, "update_summary") as update:
            self.post("/api/summarize", {"id": "doc1", "title": "t", "content": "c"})
        update.assert_called_once_with("doc1", SUMMARY)

    def test_summarize_errors_are_thai(self):
        rate_limited = RateLimitError("rate limited", body=None,
                                      response=httpx.Response(429, request=httpx.Request("POST", "https://api.groq.com")))
        cases = [(InsufficientContentError("short"), 422, "เนื้อหาไม่พอ"),
                 (rate_limited, 429, "โควตา"),
                 (ValueError("bad json"), 502, "AI สรุปข่าวไม่สำเร็จ"),
                 (RuntimeError("network"), 502, "AI สรุปข่าวไม่สำเร็จ")]
        for exc, status, text in cases:
            with self.subTest(error=type(exc).__name__), mock.patch.object(api_server, "_groq", FakeGroq(exc)):
                res = self.post("/api/summarize", {"title": "t", "content": "c"})
                self.assertEqual(res.status_code, status)
                self.assertIn(text, res.get_json()["error"])

    def test_summarize_without_groq_key(self):
        with mock.patch.object(api_server, "_groq", None), \
             mock.patch.object(api_server, "GroqService", side_effect=EnvironmentError("no key")):
            res = self.post("/api/summarize", {"title": "t", "content": "c"})
        self.assertEqual(res.status_code, 500)
        self.assertIn("GROQ_API_KEY", res.get_json()["error"])

    # ── บันทึกข่าว ──

    def test_save_rejects_invalid_articles(self):
        cases = [({"title": "", "source_url": "https://a.test"}, "ไม่มีหัวข่าว"),
                 ({"title": "x", "source_url": "javascript:alert(1)"}, "http:// หรือ https://")]
        for body, text in cases:
            with self.subTest(body=body):
                res = self.post("/api/save", body)
                self.assertEqual(res.status_code, 400)
                self.assertIn(text, res.get_json()["error"])

    def test_save_keeps_only_known_fields(self):
        body = {"title": " หัวข่าว ", "source_url": "https://a.test/1", "full_content": "<p>เนื้อหา</p>",
                "category": "hacked", "image_url": "javascript:x", "summary": ["ข้อ 1", 5], "extra": "x"}
        with mock.patch.object(api_server, "is_duplicate", return_value=False), \
             mock.patch.object(api_server, "insert_article", return_value=True) as insert:
            res = self.post("/api/save", body)
        self.assertEqual(res.status_code, 201)
        saved = insert.call_args.args[0]
        self.assertEqual((saved["title"], saved["category"], saved["full_content"]), ("หัวข่าว", "general", "เนื้อหา"))
        self.assertEqual((saved["image_url"], saved["summary"]), (None, ["ข้อ 1"]))
        self.assertNotIn("extra", saved)
        self.assertTrue(saved["saved_by_user"])  # ตัวลบข่าวเก่าจะข้ามข่าวที่ผู้ใช้บันทึกเอง

    def test_save_stores_published_at_in_utc(self):
        cases = [("2026-09-11T10:00:00", "2026-09-11T03:00:00+00:00"),  # ไม่มี timezone — ถือเป็นเวลาไทย
                 ("2026-09-11T10:00:00+07:00", "2026-09-11T03:00:00+00:00"),
                 ("2026-09-11T03:00:00+00:00", "2026-09-11T03:00:00+00:00")]
        for sent, stored in cases:
            with self.subTest(sent=sent), mock.patch.object(api_server, "is_duplicate", return_value=False), \
                 mock.patch.object(api_server, "insert_article", return_value=True) as insert:
                self.post("/api/save", {"title": "x", "source_url": "https://a.test/1", "published_at": sent})
                self.assertEqual(insert.call_args.args[0]["published_at"], stored)

    def test_save_duplicate(self):
        with mock.patch.object(api_server, "is_duplicate", return_value=True), \
             mock.patch.object(api_server, "insert_article") as insert:
            res = self.post("/api/save", {"title": "x", "source_url": "https://a.test/1"})
        self.assertTrue(res.get_json()["duplicate"])
        insert.assert_not_called()


if __name__ == "__main__":
    unittest.main()
