"""
services/groq_service.py
AI Service: summarises Thai news using Groq API.

Returns structured JSON output — a list of bullet-point strings —
ready to be stored in the `summary` field of a Firestore news document.
"""

from __future__ import annotations

import json
import logging
import os

from groq import Groq

logger = logging.getLogger(__name__)


class InsufficientContentError(ValueError):
    """Raised when an article has too little content to summarise."""


# ── System Instruction ────────────────────────────────────────────────────────

_SYSTEM_INSTRUCTION = """
คุณคือผู้ช่วยสรุปข่าวภาษาไทยที่เชี่ยวชาญ มีหน้าที่สรุปเนื้อหาข่าวให้กระชับ ถูกต้อง และเข้าใจง่ายสำหรับผู้อ่านทั่วไป

กฎที่ต้องปฏิบัติตามอย่างเคร่งครัด:
1. สรุปเป็นภาษาไทยเท่านั้น
2. แบ่งเป็น 3-5 ประเด็นสำคัญ (bullet points)
3. แต่ละประเด็นยาวไม่เกิน 2 ประโยค
4. ใช้ภาษาที่เป็นกลาง ไม่เพิ่มความคิดเห็นส่วนตัว
5. ตอบกลับด้วย JSON เท่านั้น โดยไม่มี markdown, backtick, หรือข้อความอื่นๆ

รูปแบบ JSON ที่ต้องตอบกลับ:
{
  "summary": [
    "ประเด็นที่ 1...",
    "ประเด็นที่ 2...",
    "ประเด็นที่ 3..."
  ]
}

หากเนื้อหาข่าวสั้นเกินไปหรือไม่เพียงพอสำหรับการสรุป ให้ตอบกลับด้วย:
{"error": "insufficient_content"}
"""

# ── Service ───────────────────────────────────────────────────────────────────

class GroqService:
    """
    Wraps the Groq API for Thai news summarisation.

    Environment variables required
    ------------------------------
    GROQ_API_KEY : Your Groq API key (starts with gsk_...).
    """

    MODEL_NAME         = "qwen/qwen3.8-27b"   # llama-3.3-70b-versatile ถูกถอดออกจาก Groq แล้ว
    MAX_TOKENS         = 1024
    TEMPERATURE        = 0.3       # Low temperature → consistent, factual summaries
    MIN_CONTENT_LENGTH = 100       # Characters — skip content that's too short

    def __init__(self) -> None:
        api_key = os.environ.get("GROQ_API_KEY")
        if not api_key:
            raise EnvironmentError("GROQ_API_KEY environment variable is not set.")

        self._client = Groq(api_key=api_key)

    # ── Public API ────────────────────────────────────────────────────────────

    def summarise(self, content: str) -> list[str]:
        """
        Summarise news content into Thai bullet points.

        Parameters
        ----------
        content : Full article text (or title as fallback).

        Returns
        -------
        List of Thai bullet-point strings.
        Raises ValueError if content is insufficient or API returns an error.
        """
        content = content.strip()

        if len(content) < self.MIN_CONTENT_LENGTH:
            raise InsufficientContentError(f"Content too short to summarise ({len(content)} chars).")

        user_prompt = f"กรุณาสรุปข่าวต่อไปนี้:\n\n{content}"

        logger.debug("Calling Groq API (content length=%d chars)", len(content))

        response = self._client.chat.completions.create(
            model       = self.MODEL_NAME,
            temperature = self.TEMPERATURE,
            max_tokens  = self.MAX_TOKENS,
            messages    = [
                {"role": "system", "content": _SYSTEM_INSTRUCTION},
                {"role": "user",   "content": user_prompt},
            ],
        )

        raw = response.choices[0].message.content
        return self._parse_response(raw)

    # ── Internal ──────────────────────────────────────────────────────────────

    def _parse_response(self, raw: str) -> list[str]:
        """Parse the JSON response from Groq and return bullet points."""
        raw = raw.strip()

        # Strip accidental markdown fences (defensive)
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1]
            raw = raw.rsplit("```", 1)[0].strip()

        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            logger.error("Groq returned non-JSON: %s", raw[:200])
            raise ValueError(f"Could not parse Groq response as JSON: {exc}") from exc

        if not isinstance(data, dict):
            raise ValueError("Groq response is not a JSON object.")
        if "error" in data:
            raise InsufficientContentError(f"Groq reported error: {data['error']}")

        bullets = [b for b in data.get("summary") or [] if isinstance(b, str) and b.strip()]
        if not bullets:
            raise ValueError("Groq returned an empty summary list.")

        # Clamp to 3–5 bullets
        return bullets[:5]