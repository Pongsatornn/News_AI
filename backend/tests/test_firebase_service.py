import unittest
from unittest import mock

import services.firebase_service as fs


def fake_doc(doc_id, **fields):
    doc = mock.Mock()
    doc.to_dict.return_value = fields
    doc.reference = f"ref/{doc_id}"
    return doc


class DeleteOldArticlesTest(unittest.TestCase):
    """ลบข่าวเก่ากับ Firestore จำลอง — ไม่แตะฐานข้อมูลจริง"""

    def setUp(self):
        self.collection, self.db = mock.MagicMock(), mock.MagicMock()
        for name, value in {"_articles": self.collection, "get_db": self.db}.items():
            patcher = mock.patch.object(fs, name, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.batch = self.db.batch.return_value

    def _stream(self, docs):
        self.collection.where.return_value.select.return_value.stream.return_value = iter(docs)

    def _deleted(self):
        return [c.args[0] for c in self.batch.delete.call_args_list]

    def test_keeps_articles_saved_by_user(self):
        self._stream([fake_doc("a"), fake_doc("b", saved_by_user=True),
                      fake_doc("c", publisher_url="https://pub.test"), fake_doc("d", saved_by_user=False)])
        self.assertEqual(fs.delete_old_articles("2026-08-12T00:00:00+00:00"), 2)
        self.assertEqual(self._deleted(), ["ref/a", "ref/d"])
        self.batch.commit.assert_called_once()

    def test_queries_by_created_at(self):
        self._stream([])
        fs.delete_old_articles("2026-08-12T00:00:00+00:00")
        where = self.collection.where.call_args.kwargs["filter"]
        self.assertEqual((where.field_path, where.op_string, where.value),
                         ("created_at", "<", "2026-08-12T00:00:00+00:00"))

    def test_stops_at_limit(self):
        self._stream([fake_doc(str(i)) for i in range(10)])
        self.assertEqual(fs.delete_old_articles("2026-08-12", limit=3), 3)
        self.assertEqual(self._deleted(), ["ref/0", "ref/1", "ref/2"])

    def test_nothing_old_does_not_commit(self):
        self._stream([fake_doc("a", saved_by_user=True)])
        self.assertEqual(fs.delete_old_articles("2026-08-12"), 0)
        self.batch.commit.assert_not_called()


if __name__ == "__main__":
    unittest.main()
