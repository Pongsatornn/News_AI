# Log การแก้ไข — 2026-09-11

แก้ตามรายการที่ตรวจเจอในรอบก่อน (ความปลอดภัย, ค้นหาค้าง, ดึงข่าวไม่มี limit, ข่าวซ้ำ, ไฟล์เก่า, เรื่องเล็กน้อย)

## 1. ความปลอดภัย — `backend/api_server.py`

| บรรทัด/จุด | ก่อน | หลัง |
|---|---|---|
| `app.run(...)` ท้ายไฟล์ | `host="0.0.0.0", debug=True` คนในวง Wi-Fi เดียวกันเข้าหน้า debugger ของ Flask แล้วสั่งรันโค้ดได้ | ค่าเริ่มต้นเป็น `host="127.0.0.1"` และปิด debug เปิดได้เองด้วย `FLASK_DEBUG=1` / `API_HOST` ใน `.env` |
| `CORS(app)` | อนุญาตทุกเว็บ | อนุญาตเฉพาะ `http://localhost:5173` และ `http://127.0.0.1:5173` (ตั้งเพิ่มได้ใน `CORS_ORIGINS`) |
| `/api/save`, `/api/delete`, `/api/summarize` | ใครเรียกก็ได้ | เพิ่ม decorator `require_token` ต้องส่ง header `X-API-Token` ให้ตรงกับ `API_TOKEN` ใน `backend/.env` (ถ้าไม่ตรงได้ 401) |
| `/api/save` | บันทึก JSON จาก client ลง Firestore ตรง ๆ | เพิ่ม `_article_from_request()` เก็บเฉพาะฟิลด์ที่รู้จัก, ตัดความยาว, URL ต้องเป็น http/https, category ต้องอยู่ในรายการ, summary รับได้แค่ string ไม่เกิน 5 ข้อ แล้วสร้างผ่าน `NewsArticle` (หัวข่าวว่างหรือ URL ผิดได้ 400) |
| `/api/summarize` | ส่งข้อความยาวเท่าไรก็ได้ไปที่ Groq | จำกัดไว้ที่ 20,000 ตัวอักษร และเช็กชนิดข้อมูลของ `title`/`content`/`id` |

ไฟล์ที่เกี่ยวข้อง:
- `backend/.env` — เพิ่ม `API_TOKEN=` (สุ่มให้แล้ว)
- `frontend/.env` — เพิ่ม `VITE_API_TOKEN=` (ค่าเดียวกัน)
- `backend/.env.example`, `frontend/.env.example` — เพิ่มตัวอย่างตัวแปรใหม่ทั้งหมด
- `frontend/src/hooks/useNews.js` — เพิ่ม `apiPost()` แนบ token อัตโนมัติ และเปลี่ยน `API_BASE` เป็น `http://127.0.0.1:5000/api` (backend ฟังเฉพาะ IPv4 แล้ว ส่วนชื่อ `localhost` บางเครื่องจะวิ่งไป `::1` ก่อน)
- `frontend/src/App.jsx` — `summarise()` และ `handleSave()` เปลี่ยนมาเรียก `apiPost()` และถ้าบันทึกไม่สำเร็จจะแจ้ง error (เดิมเงียบ)

> หมายเหตุ: token ฝั่ง frontend อยู่ใน bundle ของเว็บ จึงเป็นแค่ด่านเสริม ส่วนที่ป้องกันหลักคือการเปิด backend เฉพาะ 127.0.0.1 และจำกัด CORS

## 2. หน้าค้นหาค้าง — `backend/services/search_service.py`, `backend/services/rss_utils.py`

- `rss_utils.py` เพิ่ม `fetch_feed(url, timeout)` โหลด RSS เองผ่าน `urllib` แบบมี timeout แล้วค่อยส่งให้ `feedparser` (เดิม `feedparser.parse(url)` ไม่มี timeout)
- `search_service.py`
  - ใช้ `fetch_feed` แทน `feedparser.parse`
  - เพิ่ม cache ของ feed สำนักข่าว 5 นาที (`FEED_CACHE_TTL`) ไม่ต้องดึงทั้ง 16 feed ใหม่ทุกครั้งที่ค้น (Google News ยังดึงสดทุกครั้ง เพราะผลเปลี่ยนตามคำค้น)
  - ตั้งเวลารอรวมไว้ 12 วินาที (`SEARCH_DEADLINE`) feed ไหนตอบไม่ทันจะข้ามไป
- `backend/controllers/news_controller.py` — ตัวดึงข่าวใช้ `fetch_feed(..., timeout=15)` ด้วย

## 3. กรองหมวดแล้วดึงทั้งหมด — `backend/services/firebase_service.py` → `list_articles()`

- เดิม: ถ้ากรอง category จะ `.get()` ทั้งหมวดโดยไม่มี limit แล้วค่อยเรียงใน Python
- ตอนนี้: ใช้ `where(category) + order_by(published_at desc) + limit(100)` ทุกกรณี
- ถ้า Firestore ยังไม่มี composite index จะเขียน warning (มีลิงก์สร้าง index) แล้วกลับไปใช้วิธีเดิมแทนการ error
- ตรวจแล้วว่าโปรเจกต์ Firebase นี้มี index นั้นอยู่แล้ว query แบบใหม่จึงใช้งานได้

## 4. ข่าวซ้ำ — `backend/models/news_article.py`, `backend/services/firebase_service.py`

- `news_article.py` เพิ่มฟังก์ชัน `article_id(source_url)` = SHA-1 ของ URL และให้ `NewsArticle.id` ใช้ค่านี้เป็นค่าเริ่มต้น (เดิมเป็น uuid สุ่ม)
- `insert_article()` เปลี่ยนจาก `.add()` เป็น `.document(article_id).create()` ถ้ามีข่าวนี้อยู่แล้ว Firestore จะปฏิเสธเอง จึงไม่ซ้ำแม้มีสองโปรเซสบันทึกข่าวเดียวกันพร้อมกัน (คืน `False` ถ้าซ้ำ ส่วน error อื่นจะโยนต่อ)
- `is_duplicate()` เช็ก document id ก่อน แล้วค่อยค้นจากฟิลด์ `source_url` สำหรับข่าวเก่าที่ยังใช้ id สุ่ม
- `news_controller.py` ครอบ `insert_article` ด้วย try/except ถ้าข่าวไหนบันทึกไม่สำเร็จจะไม่ทำให้การดึงข่าวหยุดทั้งรอบ
- เพิ่มฟิลด์ `publisher_url` ใน `NewsArticle` ข่าวจาก Google News ที่บันทึกแล้วจะยังแสดงโลโก้สำนักข่าวได้

## 5. ไฟล์เก่า / Supabase

- docstring ที่ยังพูดถึง Supabase แก้เป็น Firestore แล้ว: `news_article.py`, `groq_service.py`, `firebase_service.py`
- ย้ายไฟล์ที่ไม่ได้ใช้ไปไว้ใน `_removed/` (ระบบไม่อนุญาตให้ลบถาวร จึงย้ายแทน `_removed/` ถูกใส่ใน `.gitignore` แล้ว ถ้าไม่ต้องการก็ลบโฟลเดอร์นี้ได้เลย):
  - `frontend/src/components/` (ArticleModal, CategoryFilter, NewsCard) → `_removed/frontend-src/components/`
  - `frontend/src/lib/firebaseClient.js` → `_removed/frontend-src/lib/`
  - `frontend/App.jsx` (ไฟล์ว่าง) → `_removed/frontend/`
  - `database/schema.sql` (Supabase) → `_removed/database/`

## 6. เรื่องเล็กน้อย

- **git**: รัน `git init` แล้ว (ยังไม่ได้ commit) เช็กแล้วว่า `.env`, `serviceAccountKey.json`, `.venv*`, `node_modules`, `_removed/` ไม่ถูก track
- **ปุ่ม Esc**: `frontend/src/App.jsx` → `ArticleModal` เพิ่ม `useEffect` ฟังปุ่ม Escape เพื่อปิดหน้าต่างข่าว
- **รัน news_controller เป็นไฟล์ตรง ๆ**: `news_controller.py` ถ้ารันแบบ `python controllers/news_controller.py` จะเพิ่มโฟลเดอร์ `backend` เข้า `sys.path` ให้อัตโนมัติ (แบบ `python -m controllers.news_controller` ก็ยังใช้ได้)

## ผลทดสอบ

- Frontend: `npm run lint` ผ่าน, `npm run build` ผ่าน
- Backend (ทดสอบด้วย `.venv`):
  - เรียก save/delete/summarize โดยไม่มี token ได้ 401 ส่งข้อมูลผิดหรือไม่ใช่ JSON ได้ 400
  - CORS: `localhost:5173` ผ่าน preflight ส่วน origin อื่นไม่ได้ header อนุญาต
  - whitelist ตัดฟิลด์แปลก ๆ ทิ้ง และ `javascript:` URL ไม่ผ่าน
  - `list_articles()` ได้ 100 ข่าว, หมวด sports ได้ 60 ข่าว เรียงใหม่→เก่าถูกต้อง
  - `is_duplicate` เจอข่าวเก่า (id สุ่ม) และข่าวใหม่คืน False
  - ค้นหา "ไทย": ครั้งแรก 10.3 วินาที, ครั้งที่สองมี cache เหลือ 0.44 วินาที
  - import `news_controller.py` จากในโฟลเดอร์ `controllers` ได้
- ยังไม่ได้ทดสอบ: การบันทึกข่าวจริงลง Firestore ผ่าน `/api/save` (ไม่อยากเพิ่มข้อมูลทดสอบลงฐานจริง) และยังไม่ได้รันตัวดึงข่าวเต็มรอบ

## รอบที่ 2 — เก็บงานที่ค้าง (ได้รับอนุญาตแล้ว)

1. **ลบ venv ที่ไม่ใช้** `.venv-1`, `.venv-2` แล้ว (ทั้งสองชุดไม่มี Flask) เหลือแค่ `.venv`
2. **ถอด package ที่ไม่ใช้** `@supabase/supabase-js` และ `firebase` ด้วย `npm uninstall` แล้ว (`package.json` และ `package-lock.json` อัปเดตแล้ว) frontend เหลือ dependency แค่ `react` กับ `react-dom`
3. **ลบไฟล์ template ของ Vite ที่ไม่ได้ใช้** `frontend/src/App.css` และ `frontend/src/assets/` (hero.png, react.svg, vite.svg) แล้ว

ผลทดสอบหลังลบ: `npm run lint` และ `npm run build` ผ่าน

เหลืออยู่:
- โฟลเดอร์ `_removed/` (ไฟล์ที่ย้ายออกมาในรอบแรก) ยังเก็บไว้ git ไม่ track ถ้าไม่ต้องการก็ลบได้
- `npm audit` เจอช่องโหว่ 8 จุด (high 6 จุด) อยู่ใน `vite`, `postcss`, `nanoid` ซึ่งเป็นเครื่องมือตอนพัฒนา ไม่ได้อยู่ในเว็บที่ build ออกมา แก้ได้ด้วย `npm audit fix` (ยังไม่ได้รัน)

## สิ่งที่ต้องทำหลังจากนี้

- **รีสตาร์ท** `python api_server.py` และ `npm run dev` เพื่อให้โหลด `API_TOKEN` / `VITE_API_TOKEN` ใหม่
- ถ้าต้องการ debugger ตอนพัฒนา ให้ใส่ `FLASK_DEBUG=1` ใน `backend/.env`

## รอบที่ 3 — แก้ตาม review มุมผู้ใช้

### 1. ข่าวกระจุกอยู่สำนักเดียว — `backend/controllers/news_controller.py`
- เดิม: วนดึงทีละ feed และจำกัด 20 ข่าวต่อหมวด feed แรกของหมวดจึงใช้โควตาหมดทุกรอบ (ในฐานข้อมูล หมวดการเมืองมาจาก matichon_pol 60/60 ข่าว, ธุรกิจมาจาก matichon_econ 60/60 ส่วน khaosod_pol, prachachat_pol, khaosod, khaosod_econ และ matichon_ent ไม่ได้ข่าวเลย ทั้งที่ feed ใช้งานได้ปกติ)
- ตอนนี้: ดึงทุก feed ในหมวดมาก่อน แล้วให้แต่ละสำนักผลัดกันส่งข่าวใหม่ทีละข่าว (ยังจำกัด 20 ข่าวต่อหมวดต่อรอบเหมือนเดิม)
- จำ URL ที่รู้แล้วว่ามีอยู่ใน Firestore ไว้ในหน่วยความจำ รอบถัดไปจะได้ไม่ต้องอ่านซ้ำ (ประหยัดโควตา Firestore)

### 2. ดึงข่าวอัตโนมัติ
- `news_controller.start_auto_fetch()` ดึงข่าวใน background thread ทันทีที่เปิด `python api_server.py` แล้วดึงซ้ำทุก `FETCH_INTERVAL_MINUTES` นาที (ค่าเริ่มต้น 30 ถ้าใส่ 0 จะปิด ดูตัวอย่างใน `backend/.env.example`) ถ้าเปิด `FLASK_DEBUG=1` ตัวดึงข่าวจะทำงานแค่โปรเซสเดียว
- เพิ่ม `GET /api/status` คืนสถานะการดึงรอบล่าสุด endpoint นี้ไม่อ่าน Firestore
- frontend เช็ก `/api/status` ทุก 1 นาที ถ้าดึงรอบใหม่เสร็จและได้ข่าวใหม่จะโหลดหน้าหลักใหม่เอง มีข้อความ "ดึงข่าวใหม่ล่าสุด … ที่ผ่านมา" และปุ่ม 🔄 รีเฟรช (ตอนรีเฟรชจะแสดงข่าวเดิมค้างไว้ หน้าไม่กระพริบ)
- `python controllers/news_controller.py` ยังรันเองแบบรอบเดียวได้เหมือนเดิม

### 3. การสรุปข่าว
- **ตัด HTML**: เพิ่ม `rss_utils.clean_html()` ใช้ตอนดึงข่าว, ค้นหา, บันทึกจากหน้าค้นหา และก่อนส่งให้ AI (ข่าวเก่าใน Firestore ยังมี HTML อยู่ ไม่ได้แก้ข้อมูลเดิม แต่จะถูกตัดออกตอนสรุป)
- **ซ่อนปุ่มสรุปของข่าวที่ไม่มีเนื้อหา**: `/api/news` และ `/api/search` เพิ่มฟิลด์ `can_summarize` (ต้องมีเนื้อหาข่าวอย่างน้อย 100 ตัวอักษรหลังตัด HTML) ข่าวจาก Google News ไม่ส่ง `full_content` แล้ว เพราะใน RSS มีแค่ลิงก์หัวข่าว
- **ปุ่มสรุปในหน้าต่างข่าว**: กด "✦ สรุปด้วย AI" บนการ์ดแล้วหน้าต่างข่าวจะเปิดทันทีและแสดง "AI กำลังสรุปข่าว…" ในหน้าต่างก็มีปุ่มสรุปด้วย ถ้าข่าวไม่มีเนื้อหาจะบอกให้ไปอ่านจากต้นฉบับ ปุ่มบนการ์ดเปลี่ยนเป็น "ดูข่าว" / "✦ อ่านสรุป"
- **error ภาษาไทย**: `groq_service.py` เพิ่ม `InsufficientContentError` แล้ว `/api/summarize` แปลงเป็นข้อความไทย (เนื้อหาไม่พอ 422, โควตาเต็ม 429, AI error 502) error อื่นของ API ก็เป็นภาษาไทย ไม่ส่งรายละเอียด exception ให้ client แล้ว (เขียนลง log ของ backend แทน) ฝั่ง frontend ใช้ `apiGet`/`apiPost` ที่แปลง error ทุกแบบเป็นข้อความไทย
- เปลี่ยน `alert()` เป็น toast ด้านล่างจอที่หายเองใน 3.5 วินาที

### 4. แท็บค้นหา
- สลับแท็บแล้วผลค้นหาและสรุปที่ทำไว้ยังอยู่ (ซ่อนแท็บแทนการถอดออก)
- บันทึกข่าวจากหน้าค้นหาแล้ว หน้าหลักจะโหลดใหม่ให้เอง

### 5. หน้าตา
- `frontend/index.html` ชื่อแท็บเป็น "NewsAI — สรุปข่าวไทยด้วย AI", `lang="th"`, favicon เปลี่ยนเป็น 📰 (เดิมเป็นโลโก้ Vite)
- `frontend/src/index.css` ใช้ font ที่รองรับภาษาไทย ใส่ class `.page` / `.header-inner` / `.news-grid` ให้จอ ≤ 480px ใช้ padding 16px และการ์ดหดตามจอ (เดิมจอ 320px ล้นด้านข้าง)

### ผลทดสอบ
- Frontend: `npm run lint` และ `npm run build` ผ่าน
- Backend แบบ mock (ไม่แตะ Firestore/Groq จริง): ดึงข่าวได้ 20 ข่าวต่อหมวด ทุกสำนักได้ 6–10 ข่าว, ไม่บันทึกซ้ำ, เนื้อหาที่บันทึกไม่มี HTML, error ของ summarize ได้ status และข้อความไทยตรงตามที่ตั้งไว้
- Backend จริง (ปิดการดึงอัตโนมัติ): `/api/status` ใช้ได้, หน้าหลัก 93/100 ข่าวสรุปได้, ข่าว Google News ในผลค้นหาทั้ง 3 ข่าวไม่มีปุ่มสรุป, ผลค้นหาไม่มี HTML เหลือ, สรุปข่าวเก่าที่มี HTML ได้ใน 1.6 วินาที
- ยังไม่ได้ทดสอบ: การดึงข่าวอัตโนมัติกับ Firestore จริง (จะเริ่มรอบแรกเมื่อเปิด `python api_server.py`) และยังไม่ได้เปิดหน้าเว็บในเบราว์เซอร์จริง

### หมายเหตุ
- ข่าวไทยรัฐบางข่าว (ส่วนใหญ่หมวดกีฬา) RSS ให้เนื้อหาแค่ราว 80 ตัวอักษร จึงไม่มีปุ่มสรุป (7 จาก 100 ข่าวในหน้าหลัก)
- ดึงข่าวรอบแรกหลังเปิด server จะอ่าน Firestore ไม่เกินราว 1,300 ครั้ง (ข่าวละ 1–2 ครั้ง) รอบถัดไปจะอ่านเฉพาะข่าวที่ยังไม่รู้จัก (โควตาฟรี 50,000 ครั้ง/วัน)
- ข่าวเดิมในฐานข้อมูลที่กระจุกอยู่สำนักเดียวจะค่อย ๆ สมดุลขึ้นเมื่อมีข่าวใหม่เข้ามา
