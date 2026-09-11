# NewsAI — frontend

หน้าเว็บ React + Vite + Tailwind CSS v4 ของ NewsAI วิธีติดตั้งและรันทั้งระบบอยู่ใน [README.md ของโฟลเดอร์หลัก](../README.md)

## การเขียน style

- ใช้ class ของ Tailwind ใน `className` ไม่ใช้ inline `style={{...}}`
- สีของเว็บตั้งไว้ใน `@theme` ของ [src/index.css](src/index.css) ใช้ชื่อตามหน้าที่ ถ้าจะเปลี่ยนสีทั้งเว็บให้แก้ที่นี่ที่เดียว:
  - `ink`: หมึกปากกาน้ำเงิน ใช้กับพาดหัวและปุ่มหลัก
  - `marker`: ปากกาเน้นข้อความสีเหลือง **ใช้เฉพาะกับสิ่งที่ AI ทำ** เช่นปุ่มสรุป/ถาม และข้อความที่ AI สรุป
  - `graphite` / `muted` / `faint`: สีข้อความ จากเข้มไปอ่อน
  - `line`: เส้นขอบ
  - `pen`: ลิงก์และกรอบ focus
  - `red` / `red-deep`: ป้าย "ใหม่" และ error
- ฟอนต์: `font-sans` (Bai Jamjuree) เป็นค่าเริ่มต้นสำหรับพาดหัวและเมนู ส่วนข้อความที่อ่านยาวใส่ `font-read` (IBM Plex Sans Thai Looped) โหลดจาก Google Fonts ใน [index.html](index.html)
- `highlight` คือแถบปากกาเน้นข้อความใต้ตัวอักษร (ประกาศด้วย `@utility` ใน index.css) ใช้คู่กับ `motion-safe:animate-marker` ถ้าต้องการให้ปาดเข้ามา
- class ชุดที่ใช้ซ้ำหลายที่ (เช่น `NEWS_GRID`, `INPUT`, `AI_BTN`, `INK_BTN`) เก็บเป็นค่าคงที่ไว้ด้านบนของ [src/App.jsx](src/App.jsx)
- แนะนำให้ติดตั้ง extension "Tailwind CSS IntelliSense" ใน VS Code จะได้ autocomplete ของ class และหายเตือน `Unknown at rule @theme`

| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `npm run dev` | เปิด dev server ที่ http://localhost:5173 |
| `npm run lint` | ตรวจโค้ดด้วย ESLint |
| `npm run build` | build ไฟล์เว็บลง `dist/` |
| `npm run preview` | เปิดดูเว็บที่ build แล้ว |

ต้องมี `frontend/.env` ที่ใส่ `VITE_API_TOKEN` ให้ตรงกับ `API_TOKEN` ใน `backend/.env`
