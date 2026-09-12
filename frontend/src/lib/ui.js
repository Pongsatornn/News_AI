// หมวด/แท็บ และ class ของ Tailwind ที่ใช้ซ้ำ — สีตั้งไว้ใน index.css (ink = หมึกปากกาน้ำเงิน, marker = ปากกาเน้นข้อความ)

export const CATEGORIES = [
  { key: null,            label: "ทั้งหมด" },
  { key: "general",       label: "ทั่วไป" },
  { key: "politics",      label: "การเมือง" },
  { key: "sports",        label: "กีฬา" },
  { key: "technology",    label: "เทคโนโลยี" },
  { key: "entertainment", label: "บันเทิง" },
  { key: "business",      label: "ธุรกิจ" },
];
export const CATEGORY_BY_KEY = Object.fromEntries(CATEGORIES.filter(c => c.key).map(c => [c.key, c]));

export const TABS = [
  { key: "home",     label: "หน้าหลัก" },
  { key: "briefing", label: "สรุปวันนี้" },
  { key: "topics",   label: "ติดตาม" },
  { key: "search",   label: "ค้นหา" },
];

export const CONTAINER   = "mx-auto w-full max-w-7xl px-4 sm:px-6";
export const MAIN        = `${CONTAINER} py-6 sm:py-8`;
export const H1          = "text-2xl font-bold tracking-tight text-ink sm:text-3xl";
export const NEWS_GRID   = "grid gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4";
export const INPUT       = "min-w-0 flex-1 rounded-lg border border-line-strong bg-white px-3.5 py-2.5 text-[15px] text-graphite placeholder:text-faint outline-none transition-colors focus:border-pen focus:ring-3 focus:ring-pen/15";
export const ERROR_BOX   = "mb-4 rounded-lg border border-red/20 bg-red-soft px-4 py-3 text-sm text-red-deep";
export const COUNT_BADGE = "rounded-full bg-red px-1.5 text-[11px] font-bold leading-4 text-white";
const BTN                = "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition-colors disabled:cursor-default";
export const BTN_SM      = `${BTN} px-3 py-1.5 text-[13px]`;
export const BTN_MD      = `${BTN} px-4 py-2.5 text-sm`;
// สีเหลืองของปากกาเน้นข้อความ = ปุ่มที่สั่งให้ AI ทำงาน (สรุป, ถาม, สร้างสรุปข่าวเด่น)
export const AI_BTN      = "bg-marker text-ink hover:bg-marker-deep disabled:bg-wash disabled:text-faint";
export const INK_BTN     = "bg-ink text-white hover:bg-ink-deep disabled:bg-wash disabled:text-faint";
export const OUTLINE_BTN = "border border-line-strong bg-white text-ink hover:border-ink disabled:border-line disabled:text-faint";
export const GHOST_BTN   = "text-muted hover:bg-wash hover:text-ink";
export const DANGER_BTN  = "text-red-deep hover:bg-red-soft";
// ไฮไลต์ข้อสรุปปาดตามกันทีละข้อ
export const SWEEP_DELAY = ["", "[animation-delay:150ms]", "[animation-delay:300ms]", "[animation-delay:450ms]", "[animation-delay:600ms]"];

export const SEARCH_PAGE_SIZE = 20;
