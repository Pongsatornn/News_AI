import json
import unittest

from services.rss_utils import clean_html, extract_article_text, extract_image, extract_og_image


class CleanHtmlTest(unittest.TestCase):
    def test_paragraphs_become_lines(self):
        self.assertEqual(clean_html("<h1>หัวข่าว</h1>\n<p>ย่อหน้าแรก<br/>บรรทัดสอง</p>"),
                         "หัวข่าว\nย่อหน้าแรก\nบรรทัดสอง")

    def test_decodes_entities_and_collapses_spaces(self):
        self.assertEqual(clean_html("ก&amp;ข&nbsp;&nbsp;ค &#8211; ง"), "ก&ข ค – ง")

    def test_removes_script_style_and_img(self):
        html = '<script>alert(1)</script><style>p{color:red}</style><img src="a.jpg">ข้อความ'
        self.assertEqual(clean_html(html), "ข้อความ")

    def test_empty_input(self):
        self.assertEqual(clean_html(None), "")
        self.assertEqual(clean_html(""), "")


class ExtractImageTest(unittest.TestCase):
    def test_prefers_media_content(self):
        entry = {"media_content": [{"url": "https://img/1.jpg"}], "summary": '<img src="https://img/2.jpg">'}
        self.assertEqual(extract_image(entry), "https://img/1.jpg")

    def test_falls_back_to_first_img_in_content(self):
        entry = {"content": [{"value": '<p>ข่าว</p><img src="https://img/3.jpg">'}]}
        self.assertEqual(extract_image(entry), "https://img/3.jpg")

    def test_no_image(self):
        self.assertIsNone(extract_image({"summary": "ไม่มีรูป"}))


class ExtractOgImageTest(unittest.TestCase):
    def test_either_attribute_order(self):
        for tag in ('<meta property="og:image" content="https://img/a.jpg">',
                    '<meta content="https://img/a.jpg" property="og:image"/>'):
            with self.subTest(tag=tag):
                self.assertEqual(extract_og_image(tag), "https://img/a.jpg")
        self.assertIsNone(extract_og_image("<html></html>"))


class ExtractArticleTextTest(unittest.TestCase):
    def test_json_ld_article_body(self):
        # ไทยรัฐมี JSON-LD ที่มีข้อความเกินต่อท้าย ("}" เกิน) — ต้องยังอ่านได้
        page = ('<script type="application/ld+json">{"@type": "Organization"}\n}</script>'
                '<script type="application/ld+json">{"@type": "NewsArticle", "articleBody": "ย่อหน้าแรก\\nย่อหน้าสอง"}</script>')
        self.assertEqual(extract_article_text(page), "ย่อหน้าแรก\nย่อหน้าสอง")

    def test_json_ld_graph(self):
        data = {"@graph": [{"@type": "WebPage"}, {"@type": "NewsArticle", "articleBody": "<p>เนื้อข่าว</p>"}]}
        page = '<script type="application/ld+json">' + json.dumps(data) + "</script>"
        self.assertEqual(extract_article_text(page), "เนื้อข่าว")

    def test_next_js_flight_data(self):
        # หน้ากีฬาไทยรัฐ: เนื้อข่าวเป็นแถว "<id>:T<จำนวน byte แบบ hex>,<HTML>" — ภาษาไทยใช้ 3 byte ต่อตัวอักษร
        short, body = "<b>สั้น</b>", "<p>เนื้อข่าวกีฬา</p><p>ย่อหน้าสอง</p>"
        payload = ('1:"$Sreact.fragment"\n'
                   f"15:T{len(short.encode()):x},{short}\n"
                   f"16:T{len(body.encode()):x},{body}"
                   '17:["$","div",null,{}]\n')
        page = "<script>self.__next_f.push([1," + json.dumps(payload) + "])</script>"
        self.assertEqual(extract_article_text(page), "เนื้อข่าวกีฬา\nย่อหน้าสอง")

    def test_next_js_inline_content(self):
        # ข่าวที่เนื้อหาไม่ยาวมาก Next.js ใส่ไว้ในฟิลด์ "content" ตรง ๆ แทนแถว T
        item = {"items": {"title": "หัวข่าว", "content": "<p>เนื้อข่าวสั้น</p><p>ย่อหน้าสอง</p>"}}
        payload = '5:["$","article",null,' + json.dumps(item) + "]\n"
        page = "<script>self.__next_f.push([1," + json.dumps(payload) + "])</script>"
        self.assertEqual(extract_article_text(page), "เนื้อข่าวสั้น\nย่อหน้าสอง")

    def test_nothing_found(self):
        self.assertEqual(extract_article_text("<html><p>เมนู</p></html>"), "")


if __name__ == "__main__":
    unittest.main()
