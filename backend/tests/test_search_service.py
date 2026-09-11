import time
import unittest
from unittest import mock

import feedparser

import services.search_service as ss
from controllers.news_controller import RSS_FEEDS

URL_OF = {cfg["source"]: cfg["url"] for cfg in RSS_FEEDS}


def entry(title, link, summary="", hours_ago=None, **extra):
    e = feedparser.FeedParserDict(title=title, link=link, summary=summary, **extra)
    if hours_ago is not None:
        e["published_parsed"] = time.gmtime(time.time() - hours_ago * 3600)
    return e


class SearchTest(unittest.TestCase):
    """ค้นหากับ RSS จำลอง — ไม่มีการเรียกเครือข่ายจริง"""

    def setUp(self):
        ss._feed_cache.clear()
        ss._refreshing.clear()
        self.feed_entries, self.google_entries, self.calls = {}, [], []

        def fetch_feed(url, timeout=8):
            self.calls.append(url)
            return self.google_entries if "news.google.com" in url else self.feed_entries.get(url, [])

        patcher = mock.patch.object(ss, "fetch_feed", side_effect=fetch_feed)
        patcher.start()
        self.addCleanup(patcher.stop)

    def titles(self, keyword, **kwargs):
        return [a["title"] for a in ss.search_news(keyword, **kwargs)]

    def test_every_word_must_appear(self):
        self.feed_entries[URL_OF["khaosod_sport"]] = [
            entry("ทีมชาติไทยชนะ", "https://k/1", "<p>ฟุตบอลนัดกระชับมิตร</p>"),
            entry("ฟุตบอลโลก", "https://k/2", "ญี่ปุ่นชนะ"),
        ]
        self.assertEqual(self.titles("ฟุตบอล ไทย"), ["ทีมชาติไทยชนะ"])

    def test_english_words_match_whole_words_only(self):
        self.feed_entries[URL_OF["blognone"]] = [
            entry("Thailand Open", "https://b/1"),
            entry("OpenAI เปิดตัวโมเดลใหม่", "https://b/2"),
            entry("AI ช่วยแพทย์วินิจฉัย", "https://b/3"),
        ]
        self.assertEqual(self.titles("ai"), ["AI ช่วยแพทย์วินิจฉัย"])

    def test_html_attributes_are_not_searched(self):
        self.feed_entries[URL_OF["matichon"]] = [entry("ข่าวทั่วไป", "https://m/1", '<img src="https://x/ai.jpg">')]
        self.assertEqual(self.titles("ai"), [])

    def test_results_are_newest_first(self):
        self.feed_entries[URL_OF["matichon"]] = [entry("AI เก่า", "https://m/1", hours_ago=5),
                                                 entry("AI ใหม่", "https://m/2", hours_ago=1)]
        self.google_entries = [entry("AI กลาง", "https://g/1", hours_ago=3)]
        self.assertEqual(self.titles("ai"), ["AI ใหม่", "AI กลาง", "AI เก่า"])

    def test_same_story_in_two_feeds_appears_once_with_specific_category(self):
        story = entry("ผลบอลเมื่อคืน", "https://m/sport/1")
        self.feed_entries[URL_OF["matichon"]] = [story]
        self.feed_entries[URL_OF["matichon_sport"]] = [story]
        results = ss.search_news("ผลบอล")
        self.assertEqual([(a["title"], a["category"]) for a in results], [("ผลบอลเมื่อคืน", "sports")])

    def test_google_results_use_publisher_and_have_no_content(self):
        self.google_entries = [entry("หัวข่าว AI - ไทยรัฐ", "https://news.google.com/a/1",
                                     '<a href="https://news.google.com/a/1">หัวข่าว AI</a> ไทยรัฐ',
                                     source=feedparser.FeedParserDict(title="ไทยรัฐ", href="https://www.thairath.co.th"))]
        [article] = ss.search_news("ai")
        self.assertEqual((article["title"], article["source"]), ("หัวข่าว AI", "ไทยรัฐ"))
        self.assertEqual(article["publisher_url"], "https://www.thairath.co.th")
        self.assertIsNone(article["full_content"])

    def test_google_copy_of_our_story_is_skipped(self):
        self.feed_entries[URL_OF["thairath"]] = [entry("หัวข่าว AI", "https://thairath/1")]
        self.google_entries = [entry("หัวข่าว AI - ไทยรัฐ", "https://news.google.com/a/1",
                                     source=feedparser.FeedParserDict(title="ไทยรัฐ"))]
        self.assertEqual([a["source"] for a in ss.search_news("ai")], ["thairath"])

    def test_feeds_are_cached_between_searches(self):
        # feed ที่ดึงแล้วว่างถือว่าดึงไม่สำเร็จและจะไม่ถูก cache — จึงให้ทุก feed มีข่าว
        for source, url in URL_OF.items():
            self.feed_entries[url] = [entry(f"ข่าว {source}", f"https://{source}/1")]
        ss.search_news("ai")
        self.calls.clear()
        ss.search_news("บอล")
        self.assertEqual(len(self.calls), 1)
        self.assertIn("news.google.com", self.calls[0])

    def test_stale_cache_is_used_while_refreshing_in_background(self):
        url = URL_OF["blognone"]
        self.feed_entries[url] = [entry("ข่าวเก่า AI", "https://b/old")]
        ss.search_news("ai")
        self.feed_entries[url] = [entry("ข่าวใหม่ AI", "https://b/new")]
        with mock.patch.object(ss, "FEED_CACHE_TTL", -1):
            self.assertEqual(self.titles("ai"), ["ข่าวเก่า AI"])  # ไม่ต้องรอโหลดใหม่
        deadline = time.monotonic() + 5
        while ss._refreshing and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(self.titles("ai"), ["ข่าวใหม่ AI"])

    def test_our_results_are_kept_when_google_has_many_newer_ones(self):
        self.feed_entries[URL_OF["blognone"]] = [entry(f"AI ของเรา {i}", f"https://b/{i}", hours_ago=48) for i in range(3)]
        self.google_entries = [entry(f"AI จาก Google {i}", f"https://g/{i}", hours_ago=1) for i in range(100)]
        results = ss.search_news("ai")
        self.assertEqual(len(results), ss.MAX_RESULTS)
        self.assertEqual([a["source"] for a in results[-3:]], ["blognone"] * 3)  # เก่าสุดจึงอยู่ท้าย แต่ไม่ถูกตัดทิ้ง

    def test_result_limit(self):
        self.feed_entries[URL_OF["matichon"]] = [entry(f"AI ข่าว {i}", f"https://m/{i}") for i in range(70)]
        self.assertEqual(len(ss.search_news("ai")), ss.MAX_RESULTS)
        self.assertEqual(len(ss.search_news("ai", max_results=5)), 5)

    def test_match_feeds_for_followed_topics_uses_only_our_feeds(self):
        self.feed_entries[URL_OF["matichon_econ"]] = [entry("ราคาทองวันนี้ขึ้น", "https://m/1", hours_ago=2),
                                                      entry("ราคาทองร่วงแรง", "https://m/2", hours_ago=1),
                                                      entry("หุ้นไทยปิดบวก", "https://m/3", hours_ago=1)]
        self.google_entries = [entry("ราคาทองจาก Google", "https://g/1")]
        self.assertEqual([a["title"] for a in ss.match_feeds("ราคาทอง")], ["ราคาทองร่วงแรง", "ราคาทองวันนี้ขึ้น"])
        self.assertFalse(any("news.google.com" in url for url in self.calls))
        self.assertEqual(ss.match_feeds("  "), [])

    def test_blank_keyword(self):
        self.assertEqual(ss.search_news("   "), [])


if __name__ == "__main__":
    unittest.main()
