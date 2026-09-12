"""
services/rss_utils.py
Helper สำหรับอ่านข้อมูลจาก RSS entry และหน้าข่าว (ใช้ร่วมกันระหว่าง news_controller, search_service และ api_server)
"""

from __future__ import annotations
import html
import json
import re
import urllib.request

import feedparser
from urllib.parse import urlparse

SHORT_CONTENT = 400  # ตัวอักษร — เนื้อหาใน RSS ที่สั้นกว่านี้เป็นแค่เกริ่นนำ (เช่นไทยรัฐ) ต้องไปดึงเนื้อหาเต็มจากหน้าข่าว

_IMG_TAG = re.compile(r"<img[^>]+src=[\"']([^\"']+)")
_OG_IMAGE = re.compile(
    r"<meta[^>]+property=[\"']og:image[\"'][^>]+content=[\"']([^\"']+)"
    r"|<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+property=[\"']og:image[\"']"
)
_BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "th,en;q=0.8",
}
_FEED_HEADERS = {**_BROWSER_HEADERS, "Accept": "application/rss+xml,application/xml,text/xml,*/*;q=0.8"}
_SCRIPT_TAG = re.compile(r"<(script|style)\b.*?</\1>", re.I | re.S)
_BLOCK_END = re.compile(r"</(p|div|h[1-6]|li|blockquote|figcaption)>|<br\s*/?>", re.I)
_ANY_TAG = re.compile(r"<[^>]+>")
_LD_JSON = re.compile(r"<script[^>]+application/ld\+json[^>]*>(.*?)</script>", re.S | re.I)
_NEXT_PUSH = re.compile(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)', re.S)
_FLIGHT_TEXT_ROW = re.compile(rb"(?:^|\n)[0-9a-z]+:T([0-9a-f]+),")
_FLIGHT_CONTENT = re.compile(r'"content":\s*("(?:[^"\\]|\\.)*")')


class _SameHostRedirect(urllib.request.HTTPRedirectHandler):
    """ยอมตาม redirect เฉพาะไป host ที่อนุญาต — กันเว็บข่าวเด้งต่อไปยังเครื่องในวงแลนหรือ 127.0.0.1
    (คืน None = ไม่ตาม redirect นั้น urllib จะโยน HTTPError ออกมาแทน)"""

    def __init__(self, allowed_hosts):
        self.allowed_hosts = allowed_hosts

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urlparse(newurl)
        if target.scheme not in ("http", "https") or target.hostname not in self.allowed_hosts:
            return None
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _open(req, timeout: float, allowed_hosts):
    if allowed_hosts is None:
        return urllib.request.urlopen(req, timeout=timeout)
    return urllib.request.build_opener(_SameHostRedirect(allowed_hosts)).open(req, timeout=timeout)


def clean_html(text: str | None) -> str:
    """ตัดแท็ก HTML ออกจากเนื้อหาข่าวใน RSS เหลือแค่ข้อความ (ขึ้นบรรทัดใหม่ตามย่อหน้า)"""
    if not text:
        return ""
    text = _BLOCK_END.sub("\n", _SCRIPT_TAG.sub(" ", text))
    text = html.unescape(_ANY_TAG.sub(" ", text))
    lines = (" ".join(line.split()) for line in text.splitlines())
    return "\n".join(line for line in lines if line)


def fetch_feed(url: str, timeout: float = 8) -> list:
    """ดึง RSS แล้วคืน entries — feedparser.parse(url) ไม่มี timeout ถ้าเว็บค้างจะรอไปเรื่อย ๆ จึงโหลดเองก่อน"""
    try:
        req = urllib.request.Request(url, headers=_FEED_HEADERS)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return feedparser.parse(resp.read()).entries
    except Exception:
        return []


def extract_image(entry) -> str | None:
    """หา URL รูปประกอบข่าว: media:content → media:thumbnail → enclosure → <img> แรกในเนื้อหา"""
    for key in ("media_content", "media_thumbnail"):
        for media in entry.get(key) or []:
            if media.get("url"):
                return media["url"]

    for link in entry.get("links", []):
        if link.get("type", "").startswith("image") and link.get("href"):
            return link["href"]

    html = (entry.get("content") or [{}])[0].get("value") or entry.get("summary") or ""
    m = _IMG_TAG.search(html)
    return m.group(1) if m else None


def fetch_page(page_url: str, timeout: float = 10, max_bytes: int = 2_000_000,
               allowed_hosts: set[str] | None = None) -> str | None:
    """โหลด HTML ของหน้าข่าว — คืน None ถ้าโหลดไม่ได้
    allowed_hosts: ใส่เมื่อ URL มาจาก client — จะไม่ตาม redirect ออกนอก host เหล่านี้"""
    try:
        req = urllib.request.Request(page_url, headers=_BROWSER_HEADERS)
        with _open(req, timeout, allowed_hosts) as resp:
            return resp.read(max_bytes).decode("utf-8", "ignore")
    except Exception:
        return None


def extract_og_image(page_html: str) -> str | None:
    """รูปสำรองเมื่อ RSS ไม่มีรูป: <meta property="og:image">"""
    m = _OG_IMAGE.search(page_html)
    return (m.group(1) or m.group(2)) if m else None


def extract_article_text(page_html: str) -> str:
    """เนื้อข่าวเต็มจากหน้าข่าว (ตัด HTML แล้ว) — คืน "" ถ้าหาไม่เจอ
    1. JSON-LD NewsArticle.articleBody ที่เว็บข่าวใส่ไว้ให้ search engine (เช่นไทยรัฐ ข่าวทั่วไป/บันเทิง)
    2. ข้อมูลของ Next.js ใน self.__next_f.push(...) สำหรับหน้าที่ไม่มี JSON-LD (เช่นไทยรัฐ กีฬา)"""
    return max((clean_html(t) for t in (_ld_json_article_body(page_html), _next_flight_text(page_html))), key=len)


def fetch_article_text(page_url: str, timeout: float = 10, allowed_hosts: set[str] | None = None) -> str:
    page = fetch_page(page_url, timeout, allowed_hosts=allowed_hosts)
    return extract_article_text(page) if page else ""


def _ld_json_article_body(page_html: str) -> str:
    for blob in _LD_JSON.findall(page_html):
        try:
            # raw_decode อ่านแค่ object แรก — บางเว็บมีข้อความเกินต่อท้ายจน json.loads error
            data, _ = json.JSONDecoder().raw_decode(blob.strip())
        except ValueError:
            continue
        if isinstance(data, dict):
            data = data.get("@graph", [data])
        for item in data if isinstance(data, list) else []:
            body = item.get("articleBody") if isinstance(item, dict) else None
            if isinstance(body, str) and body.strip():
                return body
    return ""


def _next_flight_text(page_html: str) -> str:
    """Next.js (app router) เก็บข้อมูลหน้าไว้ใน self.__next_f.push(...) — เนื้อข่าวอยู่ได้ 2 แบบ
    - ข้อความยาวแยกเป็นแถว "<id>:T<ความยาวเป็น byte แบบ hex>,<HTML>"
    - ข้อความที่ไม่ยาวมากอยู่ในฟิลด์ "content" ของ JSON ตรง ๆ
    เลือก HTML (มี <p>) ที่ยาวที่สุด"""
    payload = []
    for chunk in _NEXT_PUSH.findall(page_html):
        try:
            payload.append(json.loads(chunk))
        except ValueError:
            continue
    text = "".join(payload)
    data = text.encode("utf-8")
    candidates = [data[m.end(): m.end() + int(m.group(1), 16)].decode("utf-8", "ignore")
                  for m in _FLIGHT_TEXT_ROW.finditer(data)]
    for m in _FLIGHT_CONTENT.finditer(text):
        try:
            candidates.append(json.loads(m.group(1)))
        except ValueError:
            continue
    return max((c for c in candidates if "<p" in c), key=len, default="")
