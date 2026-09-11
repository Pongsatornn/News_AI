# NewsAI — สรุปข่าวไทยด้วย AI

เว็บรวมข่าวไทยจาก RSS ของหลายสำนักข่าว (มติชน, ไทยรัฐ, ข่าวสด, ประชาชาติ, Blognone, แบไต๋) แยกตามหมวด พร้อมสรุปข่าวเป็นข้อ ๆ ด้วย AI (Groq)

- **หน้าหลัก:** ข่าวล่าสุดจาก Firestore กรองตามหมวดได้ ข่าวใหม่ถูกดึงเข้ามาเองทุก 30 นาที
- **ค้นหา:** ค้นข่าวสดจาก RSS ของเรา + Google News แล้วกดบันทึกข่าวที่สนใจลงหน้าหลักได้
- **สรุปด้วย AI:** สรุปเป็น 3–5 ข้อ ข่าวในหน้าหลักจะเก็บสรุปไว้ใน Firestore ไม่ต้องสรุปซ้ำ
- **สรุปรอไว้ล่วงหน้า:** ตัวดึงข่าวให้ AI สรุปข่าวใหม่รอไว้รอบละ 5 ข่าว (ข่าวใหม่ก่อน สลับหมวด) กดแล้วอ่านได้ทันที
- **สรุปข่าวเด่นวันนี้:** AI สรุปประเด็นสำคัญของแต่ละหมวดจากข่าว 24 ชั่วโมงล่าสุด พร้อมลิงก์ไปข่าวต้นทาง สร้างใหม่เองทุก 3 ชั่วโมง
- **ฟังสรุป:** อ่านออกเสียงสรุปข่าวและสรุปข่าวเด่นด้วยเสียงภาษาไทยของเบราว์เซอร์ (Microsoft Edge มีเสียงไทยในตัว ส่วน Chrome ต้องมีเสียงไทยติดตั้งใน Windows)
- **ติดตามหัวข้อ 🔔:** เพิ่มคำที่สนใจ (สูงสุด 10 หัวข้อ เก็บในเบราว์เซอร์) ระบบหาข่าวใหม่จากทุกสำนักทุก 5 นาที และขึ้นจำนวนข่าวใหม่บนแท็บ
- **ถาม AI เกี่ยวกับข่าว 💬:** ถามคำถามในหน้าต่างข่าวได้ AI ตอบจากเนื้อหาข่าวนั้นเท่านั้น และถามต่อเนื่องได้

## โครงสร้าง

```
news-aggregator/
├── backend/                      Flask API (Python)
│   ├── api_server.py             REST API + ดึงข่าวอัตโนมัติ
│   ├── controllers/
│   │   └── news_controller.py    รายการ RSS และตัวดึงข่าวลง Firestore
│   ├── models/news_article.py    โครงสร้างข้อมูลข่าว
│   ├── services/
│   │   ├── firebase_service.py   อ่าน/เขียน Firestore
│   │   ├── groq_service.py       สรุปข่าวด้วย Groq
│   │   ├── rss_utils.py          โหลด RSS, หารูป, ตัด HTML
│   │   └── search_service.py     ค้นหาข่าว
│   ├── tests/                    unit test (ไม่แตะ Firestore/Groq จริง)
│   └── requirements.txt
├── frontend/                     React + Vite + Tailwind CSS v4
│   └── src/
│       ├── App.jsx               หน้าเว็บทั้งหมด (style เป็น class ของ Tailwind)
│       ├── index.css             ตั้งค่า Tailwind + สีของเว็บ (@theme)
│       └── hooks/useNews.js      เรียก API
└── log.md                        บันทึกการแก้ไขแต่ละรอบ
```

## สิ่งที่ต้องมี

- Python 3.10 ขึ้นไป (ทดสอบกับ 3.13)
- Node.js (ทดสอบกับ v22)
- โปรเจกต์ Firebase ที่เปิดใช้ Firestore
- Groq API key — สมัครฟรีที่ [console.groq.com](https://console.groq.com)

## ติดตั้ง

### 1. Backend

```bash
python -m venv .venv
.venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install -r backend/requirements.txt
copy backend\.env.example backend\.env   # macOS/Linux: cp backend/.env.example backend/.env
```

แก้ `backend/.env`:

- `GROQ_API_KEY` — key จาก Groq
- `API_TOKEN` — สุ่มขึ้นมาเองด้วย `python -c "import secrets; print(secrets.token_urlsafe(32))"`

แล้วดาวน์โหลด service account key ของ Firebase: Firebase console → Project settings → Service accounts → **Generate new private key** แล้วบันทึกเป็น `backend/serviceAccountKey.json`

> `.env` และ `serviceAccountKey.json` ถูกใส่ใน `.gitignore` แล้ว อย่า commit สองไฟล์นี้

**Firestore index:** การกรองหมวดต้องมี composite index ของ collection `news_articles` คือ `category` (Ascending) + `published_at` (Descending) ถ้ายังไม่มี backend จะเขียน warning พร้อมลิงก์สำหรับสร้าง index แล้วใช้วิธีสำรองที่ช้ากว่าไปก่อน

### 2. Frontend

```bash
cd frontend
npm install
copy .env.example .env            # macOS/Linux: cp .env.example .env
```

ใส่ `VITE_API_TOKEN` ใน `frontend/.env` ให้เป็นค่าเดียวกับ `API_TOKEN` ใน `backend/.env`

## รัน

เปิด terminal สองหน้าต่าง:

```bash
# หน้าต่างที่ 1 — backend (http://127.0.0.1:5000)
cd backend
..\.venv\Scripts\python api_server.py     # macOS/Linux: ../.venv/bin/python api_server.py

# หน้าต่างที่ 2 — frontend (http://localhost:5173)
cd frontend
npm run dev
```

แล้วเปิด http://localhost:5173

- เปิด `api_server.py` แล้วจะดึงข่าวทันที และดึงซ้ำทุก `FETCH_INTERVAL_MINUTES` นาที
- ถ้าจะดึงข่าวแค่รอบเดียวโดยไม่เปิด API: `python controllers/news_controller.py` (รันในโฟลเดอร์ `backend`)

## ตั้งค่า (`.env`)

| ตัวแปร | ไฟล์ | ค่าเริ่มต้น | ใช้ทำอะไร |
|---|---|---|---|
| `GROQ_API_KEY` | backend | — | key สำหรับสรุปข่าวด้วย AI (จำเป็น) |
| `API_TOKEN` | backend | — | token ของ endpoint สรุป/บันทึก/ลบ (ถ้าไม่ตั้งจะไม่เช็ก) |
| `FETCH_INTERVAL_MINUTES` | backend | `30` | ดึงข่าวอัตโนมัติทุกกี่นาที (`0` = ปิด) |
| `AUTO_SUMMARY_PER_RUN` | backend | `5` | จำนวนข่าวใหม่ที่ให้ AI สรุปรอไว้ต่อรอบ (`0` = ปิด) |
| `BRIEFING_INTERVAL_HOURS` | backend | `3` | สร้างสรุปข่าวเด่นใหม่ทุกกี่ชั่วโมง (`0` = ไม่สร้างเอง) |
| `API_HOST` | backend | `127.0.0.1` | IP ที่ backend เปิดรับ |
| `CORS_ORIGINS` | backend | `http://localhost:5173,http://127.0.0.1:5173` | เว็บที่อนุญาตให้เรียก API |
| `FLASK_DEBUG` | backend | ปิด | `1` = เปิด debugger (ห้ามใช้คู่กับ `API_HOST=0.0.0.0`) |
| `VITE_API_TOKEN` | frontend | — | ต้องตรงกับ `API_TOKEN` |

## API

| Method | Path | ใช้ทำอะไร | ต้องใช้ token |
|---|---|---|---|
| GET | `/api/news?category=sports` | ข่าวล่าสุด 100 ข่าวจาก Firestore (ไม่ใส่ category = ทุกหมวด) | |
| GET | `/api/search?q=คำค้น` | ค้นข่าวจาก RSS + Google News ได้สูงสุด 60 ข่าว เรียงจากใหม่ไปเก่า | |
| GET | `/api/status` | สถานะการดึงข่าวอัตโนมัติรอบล่าสุด | |
| GET | `/api/briefing` | สรุปข่าวเด่นฉบับล่าสุด | |
| POST | `/api/briefing` | สร้างสรุปข่าวเด่นใหม่ทันที (ใช้เวลา 10–30 วินาที) | ✓ |
| GET | `/api/topics?q=หัวข้อ&q=...` | ข่าวล่าสุดของหัวข้อที่ติดตาม (สูงสุด 10 หัวข้อ ค้นจาก feed ของเราใน cache ไม่อ่าน Firestore และไม่เรียก Google) | |
| POST | `/api/ask` | ถามคำถามเกี่ยวกับข่าว — body `{title, content, source_url?, question, history?}` | ✓ |
| POST | `/api/summarize` | สรุปข่าวด้วย AI — body `{title, content, source_url?, id?}` ถ้าเนื้อหาสั้นและเป็นข่าวจากสำนักใน RSS จะเปิดหน้าข่าวดึงเนื้อหาเต็มมาสรุป ถ้าส่ง `id` จะบันทึกสรุปลง Firestore | ✓ |
| POST | `/api/save` | บันทึกข่าวจากหน้าค้นหาลง Firestore | ✓ |
| DELETE | `/api/delete/<id>` | ลบข่าว | ✓ |

token ส่งทาง header `X-API-Token`

## ทดสอบ

```bash
# backend — ใช้ RSS/Firestore/Groq จำลองทั้งหมด ไม่เรียกเครือข่ายและไม่เขียนฐานข้อมูลจริง
cd backend
..\.venv\Scripts\python -m unittest discover -s tests -v

# frontend
cd frontend
npm run lint
npm run build
```

## หมายเหตุ

- **ออกแบบให้ใช้ในเครื่องตัวเอง:** token ฝั่ง frontend อยู่ในโค้ดเว็บที่ build ออกมา ถ้าจะเปิดให้คนอื่นใช้ผ่านอินเทอร์เน็ตต้องมีระบบ login จริง และเปลี่ยนไปใช้ production server แทน Flask dev server
- **โควตา:** Firestore แบบฟรีอ่านได้ 50,000 ครั้งต่อวัน ตัวดึงข่าวจำ URL ที่รู้แล้วไว้ จึงอ่านเยอะเฉพาะรอบแรกหลังเปิด server (ไม่เกินราว 1,300 ครั้ง) ส่วน Groq (โมเดล `qwen/qwen3.8-27b` แบบฟรี) จำกัด 1,000 ครั้งต่อวัน และ 8,000 token ต่อนาที (ข่าวไทย 1 ข่าวใช้ราว 600–1,500 token) การสรุปรอไว้กับสรุปข่าวเด่นใช้รวมราว 250 ครั้งต่อวันตามค่าเริ่มต้น ที่เหลือไว้ให้ผู้ใช้กดสรุปเอง ถ้าโควตาเต็มจะขึ้นข้อความให้รอสักครู่
- ประวัติการแก้ไขแต่ละรอบอยู่ใน [log.md](log.md)
