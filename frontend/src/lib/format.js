// ฟังก์ชันแปลงข้อมูลให้อ่านง่าย — ไม่มี state ไม่แตะ DOM จึงเทสต์ง่ายและใช้ซ้ำได้ทุกหน้า

// source ใน DB เป็น key เช่น "thairath_sport" → แสดงชื่อสำนักข่าวภาษาไทย
const SOURCE_NAMES = {
  matichon: "มติชน", thairath: "ไทยรัฐ", khaosod: "ข่าวสด", prachachat: "ประชาชาติ",
  sanook: "Sanook", blognone: "Blognone", beartai: "แบไต๋", google_news: "Google News",
};

export function sourceName(source) {
  return SOURCE_NAMES[source] || SOURCE_NAMES[source?.split("_")[0]] || source;
}

// ข่าวจาก Google News ไม่มีรูป → ใช้โลโก้ของสำนักข่าวแทน
export function logoUrl(publisherUrl) {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(publisherUrl).hostname}&sz=128`;
  } catch {
    return null;
  }
}

// ตัวอย่างเนื้อข่าว — ข่าวเก่าใน Firestore ยังมี HTML ปน จึงตัดแท็กออกก่อน
export function excerptOf(text, max = 280) {
  const plain = (text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max).trimEnd()}…` : plain;
}

const rtf = new Intl.RelativeTimeFormat("th", { numeric: "auto" });

export function timeAgo(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return "";
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1)        return "เมื่อสักครู่";
  if (mins < 60)       return rtf.format(-mins, "minute");
  if (mins < 1440)     return rtf.format(-Math.round(mins / 60), "hour");
  if (mins < 1440 * 7) return rtf.format(-Math.round(mins / 1440), "day");
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
}

export function formatThaiDate(date) {
  const d = new Date(`${date}T12:00:00+07:00`);
  return isNaN(d) ? "" : d.toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// ข่าวในหน้าหลักมี document id ส่วนผลค้นหายังไม่ได้บันทึกจึงใช้ URL แทน
export const articleKey = a => a.id || a.source_url;
export const hasSummary = a => Array.isArray(a.summary) && a.summary.length > 0;
export const isAfter = (iso, since) => Boolean(iso) && new Date(iso) > new Date(since ?? 0);
export const cleanTopic = raw => raw.trim().replace(/\s+/g, " ").slice(0, 50);
