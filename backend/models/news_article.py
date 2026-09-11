"""
models/news_article.py
Part 1 — OOP Model for a news article, mirrors a document in the Firestore "news_articles" collection.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


# ── Helpers ─────────────────────────────────────────────────────────────────

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def article_id(source_url: str) -> str:
    """Document id = SHA-1 of source_url, so the same article always maps to the same document (dedup key)."""
    return hashlib.sha1(source_url.encode("utf-8")).hexdigest()


# ── Model ────────────────────────────────────────────────────────────────────

@dataclass
class NewsArticle:
    """
    Represents a single news article.

    Fields
    ------
    title         : Headline of the article.
    source        : Provider name, e.g. 'thairath', 'matichon'.
    source_url    : Canonical URL — used as the deduplication key.
    category      : News category, e.g. 'politics', 'tech', 'sports'.
    full_content  : Full body text of the article (may be None if not scraped yet).
    image_url     : Thumbnail URL taken from the RSS entry (None if the feed has no image).
    publisher_url : Publisher homepage (Google News results only) — used to show the publisher logo.
    saved_by_user : True when a user saved it from the search page — never removed by the old-article purge.
    summary      : AI-generated summary stored as a list of bullet-point strings.
    published_at  : Publication timestamp from the RSS feed.
    id            : Firestore document id (defaults to article_id(source_url)).
    created_at    : Record creation timestamp (auto-set).
    """

    title:         str
    source:        str
    source_url:    str
    category:      str        = "general"
    full_content:  str | None = None
    image_url:     str | None = None
    publisher_url: str | None = None
    saved_by_user: bool       = False
    summary:       list[str]  = field(default_factory=list)
    published_at:  datetime | None = None
    id:            str        = ""
    created_at:    datetime   = field(default_factory=_now_utc)

    # ── Validation ────────────────────────────────────────────────────────────

    def __post_init__(self) -> None:
        if not self.title.strip():
            raise ValueError("title must not be empty")
        if not self.source_url.startswith(("http://", "https://")):
            raise ValueError(f"source_url is not a valid URL: {self.source_url}")
        if not self.id:
            self.id = article_id(self.source_url)

    # ── Serialisation ─────────────────────────────────────────────────────────

    def to_dict(self) -> dict[str, Any]:
        """Return a dict ready for Firestore (JSON-serialisable)."""
        return {
            "id":            self.id,
            "title":         self.title,
            "full_content":  self.full_content,
            "image_url":     self.image_url,
            "publisher_url": self.publisher_url,
            "saved_by_user": self.saved_by_user,
            "summary":      self.summary or None,   # store null when empty
            "source":        self.source,
            "source_url":    self.source_url,
            "category":      self.category,
            "published_at":  self.published_at.isoformat() if self.published_at else None,
            "created_at":    self.created_at.isoformat(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "NewsArticle":
        """Reconstruct a NewsArticle from a Firestore document dict."""
        def _parse_dt(val: str | None) -> datetime | None:
            return datetime.fromisoformat(val) if val else None

        return cls(
            id            = data.get("id", ""),
            title         = data["title"],
            source        = data["source"],
            source_url    = data["source_url"],
            category      = data.get("category", "general"),
            full_content  = data.get("full_content"),
            image_url     = data.get("image_url"),
            publisher_url = data.get("publisher_url"),
            saved_by_user = bool(data.get("saved_by_user")),
            summary      = data.get("summary") or [],
            published_at  = _parse_dt(data.get("published_at")),
            created_at    = _parse_dt(data.get("created_at")) or _now_utc(),
        )

    # ── Convenience ───────────────────────────────────────────────────────────

    @property
    def has_summary(self) -> bool:
        return bool(self.summary)

    def __repr__(self) -> str:
        return f"<NewsArticle source={self.source!r} title={self.title[:40]!r}>"
