import json
import unittest

from services.groq_service import GroqService, InsufficientContentError


class ParseResponseTest(unittest.TestCase):
    def setUp(self):
        self.groq = GroqService.__new__(GroqService)  # ข้าม __init__ — ไม่ต้องใช้ API key และไม่เรียก API จริง

    def test_returns_bullets(self):
        self.assertEqual(self.groq._parse_response('{"summary": ["ก", "ข", "ค"]}'), ["ก", "ข", "ค"])

    def test_strips_markdown_fence(self):
        self.assertEqual(self.groq._parse_response('```json\n{"summary": ["ก"]}\n```'), ["ก"])

    def test_keeps_at_most_five_bullets(self):
        raw = '{"summary": ["1", "2", "3", "4", "5", "6", "7"]}'
        self.assertEqual(len(self.groq._parse_response(raw)), 5)

    def test_drops_bullets_that_are_not_text(self):
        self.assertEqual(self.groq._parse_response('{"summary": ["ก", 1, "  ", "ข"]}'), ["ก", "ข"])

    def test_ai_reports_insufficient_content(self):
        with self.assertRaises(InsufficientContentError):
            self.groq._parse_response('{"error": "insufficient_content"}')

    def test_invalid_responses_are_not_reported_as_insufficient_content(self):
        for raw in ("ไม่ใช่ JSON", "[1, 2]", '{"summary": []}'):
            with self.subTest(raw=raw), self.assertRaises(ValueError) as ctx:
                self.groq._parse_response(raw)
            self.assertNotIsInstance(ctx.exception, InsufficientContentError)

    def test_short_content_is_rejected_before_calling_api(self):
        with self.assertRaises(InsufficientContentError):
            self.groq.summarise("สั้นเกินไป")


class BriefingTest(unittest.TestCase):
    def setUp(self):
        self.groq = GroqService.__new__(GroqService)
        self.sent, self.reply = [], ""

        def fake_chat(system, user, max_tokens):
            self.sent.append(user)
            return self.reply
        self.groq._chat = fake_chat

    def test_numbers_articles_across_categories_and_maps_refs(self):
        self.reply = json.dumps({"sections": [
            {"category": "sports", "points": [{"text": "ประเด็นกีฬา", "refs": [3]}]},
            {"category": "politics", "points": [{"text": "ประเด็นการเมือง", "refs": [2, 1, 2]}]},
        ]})
        result = self.groq.brief([("politics", "การเมือง", [("หัว 1", "เนื้อ 1"), ("หัว 2", "เนื้อ 2")]),
                                  ("sports", "กีฬา", [("หัว 3", "เนื้อ 3")])])
        self.assertIn("## sports (กีฬา)\n\n[3] หัว 3\nเนื้อ 3", self.sent[0])
        self.assertEqual(result, [  # เรียงหมวดตามที่ส่งไป และแปลงเลขข่าวเป็นลำดับเริ่มจาก 0
            {"category": "politics", "points": [{"text": "ประเด็นการเมือง", "refs": [0, 1]}]},
            {"category": "sports", "points": [{"text": "ประเด็นกีฬา", "refs": [2]}]},
        ])

    def test_drops_unknown_categories_empty_points_and_bad_refs(self):
        self.reply = json.dumps({"sections": [
            {"category": "unknown", "points": [{"text": "x", "refs": [1]}]},
            {"category": "politics", "points": [{"text": "  "}, "ไม่ใช่ object",
                                                {"text": "ใช้ได้", "refs": [0, 1, 99, "1", True]}]},
        ]})
        result = self.groq.brief([("politics", "การเมือง", [("หัว", "เนื้อ")])])
        self.assertEqual(result, [{"category": "politics", "points": [{"text": "ใช้ได้", "refs": [0]}]}])

    def test_no_usable_sections(self):
        for reply in ('{"sections": []}', '{"error": "x"}', "ไม่ใช่ JSON"):
            self.reply = reply
            with self.subTest(reply=reply), self.assertRaises(ValueError):
                self.groq.brief([("politics", "การเมือง", [("หัว", "เนื้อ")])])


class AskTest(unittest.TestCase):
    def setUp(self):
        self.groq = GroqService.__new__(GroqService)
        self.sent, self.reply = [], "คำตอบ"

        def fake_complete(messages, max_tokens):
            self.sent.append(messages)
            return self.reply
        self.groq._complete = fake_complete

    def test_article_goes_in_system_and_history_before_question(self):
        self.assertEqual(self.groq.ask("หัวข่าว", "เนื้อหา", "ถามอะไร", [("q1", "a1")]), "คำตอบ")
        messages = self.sent[0]
        self.assertIn("<ข่าว>\nหัวข่าว\n\nเนื้อหา\n</ข่าว>", messages[0]["content"])
        self.assertEqual([m["role"] for m in messages], ["system", "user", "assistant", "user"])
        self.assertEqual(messages[-1]["content"], "ถามอะไร")

    def test_strips_thinking_and_rejects_empty_answer(self):
        self.reply = "<think>ลองคิดดู...</think>\n  คำตอบจริง  "
        self.assertEqual(self.groq.ask("t", "c", "q"), "คำตอบจริง")
        self.reply = "<think>คิดอย่างเดียว</think>"
        with self.assertRaises(ValueError):
            self.groq.ask("t", "c", "q")


if __name__ == "__main__":
    unittest.main()
