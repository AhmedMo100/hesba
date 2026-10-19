const { useState, useEffect, useMemo, useRef, useContext, createContext, useCallback, useLayoutEffect } = React;

/* ================= helpers ================= */
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const normDigits = (s) => String(s == null ? '' : s).replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d)).replace(/٫/g, '.').replace(/،/g, '');
const toNum = (s) => { const n = parseFloat(normDigits(s).replace(/[^\d.\-]/g, '')); return isFinite(n) ? n : 0; };
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const fmt = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
const egp = (n) => fmt(n) + ' ج.م';
const uid = (p = 'x') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const normAr = (s) => String(s || '').toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').trim();
const pad2 = (n) => String(n).padStart(2, '0');
const dkey = (d) => { d = new Date(d); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
const startOfDay = (d) => { d = new Date(d); d.setHours(0, 0, 0, 0); return d; };
const addDays = (d, n) => { d = new Date(d); d.setDate(d.getDate() + n); return d; };
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const dateLabel = (d) => { const dd = daysBetween(d, new Date()); if (dd === 0) return 'النهارده'; if (dd === 1) return 'امبارح'; const x = new Date(d); return AR_DAYS[x.getDay()] + ' ' + x.getDate() + ' ' + AR_MONTHS[x.getMonth()]; };
const dateShort = (d) => { const x = new Date(d); return x.getDate() + ' ' + AR_MONTHS[x.getMonth()] + ' ' + x.getFullYear(); };
const timeText = (d) => { d = new Date(d); let h = d.getHours(); const m = pad2(d.getMinutes()); const ap = h >= 12 ? 'م' : 'ص'; h = h % 12 || 12; return h + ':' + m + ' ' + ap; };

const PERIODS = [['today', 'النهارده'], ['yesterday', 'امبارح'], ['week', 'آخر 7 أيام'], ['month', 'الشهر ده'], ['year', 'السنة دي'], ['custom', 'فترة محددة']];
function rangeFor(key, custom) {
  const t = startOfDay(new Date()); let from = t, to = t;
  if (key === 'yesterday') { from = to = addDays(t, -1); }
  else if (key === 'week') { from = addDays(t, -6); }
  else if (key === 'month') { from = new Date(t.getFullYear(), t.getMonth(), 1); }
  else if (key === 'year') { from = new Date(t.getFullYear(), 0, 1); }
  else if (key === 'custom' && custom && custom.from && custom.to) { from = parseKey(custom.from); to = parseKey(custom.to); if (to < from) { const x = from; from = to; to = x; } }
  return { from, to: new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999) };
}
const inRange = (ts, r) => ts >= r.from.getTime() && ts <= r.to.getTime();
function periodTitle(key, custom) {
  if (key === 'custom' && custom && custom.from) return custom.from === custom.to ? dateShort(parseKey(custom.from)) : dateShort(parseKey(custom.from)) + ' ← ' + dateShort(parseKey(custom.to));
  return (PERIODS.find((p) => p[0] === key) || [0, ''])[1];
}

/* ---------- product helpers ---------- */
const isW = (p) => !!p && p.kind === 'weight';
const packN = (p) => (p && !isW(p) && p.n > 1 ? p.n : 0);
function weightText(k) { k = r3(k); if (k <= 0) return '0 كجم'; if (k < 1) return Math.round(k * 1000) + ' جرام'; return String(k).replace(/\.0+$/, '') + ' كجم'; }
function qtyText(p, q) {
  if (isW(p)) return weightText(q);
  const n = packN(p); q = Math.round(q);
  if (!n) return q + ' قطعة';
  const c = Math.floor(q / n), r = q - c * n, parts = [];
  if (c) parts.push(c + ' كرتونة'); if (r || !c) parts.push(r + ' قطعة');
  return parts.join(' و ');
}
function stockLevel(p, q) {
  if (q <= 0.0001) return 'out';
  if (isW(p)) return q < 3 ? 'low' : 'ok';
  const n = packN(p); if (n) return q < 2 * n ? 'low' : 'ok';
  return q < 10 ? 'low' : 'ok';
}
const unitPriceText = (p) => (isW(p) ? egp(p.sell) + ' / كجم' : egp(p.sell) + ' / قطعة');
const guessCat = (name) => {
  const rules = [[/بيبسي|pepsi|كولا|coca|سبرايت|عصير|مشروب/i, 'مشروبات'], [/مياه|ميه/i, 'مياه'], [/زيت|سمن/i, 'زيوت وسمن'], [/لانشون|بسطرمة|جبنة|جبن|رومي|شيدر/i, 'لحوم باردة وأجبان'], [/لبن|زبادي|قشطة/i, 'ألبان'], [/زيتون|مخلل/i, 'مخللات وزيتون'], [/سكر|ارز|أرز|عدس|فول سوداني|دقيق/i, 'سكر وأرز وبقوليات'], [/مكرون|صلصة/i, 'مكرونة وصلصة'], [/بسكويت|شيبس|شوكولاتة|حلوى|كيك/i, 'سناكس وحلويات'], [/شاي|نسكافيه|قهوة/i, 'شاي وقهوة'], [/تايد|منظف|كلور|صابون سائل/i, 'منظفات'], [/صابون|شامبو|معجون/i, 'عناية شخصية'], [/منديل|مناديل|ورق/i, 'ورقيات'], [/تونة|معلب|فول/i, 'معلبات'], [/عيش|توست|خبز/i, 'مخبوزات']];
  const r = rules.find(([rx]) => rx.test(name)); return r ? r[1] : 'متفرقات';
};

/* ================= seed data ================= */
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// name, cat, kind, n, buy, sell, sellPack, avg/day, stock, expiry days (null = far)
const DEFS = [
  ['Pepsi 1L', 'مشروبات', 'u', 12, 13.5, 15, 170, 9, 20, null], ['Coca-Cola 1L', 'مشروبات', 'u', 12, 13.5, 15, 170, 8, 60, null],
  ['مياه معدنية 1.5 لتر', 'مياه', 'u', 6, 4.5, 6, 33, 20, 96, null], ['عصير جهينة', 'مشروبات', 'u', 24, 7, 9, 200, 6, 40, 'expired'],
  ['لبن جهينة 1 لتر', 'ألبان', 'u', 12, 25, 28, 320, 12, 48, 'soon3'], ['زبادي', 'ألبان', 'u', 12, 6, 8, 90, 7, 0, null],
  ['زيت عباد الشمس', 'زيوت وسمن', 'u', 12, 68, 78, 900, 3, 18, null], ['سمن نباتي', 'زيوت وسمن', 'u', 12, 70, 82, 950, 1.5, 36, null],
  ['مكرونة', 'مكرونة وصلصة', 'u', 20, 11.5, 14, 260, 6, 120, null], ['صلصة طماطم', 'مكرونة وصلصة', 'u', 24, 7, 9, 200, 3, 70, null],
  ['بسكويت', 'سناكس وحلويات', 'u', 24, 6.5, 8, 180, 7, 100, null], ['شيبسي', 'سناكس وحلويات', 'u', 48, 4, 5, 220, 10, 200, null],
  ['شوكولاتة', 'سناكس وحلويات', 'u', 24, 9, 12, 260, 5, 60, null], ['شاي ليبتون', 'شاي وقهوة', 'u', 24, 46, 52, 1180, 3, 50, null],
  ['نسكافيه', 'شاي وقهوة', 'u', 12, 45, 52, 590, 2, 24, null], ['Tide 2kg', 'منظفات', 'u', 6, 142, 160, 900, 2, 40, null],
  ['صابون لوكس', 'عناية شخصية', 'u', 12, 11, 14, 160, 3, 60, null], ['معجون أسنان', 'عناية شخصية', 'u', 12, 22, 28, 310, 1.5, 36, null],
  ['مناديل فاين', 'ورقيات', 'u', 12, 30, 38, 430, 2, 30, null], ['ورق حمام', 'ورقيات', 'u', 8, 24, 30, 230, 2.5, 48, null],
  ['تونة معلبة', 'معلبات', 'u', 24, 33, 38, 880, 4, 72, null], ['فول معلب', 'معلبات', 'u', 24, 15, 18, 410, 3, 60, null],
  ['عيش توست', 'مخبوزات', 'u', 1, 20, 24, 0, 4, 12, 5],
  ['لانشون بقري', 'لحوم باردة وأجبان', 'w', 0, 195, 240, 0, 2.5, 2.6, 10], ['جبنة رومي', 'لحوم باردة وأجبان', 'w', 0, 270, 320, 0, 1.2, 8, 40],
  ['جبنة بيضاء', 'لحوم باردة وأجبان', 'w', 0, 80, 95, 0, 1.8, 14, 'soon6'], ['جبنة شيدر', 'لحوم باردة وأجبان', 'w', 0, 230, 280, 0, 0.6, 5, 12],
  ['بسطرمة', 'لحوم باردة وأجبان', 'w', 0, 540, 650, 0, 0.5, 1.4, 20], ['زيتون أخضر', 'مخللات وزيتون', 'w', 0, 62, 80, 0, 1, 6, null],
  ['مخلل مشكل', 'مخللات وزيتون', 'w', 0, 35, 45, 0, 1, 8, null], ['سكر سايب', 'سكر وأرز وبقوليات', 'w', 0, 28, 32, 0, 5, 40, null],
  ['أرز سايب', 'سكر وأرز وبقوليات', 'w', 0, 33, 38, 0, 4, 30, null], ['عدس', 'سكر وأرز وبقوليات', 'w', 0, 45, 55, 0, 1, 0, null],
];
function makeEmpty() { const s = makeSeed(); return { ...s, products: [], batches: [], sales: [], expenses: [], waste: [], people: { owedToMe: [], iOwe: [], suppliers: [] } }; }
function hashPass(p) { let h = 5381; const x = 'hesba|' + p; for (let i = 0; i < x.length; i++) h = ((h << 5) + h + x.charCodeAt(i)) | 0; return String(h >>> 0); }
function makeSeed() {
  const R = mulberry(20261015), now = Date.now(), today = startOfDay(new Date());
  const products = [], batches = [], sales = [];
  const dayTs = (off, h) => { const d = addDays(today, -off); d.setHours(h, Math.floor(R() * 60), Math.floor(R() * 60), 0); return d.getTime(); };
  const expKey = (days) => dkey(addDays(today, days));
  DEFS.forEach((d, i) => {
    const [name, cat, k, n, buy, sell, sellPack, avg, stock, ex] = d;
    const p = { id: 'p' + (i + 1), name, cat, kind: k === 'w' ? 'weight' : 'unit', n: k === 'w' ? 0 : n, buy, sell, packBuy: k === 'u' && n > 1 ? r2(buy * n) : 0, packSell: k === 'u' && n > 1 ? sellPack : 0 };
    products.push(p);
    const far = () => expKey(150 + Math.floor(R() * 250));
    const mk = (off, qty, remaining, expiry) => batches.push({ id: uid('b'), pid: p.id, ts: dayTs(off, 9 + Math.floor(R() * 8)), qty, remaining, costUnit: r2(buy * (0.97 + R() * 0.06)), cost: 0, expiry, sid: null, paid: true });
    const typ = Math.max(n || 1, Math.round(avg * 14));
    [45 + (i % 9), 30 + (i % 7), 16 + (i % 5)].forEach((off) => mk(off, k === 'w' ? r3(avg * 14) : typ, 0, far()));
    if (stock > 0) {
      if (ex === 'expired') { mk(40, 20, 10, expKey(-2)); mk(i % 4 === 0 ? 0 : 3, 30, 30, expKey(90)); }
      else if (ex === 'soon3') { mk(12, 24, 12, expKey(3)); mk(1, 36, 36, expKey(20)); }
      else if (ex === 'soon6') { mk(9, 8, 6, expKey(6)); mk(2, 12, 8, expKey(25)); }
      else { mk(i % 9 === 0 ? 0 : 1 + (i % 11), k === 'w' ? Math.max(stock, 1) : Math.max(stock, n || 1), stock, typeof ex === 'number' ? expKey(ex) : far()); }
    }
    if (i % 4 === 0 && stock > 0) { /* extra recent addition for the log */ mk(1 + (i % 3), k === 'w' ? 5 : Math.max(n || 1, 12), 0, far()); }
    // sales history 60 days
    for (let off = 59; off >= 0; off--) {
      const dow = addDays(today, -off).getDay(); const f = (dow === 5 ? 1.3 : dow === 6 ? 1.2 : 1) * (0.9 + (59 - off) * 0.002);
      let frac = 1; if (off === 0) { const hr = new Date().getHours() + new Date().getMinutes() / 60; frac = Math.max(0.35, Math.min(1, (hr - 9) / 13)); }
      const mu = avg * f * frac * (0.6 + R() * 0.8);
      if (k === 'u') {
        let c = Math.round(mu); if (c <= 0) continue;
        const parts = c > 6 ? 2 : 1;
        for (let q = 0; q < parts; q++) { const qty = q === parts - 1 ? c : Math.ceil(c / 2); c -= qty; if (qty <= 0) continue; const ts = off === 0 ? Math.max(today.getTime() + 60000, now - Math.floor(R() * Math.max(1, (now - today.getTime()) - 120000)) - 60000) : dayTs(off, 9 + Math.floor(R() * 13)); sales.push({ id: uid('s'), ts, pid: p.id, qty, kind: 'piece', amount: r2(qty * sell), cost: r2(qty * buy), takes: [] }); }
      } else {
        let tot = r3(Math.max(0, mu)); if (tot < 0.1) continue; const parts = tot > 2 ? 3 : tot > 0.8 ? 2 : 1;
        for (let q = 0; q < parts; q++) { let qty = q === parts - 1 ? tot : r3(Math.round(tot / parts * 20) / 20); tot = r3(tot - qty); if (qty < 0.05) continue; const ts = off === 0 ? Math.max(today.getTime() + 60000, now - Math.floor(R() * Math.max(1, (now - today.getTime()) - 120000)) - 60000) : dayTs(off, 9 + Math.floor(R() * 13)); sales.push({ id: uid('s'), ts, pid: p.id, qty, kind: 'kg', amount: r2(qty * sell), cost: r2(qty * buy), takes: [] }); }
      }
    }
  });
  batches.forEach((b) => { b.cost = r2(b.qty * b.costUnit); });
  const exps = [];
  const ex = (off, cat, amount, note) => exps.push({ id: uid('e'), ts: dayTs(off, 11 + Math.floor(R() * 6)), cat, amount, note: note || '' });
  const dom = new Date().getDate();
  for (let m = 0; m < 3; m++) { const base = new Date(today.getFullYear(), today.getMonth() - m, 1); const off0 = daysBetween(base, today); if (off0 <= 59) ex(off0, 'إيجار', 6000, 'إيجار المحل'); if (off0 - 7 >= 0 && off0 - 7 <= 59) ex(off0 - 7, 'كهرباء', 780 + Math.round(R() * 140)); if (off0 - 11 >= 0 && off0 - 11 <= 59) ex(off0 - 11, 'نت', 260, 'باقة النت'); if (off0 - 24 >= 0 && off0 - 24 <= 59) ex(off0 - 24, 'مرتبات', 3800, 'أجر العامل'); }
  [3, 9, 17, 26, 38, 51].forEach((o, i) => ex(o, i % 2 ? 'نقل' : 'صيانة', 80 + Math.round(R() * 220), i % 2 ? 'توصيل بضاعة' : 'صيانة التلاجة'));
  ex(0, 'نقل', 120, 'توصيل أوردر'); ex(1, 'أخرى', 45, 'أكياس وفواتير');
  const people = {
    owedToMe: [
      { id: uid('c'), name: 'محمد', phone: '01012345678', amount: 850, note: 'من 12 يوم', ts: now - 12 * 864e5 },
      { id: uid('c'), name: 'أبو خالد', phone: '01123456789', amount: 2400, note: 'حساب الشهر', ts: now - 8 * 864e5 },
      { id: uid('c'), name: 'ست سناء', phone: '01098765432', amount: 1650, note: '', ts: now - 9 * 864e5 },
      { id: uid('c'), name: 'عم حسن', phone: '01234567890', amount: 1200, note: '', ts: now - 6 * 864e5 },
    ],
    iOwe: [
      { id: uid('o'), name: 'الحاج إبراهيم', phone: '01001234567', amount: 1500, note: 'سلفة', ts: now - 20 * 864e5 },
      { id: uid('o'), name: 'أستاذ سمير', phone: '01155550000', amount: 800, note: 'صيانة المحل', ts: now - 5 * 864e5 },
    ],
    suppliers: [
      { id: uid('v'), name: 'شركة النور', phone: '01001112233', supplies: ['p1', 'p2', 'p3', 'p4'], owed: 3200 },
      { id: uid('v'), name: 'شركة البركة للألبان', phone: '01113334455', supplies: ['p5', 'p6', 'p26'], owed: 1850 },
      { id: uid('v'), name: 'مورد اللحوم', phone: '01225556677', supplies: ['p24', 'p27', 'p28'], owed: 0 },
      { id: uid('v'), name: 'تاجر الجملة الأمل', phone: '01550001122', supplies: ['p7', 'p8', 'p9', 'p31', 'p32'], owed: 5400 },
    ],
  };
  // link a few recent additions to suppliers
  const sup = (pid) => people.suppliers.find((s) => s.supplies.includes(pid));
  batches.forEach((b) => { if (b.ts > now - 14 * 864e5) { const s = sup(b.pid); if (s) b.sid = s.id; } });
  return { v: 2, store: { name: 'سوبر ماركت البركة' }, products, batches, sales, expenses: exps, waste: [], people, ai: { date: dkey(new Date()), count: 0 }, theme: 'auto', queue: 0, profile: null };
}

/* ================= store ================= */
const AppCtx = createContext(null);
const useApp = () => useContext(AppCtx);
const LS_KEY = 'hesba-demo-v2';
function loadState() {
  try { const raw = localStorage.getItem(LS_KEY); if (raw) { const s = JSON.parse(raw); if (s && s.v === 2) return s; } } catch (e) {}
  return makeSeed();
}
function stockMapOf(S) { const m = {}; S.batches.forEach((b) => { m[b.pid] = r3((m[b.pid] || 0) + b.remaining); }); return m; }
function planSale(S, p, qty, kind, packs) {
  qty = isW(p) ? r3(qty) : Math.round(qty);
  if (!(qty > 0)) return { err: 'اكتب كمية صح' };
  const stock = stockMapOf(S)[p.id] || 0;
  if (stock <= 0.0001) return { err: p.name + ' خلصان من المخزون' };
  if (qty > stock + 1e-9) return { err: 'المتاح من ' + p.name + ' بس ' + qtyText(p, stock) };
  const bs = S.batches.filter((b) => b.pid === p.id && b.remaining > 0).sort((a, b) => { const ea = a.expiry || '9999', eb = b.expiry || '9999'; return ea < eb ? -1 : ea > eb ? 1 : a.ts - b.ts; });
  let need = qty, cost = 0; const takes = [];
  for (const b of bs) { if (need <= 1e-9) break; const t = Math.min(b.remaining, need); takes.push({ bid: b.id, q: t }); cost += t * b.costUnit; need = r3(need - t); }
  const amount = kind === 'pack' ? r2((packs || 1) * (p.packSell || p.sell * p.n)) : r2(qty * p.sell);
  return { qty, amount, cost: r2(cost), takes };
}

function useStoreImpl() {
  const [S, setS] = useState(loadState);
  const ref = useRef(S); const [online, setOnlineS] = useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  const onRef = useRef(online); onRef.current = online;
  const [sync, setSync] = useState(null);
  const commit = useCallback((fn) => { const cur = ref.current; let n = fn(cur); if (!n || n === cur) return; if (!onRef.current) n = { ...n, queue: (n.queue || 0) + 1 }; ref.current = n; setS(n); }, []);
  useEffect(() => { const t = setTimeout(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {} }, 400); return () => clearTimeout(t); }, [S]);
  useEffect(() => { const on = () => setOnlineS(true), off = () => setOnlineS(false); window.addEventListener('online', on); window.addEventListener('offline', off); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); }; }, []);
  const syncNow = useCallback(() => { const q = ref.current.queue || 0; if (!q) return; setSync('syncing'); setTimeout(() => { const n = { ...ref.current, queue: 0 }; ref.current = n; setS(n); setSync({ done: q }); }, 1400); }, []);
  useEffect(() => { if (online && (S.queue || 0) > 0 && !sync) syncNow(); }, [online, S.queue, sync, syncNow]);
  useEffect(() => { if (!sync || sync === 'syncing') return; const t = setTimeout(() => setSync(null), 3200); return () => clearTimeout(t); }, [sync]);

  const act = useMemo(() => ({
    addProduct(p) { const id = uid('p'); commit((s) => ({ ...s, products: [{ id, ...p }, ...s.products] })); return id; },
    editProduct(id, patch) { commit((s) => ({ ...s, products: s.products.map((p) => (p.id === id ? { ...p, ...patch } : p)) })); },
    deleteProduct(id) { commit((s) => ({ ...s, products: s.products.filter((p) => p.id !== id), batches: s.batches.filter((b) => b.pid !== id), people: { ...s.people, suppliers: s.people.suppliers.map((v) => ({ ...v, supplies: v.supplies.filter((x) => x !== id) })) } })); },
    addStock({ pid, qty, cost, expiry, sid, paid, ts }) {
      const bid = uid('b'); const p = ref.current.products.find((x) => x.id === pid); if (!p) return null;
      commit((s) => {
        const costUnit = r2(cost / qty);
        const batch = { id: bid, pid, ts: ts || Date.now(), qty, remaining: qty, costUnit: r3(cost / qty), cost, expiry: expiry || null, sid: sid || null, paid: paid !== false };
        const products = s.products.map((x) => (x.id === pid ? { ...x, buy: costUnit > 0 ? costUnit : x.buy, packBuy: !isW(x) && x.n > 1 ? r2(costUnit * x.n) : x.packBuy } : x));
        let people = s.people;
        if (sid) people = { ...people, suppliers: people.suppliers.map((v) => (v.id === sid ? { ...v, owed: paid === false ? r2(v.owed + cost) : v.owed, supplies: v.supplies.includes(pid) ? v.supplies : [...v.supplies, pid] } : v)) };
        return { ...s, batches: [batch, ...s.batches], products, people };
      });
      return bid;
    },
    deleteBatch(bid) { commit((s) => ({ ...s, batches: s.batches.filter((b) => b.id !== bid) })); },
    writeOff(bid, reason) {
      commit((s) => { const b = s.batches.find((x) => x.id === bid); if (!b || b.remaining <= 0) return s; const w = { id: uid('w'), ts: Date.now(), pid: b.pid, qty: b.remaining, cost: r2(b.remaining * b.costUnit), reason: reason || 'expired' }; return { ...s, waste: [w, ...s.waste], batches: s.batches.map((x) => (x.id === bid ? { ...x, remaining: 0 } : x)) }; });
    },
    sell(pid, qty, kind, packs) {
      const p = ref.current.products.find((x) => x.id === pid); if (!p) return { err: 'منتج مش موجود' };
      const plan = planSale(ref.current, p, qty, kind, packs); if (plan.err) return plan;
      const id = uid('s');
      commit((s) => {
        const rec = { id, ts: Date.now(), pid, qty: plan.qty, kind, amount: plan.amount, cost: plan.cost, takes: plan.takes };
        const tk = {}; plan.takes.forEach((t) => { tk[t.bid] = t.q; });
        return { ...s, sales: [rec, ...s.sales], batches: s.batches.map((b) => (tk[b.id] ? { ...b, remaining: r3(b.remaining - tk[b.id]) } : b)) };
      });
      return { id, amount: plan.amount, qty: plan.qty };
    },
    undoSales(ids) {
      commit((s) => {
        const set = new Set(ids); const back = {}; s.sales.forEach((x) => { if (set.has(x.id)) x.takes.forEach((t) => { back[t.bid] = r3((back[t.bid] || 0) + t.q); }); });
        return { ...s, sales: s.sales.filter((x) => !set.has(x.id)), batches: s.batches.map((b) => (back[b.id] ? { ...b, remaining: r3(b.remaining + back[b.id]) } : b)) };
      });
    },
    addExpense(e) { commit((s) => ({ ...s, expenses: [{ id: uid('e'), ts: Date.now(), ...e }, ...s.expenses].sort((a, b) => b.ts - a.ts) })); },
    deleteExpense(id) { commit((s) => ({ ...s, expenses: s.expenses.filter((e) => e.id !== id) })); },
    addPerson(sec, p) { const id = uid('q'); commit((s) => ({ ...s, people: { ...s.people, [sec]: [{ id, ts: Date.now(), ...p }, ...s.people[sec]] } })); return id; },
    updatePerson(sec, id, patch) { commit((s) => ({ ...s, people: { ...s.people, [sec]: s.people[sec].map((x) => (x.id === id ? { ...x, ...(typeof patch === 'function' ? patch(x) : patch) } : x)) } })); },
    deletePerson(sec, id) { commit((s) => ({ ...s, people: { ...s.people, [sec]: s.people[sec].filter((x) => x.id !== id) } })); },
    useAi() { commit((s) => { const t = dkey(new Date()); const a = s.ai.date === t ? s.ai : { date: t, count: 0 }; return { ...s, ai: { date: t, count: a.count + 1 } }; }); },
    setTheme(t) { commit((s) => ({ ...s, theme: t })); },
    setStoreName(n) { commit((s) => ({ ...s, store: { ...s.store, name: n } })); },
    signup(profile, demo) { const base = demo ? makeSeed() : makeEmpty(); const n = { ...base, profile, store: { name: profile.storeName }, theme: ref.current.theme || 'auto' }; ref.current = n; setS(n); },
    updateProfile(patch) { commit((s) => ({ ...s, profile: { ...s.profile, ...patch }, store: { ...s.store, name: patch.storeName || s.store.name } })); },
    reset() { const n = { ...makeSeed(), profile: ref.current.profile, store: ref.current.store, theme: ref.current.theme }; ref.current = n; setS(n); },
  }), [commit]);
  const stockMap = useMemo(() => stockMapOf(S), [S.batches]);
  return { S, act, stockMap, online, setOnline: setOnlineS, sync, syncNow, ref };
}
