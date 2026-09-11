import collections
import json
import logging
import unittest
from unittest import mock

import httpx
from groq import RateLimitError

import controllers.news_controller as nc
from services.groq_service import GroqService

logging.disable(logging.CRITICAL)


def fake_groq_class(**kwargs):
    """แทน GroqService ด้วย Mock แต่คงค่า MIN_CONTENT_LENGTH จริงไว้ ตัวดึงข่าวใช้ค่านี้คัดข่าวที่จะสรุป"""
    cls = mock.Mock(**kwargs)
    cls.MIN_CONTENT_LENGTH = GroqService.MIN_CONTENT_LENGTH
    return cls


def make_feeds(per_feed):
    return {
        cfg["url"]: [{"title": f"{cfg['source']} ข่าว {i}", "link": f"https://news.test/{cfg['source']}/{i}",
                      "summary": "<p>เนื้อหา<b>ข่าว</b></p>"} for i in range(per_feed)]
        for cfg in nc.RSS_FEEDS
    }


class FetcherTest(unittest.TestCase):
    """ตัวดึงข่าวกับ RSS/Firestore จำลอง — ไม่มีการเรียกเครือข่ายหรือเขียนฐานข้อมูลจริง"""

    def setUp(self):
        nc._known_urls.clear()
        self.feeds = make_feeds(50)
        self.db, self.inserted, self.reads = set(), [], 0

        def is_duplicate(url):
            self.reads += 1
            return url in self.db

        def insert_article(doc):
            self.db.add(doc["source_url"])
            self.inserted.append(doc)
            return True

        fakes = {
            "fetch_feed": lambda url, timeout=15: self.feeds[url],
            "fetch_page": lambda url: None,
            "is_duplicate": is_duplicate,
            "insert_article": insert_article,
            "update_summary": lambda doc_id, summary: True,
        }
        for name, fake in fakes.items():
            patcher = mock.patch.object(nc, name, side_effect=fake)
            setattr(self, name, patcher.start())
            self.addCleanup(patcher.stop)
        # ปิดการสรุปรอไว้เป็นค่าเริ่มต้น — test ที่ต้องใช้จะเปิดเองพร้อม Groq จำลอง (ไม่เรียก API จริง)
        for name, value in {"AUTO_SUMMARY_PER_RUN": 0, "AUTO_SUMMARY_DELAY": 0}.items():
            patcher = mock.patch.object(nc, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def _use_long_content(self):
        text = "<p>" + "เนื้อหาข่าวยาวพอให้สรุป " * 20 + "</p>"
        self.feeds = {url: [dict(e, summary=text) for e in entries] for url, entries in self.feeds.items()}

    def _run_with_groq(self, groq, per_run=6):
        with mock.patch.object(nc, "AUTO_SUMMARY_PER_RUN", per_run), \
             mock.patch.object(nc, "GroqService", fake_groq_class(return_value=groq)):
            return nc.NewsController().run()

    def test_every_source_gets_a_share_of_the_category_quota(self):
        nc.NewsController().run()
        by_category = collections.Counter(d["category"] for d in self.inserted)
        by_source = collections.Counter(d["source"] for d in self.inserted)
        self.assertTrue(all(n == nc.MAX_PER_CATEGORY for n in by_category.values()), by_category)
        for cfg in nc.RSS_FEEDS:
            self.assertGreaterEqual(by_source[cfg["source"]], 6, cfg["source"])

    def test_skips_articles_already_in_firestore(self):
        existing = {f"https://news.test/matichon/{i}" for i in range(5)}
        self.db |= existing
        nc.NewsController().run()
        saved = {d["source_url"] for d in self.inserted}
        self.assertFalse(saved & existing)
        self.assertTrue(any("/matichon/" in url for url in saved))

    def test_saved_content_has_no_html(self):
        nc.NewsController().run()
        self.assertTrue(all(d["full_content"] == "เนื้อหา ข่าว" for d in self.inserted))

    def test_known_urls_are_not_read_from_firestore_again(self):
        self.feeds = make_feeds(5)  # น้อยกว่าโควตา — รอบแรกบันทึกหมด
        first = nc.NewsController().run()
        self.reads = 0
        second = nc.NewsController().run()
        self.assertEqual(first, 5 * len(nc.RSS_FEEDS))
        self.assertEqual((second, self.reads), (0, 0))

    def test_insert_error_does_not_stop_the_run(self):
        def insert_article(doc):
            if doc["source_url"].endswith("/matichon/0"):
                raise RuntimeError("Firestore ล่ม")
            self.inserted.append(doc)
            return True
        self.insert_article.side_effect = insert_article
        total = nc.NewsController().run()
        self.assertEqual(total, nc.MAX_PER_CATEGORY * len({f["category"] for f in nc.RSS_FEEDS}))

    def test_story_in_general_feed_gets_the_specific_category(self):
        url_of = {cfg["source"]: cfg["url"] for cfg in nc.RSS_FEEDS}
        story = self.feeds[url_of["matichon_pol"]][0]
        self.feeds[url_of["matichon"]].insert(0, story)  # feed ทั่วไปมีข่าวการเมืองชิ้นเดียวกันอยู่ต้น feed
        nc.NewsController().run()
        [saved] = [d for d in self.inserted if d["source_url"] == story["link"]]
        self.assertEqual(saved["category"], "politics")

    def test_firestore_read_error_skips_only_that_article(self):
        def is_duplicate(url):
            if url.endswith("/matichon/0"):
                raise RuntimeError("Firestore timeout")
            return url in self.db
        self.is_duplicate.side_effect = is_duplicate
        total = nc.NewsController().run()
        self.assertEqual(total, nc.MAX_PER_CATEGORY * len({f["category"] for f in nc.RSS_FEEDS}))
        self.assertNotIn("https://news.test/matichon/0", {d["source_url"] for d in self.inserted})

    def test_run_stops_when_firestore_is_down(self):
        self.is_duplicate.side_effect = RuntimeError("Firestore ล่ม")
        with self.assertRaises(RuntimeError):
            nc.NewsController().run()
        self.assertEqual(self.is_duplicate.call_count, nc.MAX_READ_ERRORS)  # ไม่รอ timeout ทีละข่าวทั้งรอบ
        self.assertFalse(nc.LAST_RUN["running"])

    def test_short_rss_content_is_replaced_with_text_from_the_page(self):
        body = "เนื้อข่าวเต็มจากหน้าเว็บ " * 30
        page = '<script type="application/ld+json">' + json.dumps({"@type": "NewsArticle", "articleBody": body}) + "</script>"
        self.fetch_page.side_effect = lambda url: page if "/thairath_sport/" in url else None
        nc.NewsController().run()
        sport = [d for d in self.inserted if d["source"] == "thairath_sport"]
        self.assertTrue(sport)
        self.assertTrue(all(d["full_content"] == body.strip() for d in sport))

    def test_page_is_not_opened_when_rss_has_image_and_full_text(self):
        long_text = "<p>" + "เนื้อหา " * 100 + "</p>"
        self.feeds = {url: [dict(e, summary=long_text, media_content=[{"url": "https://img.test/1.jpg"}]) for e in entries]
                      for url, entries in self.feeds.items()}
        nc.NewsController().run()
        self.assertTrue(self.inserted)
        self.fetch_page.assert_not_called()

    def test_new_articles_are_summarised_in_advance_one_per_category(self):
        self._use_long_content()
        groq = mock.Mock()
        groq.summarise.return_value = ["ข้อ 1"]
        self._run_with_groq(groq, per_run=6)
        ids = [c.args[0] for c in self.update_summary.call_args_list]
        category_of = {d["id"]: d["category"] for d in self.inserted}
        self.assertEqual(len(ids), 6)
        self.assertEqual(len({category_of[i] for i in ids}), 6)  # ทุกหมวดได้ก่อนหมวดไหนจะได้ข่าวที่สอง
        self.assertEqual(nc.LAST_RUN["summarized"], 6)

    def test_rate_limit_stops_auto_summary(self):
        self._use_long_content()
        groq = mock.Mock()
        groq.summarise.side_effect = RateLimitError(
            "rate limited", body=None, response=httpx.Response(429, request=httpx.Request("POST", "https://api.groq.com")))
        self.assertGreater(self._run_with_groq(groq), 0)
        self.assertEqual(groq.summarise.call_count, 1)
        self.update_summary.assert_not_called()

    def test_auto_summary_skips_short_articles_and_missing_key(self):
        groq = mock.Mock()
        self._run_with_groq(groq)  # เนื้อหาในข่าวจำลองสั้นเกินกว่าจะสรุป
        groq.summarise.assert_not_called()

        self._use_long_content()
        nc._known_urls.clear()
        self.db.clear()
        with mock.patch.object(nc, "AUTO_SUMMARY_PER_RUN", 6), \
             mock.patch.object(nc, "GroqService", fake_groq_class(side_effect=EnvironmentError("no key"))):
            self.assertGreater(nc.NewsController().run(), 0)
        self.update_summary.assert_not_called()

    def test_last_run_status_is_updated(self):
        total = nc.NewsController().run()
        self.assertFalse(nc.LAST_RUN["running"])
        self.assertEqual(nc.LAST_RUN["new_count"], total)
        self.assertIsNotNone(nc.LAST_RUN["finished_at"])


if __name__ == "__main__":
    unittest.main()
