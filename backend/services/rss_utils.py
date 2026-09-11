"""
services/rss_utils.py
Helper สำหรับอ่านข้อมูลจาก RSS entry (ใช้ร่วมกันระหว่าง news_controller และ search_service)
"""

from __future__ import annotations
import html
import re
import urllib.parse
import urllib.request

import feedparser

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


def fetch_og_image(page_url: str, timeout: float = 10) -> str | None:
    """สำรองเมื่อ RSS ไม่มีรูป: เปิดหน้าข่าวแล้วอ่าน <meta property="og:image">"""
    # og:image ของ Google News เป็นแค่โลโก้ Google ไม่ใช่รูปข่าว
    if urllib.parse.urlparse(page_url).netloc.endswith("news.google.com"):
        return None
    try:
        req = urllib.request.Request(page_url, headers=_BROWSER_HEADERS)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            html = resp.read(300_000).decode("utf-8", "ignore")
    except Exception:
        return None
    m = _OG_IMAGE.search(html)
    return (m.group(1) or m.group(2)) if m else None
