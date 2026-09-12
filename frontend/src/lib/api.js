// เรียก backend — error ทุกแบบกลายเป็นข้อความภาษาไทยที่แสดงให้ผู้ใช้ได้เลย

// ค่าเริ่มต้นใช้ 127.0.0.1 ตรง ๆ — backend เปิดเฉพาะ IPv4 loopback ส่วน "localhost" บางเครื่องจะวิ่งไป ::1 ก่อน
// ตั้ง VITE_API_BASE ใน frontend/.env ได้ถ้า backend อยู่เครื่องอื่นหรือคนละพอร์ต
export const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:5000/api";
const API_TOKEN = import.meta.env.VITE_API_TOKEN;

// endpoint ที่แก้ข้อมูลหรือใช้โควตา AI ต้องแนบ token ให้ตรงกับ API_TOKEN ใน backend/.env
const authHeaders = () => (API_TOKEN ? { "X-API-Token": API_TOKEN } : {});

async function request(path, options) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, options);
  } catch {
    throw new Error("เชื่อมต่อ backend ไม่ได้ — รัน python api_server.py หรือยัง?");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `เซิร์ฟเวอร์ตอบกลับผิดพลาด (HTTP ${res.status})`);
  return data;
}

export function apiGet(path) {
  return request(path);
}

export function apiPost(path, body) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
}

export function apiDelete(path) {
  return request(path, { method: "DELETE", headers: authHeaders() });
}
