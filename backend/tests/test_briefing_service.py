import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

import services.briefing_service as bs

NOW = datetime(2026, 9, 11, 12, 0, tzinfo=timezone.utc)


def article(i, source="matichon", hours_ago=1, category="politics"):
    return {"id": f"id{i}", "title": f"ข่าว {i}", "source": source, "source_url": f"https://news.test/{i}",
            "category": category, "full_content": f"<p>เนื้อหา {i}</p>",
            "published_at": (NOW - timedelta(hours=hours_ago)).isoformat()}


class FakeGroq:
    """ตอบทุกหมวดด้วยประเด็นเดียวที่อ้างถึง 2 ข่าวแรกของหมวดนั้น (หมายเลขข่าวนับรวมทุกหมวด)"""

    def __init__(self):
        self.calls = []

    def brief(self, categories):
        self.calls.append(categories)
        result, offset = [], 0
        for key, _, items in categories:
            result.append({"category": key, "points": [{"text": f"สรุป {key}", "refs": [offset, offset + 1]}]})
            offset += len(items)
        return result


class PickArticlesTest(unittest.TestCase):
    def test_recent_news_only_newest_first_and_mixed_sources(self):
        articles = ([article(i, "matichon", hours_ago=i) for i in range(1, 7)]
                    + [article(10, "khaosod", hours_ago=2), article(11, "khaosod", hours_ago=3),
                       article(99, "khaosod", hours_ago=30)])
        picked = bs.pick_articles(articles, NOW)
        self.assertEqual([a["id"] for a in picked], ["id1", "id10", "id2", "id11", "id3"])

    def test_articles_without_date_are_skipped(self):
        undated = dict(article(1), published_at=None)
        self.assertEqual(bs.pick_articles([undated, article(2)], NOW), [article(2)])

    def test_articles_without_timezone_count_as_thai_time(self):
        # เคยทำให้สร้างสรุปทั้งฉบับ error — TypeError: can't subtract offset-naive and offset-aware datetimes
        naive = dict(article(1), published_at="2026-09-11T18:00:00")    # 11:00 UTC = 1 ชั่วโมงก่อน NOW
        too_old = dict(article(2), published_at="2026-09-10T18:00:00")  # 25 ชั่วโมงก่อน NOW
        recent = article(3, hours_ago=2)
        self.assertEqual(bs.pick_articles([naive, too_old, recent], NOW), [naive, recent])


class BuildBriefingTest(unittest.TestCase):
    def setUp(self):
        bs._cache, bs._loaded = None, False
        by_category = {
            "politics": [article(1, hours_ago=1), article(2, hours_ago=2), article(3, hours_ago=3)],
            "sports": [article(10, hours_ago=1, category="sports"), article(11, hours_ago=2, category="sports")],
            "business": [article(20, category="business")],  # ข่าวเดียว — ไม่พอให้สรุป
        }
        patcher = mock.patch.object(bs, "list_articles", side_effect=lambda key, limit=30: by_category.get(key, []))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_sections_link_back_to_articles(self):
        groq = FakeGroq()
        briefing = bs.build_briefing(groq, NOW)
        self.assertEqual(briefing["date"], "2026-09-11")
        self.assertEqual([s["category"] for s in briefing["sections"]], ["politics", "sports"])
        self.assertEqual([a["title"] for a in briefing["sections"][1]["points"][0]["articles"]], ["ข่าว 10", "ข่าว 11"])
        self.assertEqual(groq.calls[0][0][2][0], ("ข่าว 1", "เนื้อหา 1"))  # ส่งเนื้อหาที่ตัด HTML แล้ว
        self.assertEqual(len(groq.calls), 1)  # ทุกหมวดในการเรียกครั้งเดียว

    def test_not_enough_news(self):
        groq = FakeGroq()
        with mock.patch.object(bs, "list_articles", return_value=[]):
            self.assertIsNone(bs.build_briefing(groq, NOW))
        self.assertEqual(groq.calls, [])

    def test_generate_saves_and_caches(self):
        with mock.patch.object(bs, "save_briefing") as save, \
             mock.patch.object(bs, "latest_briefing", side_effect=AssertionError("ไม่ควรอ่าน Firestore")):
            briefing = bs.generate(FakeGroq(), NOW)
            self.assertIs(bs.latest(), briefing)
        save.assert_called_once_with(briefing)

    def test_generate_runs_one_at_a_time(self):
        with bs._lock:
            with self.assertRaises(bs.BriefingBusyError):
                bs.generate(FakeGroq(), NOW)


class IsStaleTest(unittest.TestCase):
    def setUp(self):
        bs._cache, bs._loaded = None, False

    def test_no_briefing_yet(self):
        with mock.patch.object(bs, "latest_briefing", return_value=None):
            self.assertTrue(bs.is_stale(3))

    def test_age(self):
        now = datetime.now(timezone.utc)
        for hours_ago, stale in ((1, False), (4, True)):
            with self.subTest(hours_ago=hours_ago):
                bs._cache, bs._loaded = {"generated_at": (now - timedelta(hours=hours_ago)).isoformat()}, True
                self.assertEqual(bs.is_stale(3), stale)


if __name__ == "__main__":
    unittest.main()
