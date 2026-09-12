import { useState, useEffect, useCallback, useRef } from "react";

// อ่านออกเสียงด้วยเสียงภาษาไทยที่มีในเครื่อง (Web Speech API ของเบราว์เซอร์) — ไม่ใช้ backend และไม่ใช้โควตา AI
export function useSpeech() {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [speakingKey, setSpeakingKey] = useState(null);
  // Chrome คืนรายชื่อเสียงเป็นลิสต์ว่างในครั้งแรก แล้วค่อยยิง event voiceschanged ตามมา
  // ถ้าไม่รอ จะกลายเป็นอ่านภาษาไทยด้วยเสียงอังกฤษโดยไม่เตือนผู้ใช้
  const voices = useRef([]);

  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    const load = () => { voices.current = synth.getVoices(); };
    load();
    synth.addEventListener("voiceschanged", load);
    return () => { synth.removeEventListener("voiceschanged", load); synth.cancel(); };
  }, [supported]);

  const stop = useCallback(() => {
    if (supported) window.speechSynthesis.cancel();
    setSpeakingKey(null);
  }, [supported]);

  // คืน true ถ้าเครื่องนี้มีรายชื่อเสียงแล้วแต่ไม่มีเสียงภาษาไทย จะได้บอกผู้ใช้
  function speak(key, parts) {
    const synth = window.speechSynthesis;
    synth.cancel();
    const available = voices.current.length ? voices.current : synth.getVoices();
    const thai = available.find(v => v.lang?.toLowerCase().replace("_", "-").startsWith("th"));
    const done = () => setSpeakingKey(k => (k === key ? null : k));
    // อ่านทีละข้อ — Chrome ตัดเสียงเองถ้าข้อความเดียวยาวเกินราว 15 วินาที
    parts.filter(Boolean).forEach((text, i, all) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "th-TH";
      if (thai) utterance.voice = thai;
      if (i === all.length - 1) utterance.onend = done;
      utterance.onerror = done;
      synth.speak(utterance);
    });
    setSpeakingKey(key);
    return available.length > 0 && !thai;
  }

  return { supported, speakingKey, speak, stop };
}
