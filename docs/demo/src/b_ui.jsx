/* ================= UI kit ================= */
const IC = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  box: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  cart: 'M3 4h2l2.4 11h10.2L20 7H6M9 20.2v.01M17 20.2v.01',
  layers: 'M12 3 3 8l9 5 9-5-9-5zM3 12.5l9 5 9-5M3 17l9 5 9-5',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14.5h2',
  users: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  bell: 'M6 16v-5a6 6 0 1 1 12 0v5l2 2H4zM10 21h4',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  more: 'M12 5.5v.01M12 12v.01M12 18.5v.01',
  dots: 'M5 12v.01M12 12v.01M19 12v.01',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zM6 11a6 6 0 0 0 12 0M12 17v4',
  plus: 'M12 5v14M5 12h14', x: 'M6 6l12 12M18 6 6 18', check: 'M5 12.5l4.5 4.5L19 7',
  down: 'M6 9l6 6 6-6', left: 'M15 6l-6 6 6 6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  auto: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3v18M12 3a9 9 0 0 1 0 18z',
  wifioff: 'M2 8.8a15 15 0 0 1 4-2.4M22 8.8a15 15 0 0 0-8-3.7M5 12.5a10 10 0 0 1 3.5-2M19 12.5a10 10 0 0 0-5-2.4M8.5 16a5 5 0 0 1 7 0M12 20v.01M3 3l18 18',
  wifi: 'M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20v.01',
  refresh: 'M20 11a8 8 0 0 0-14-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2M20 20v-5h-5',
  logout: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
  cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  send: 'M4 12 20 4l-6 16-3-7z', download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  alert: 'M12 4 2.5 20h19zM12 10v4M12 17v.01', clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2', store: 'M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0M10 20v-5h4v5',
  scale: 'M12 4v16M6 20h12M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z',
  print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z', truck: 'M2 6h11v10H2zM13 9h4l3 3v4h-7M6 19.2v.01M17 19.2v.01',
  list: 'M8 6h12M8 12h12M8 18h12M4 6v.01M4 12v.01M4 18v.01', trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8v.01', stop: 'M7 7h10v10H7z',
};
function Icon({ n, s = 20, sw = 2, className = '' }) {
  return (<svg className={'ic ' + className} width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={n === 'more' || n === 'dots' ? 3.2 : sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={IC[n] || ''} /></svg>);
}

function useGhost(ref, cls) {
  useLayoutEffect(() => () => {
    const n = ref.current; if (!n || !n.parentNode) return;
    try { if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (e) {}
    const r = n.getBoundingClientRect(); const g = n.cloneNode(true); g.removeAttribute('id'); g.classList.add(cls || 'out'); g.setAttribute('aria-hidden', 'true');
    Object.assign(g.style, { inset: 'auto', position: 'fixed', top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px', margin: '0', pointerEvents: 'none', zIndex: getComputedStyle(n).zIndex });
    g.querySelectorAll('input,button,select').forEach((x) => { x.tabIndex = -1; });
    document.body.appendChild(g); setTimeout(() => g.remove(), 300);
  }, []);
}
function Btn({ kind = 'primary', icon, children, className = '', ...rest }) {
  return <button type="button" className={'btn btn-' + kind + ' ' + className} {...rest}>{icon && <Icon n={icon} s={18} />}{children}</button>;
}

function Modal({ title, onClose, children, footer, wide }) {
  const ovr = useRef(null); useGhost(ovr, 'out');
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k); document.body.classList.add('lock');
    return () => { window.removeEventListener('keydown', k); document.body.classList.remove('lock'); };
  }, [onClose]);
  return (
    <div className="ov" ref={ovr} onFocus={(e) => { const t = e.target; if (/INPUT|SELECT/.test(t.tagName)) setTimeout(() => { try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (x) {} }, 280); }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'sheet' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="grab" />
        <div className="sh-h"><h3>{title}</h3><button type="button" className="ib" aria-label="إغلاق" onClick={onClose}><Icon n="x" /></button></div>
        <div className="sh-b">{children}</div>
        {footer && <div className="sh-f">{footer}</div>}
      </div>
    </div>
  );
}

function Field({ label, hint, err, children, grow, div }) {
  const T = div ? 'div' : 'label';
  return (<T className={'fld' + (err ? ' bad' : '') + (grow ? ' grow' : '')}><span className="fl">{label}</span>{children}{err ? <span className="fe">{err}</span> : hint ? <span className="fh">{hint}</span> : null}</T>);
}
function Num({ value, onChange, suffix, placeholder, ...rest }) {
  return (<div className="num"><input inputMode="decimal" autoComplete="off" value={value} placeholder={placeholder || '0'} onChange={(e) => onChange(normDigits(e.target.value).replace(/[^\d.]/g, ''))} onFocus={(e) => e.target.select()} {...rest} />{suffix && <span className="sfx">{suffix}</span>}</div>);
}
function Seg({ value, onChange, options, className = '' }) {
  const i = Math.max(0, options.findIndex((o) => o[0] === value));
  return (<div className={'seg ' + className} style={{ '--n': options.length, '--i': i }} role="tablist"><i className="seg-th" />{options.map(([v, l, ic]) => (<button type="button" role="tab" aria-selected={value === v} key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{ic && <Icon n={ic} s={16} />}<span>{l}</span></button>))}</div>);
}
function Empty({ icon = 'box', title, sub, action }) {
  return (<div className="empty"><div className="e-ic"><Icon n={icon} s={28} /></div><b>{title}</b>{sub && <span>{sub}</span>}{action}</div>);
}
function PageHead({ title, sub, children }) {
  return (<div className="phead"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div><div className="pact">{children}</div></div>);
}

/* ---------- toasts ---------- */
const ToastCtx = createContext(null);
const useToast = () => useContext(ToastCtx);
function ToastHost({ children }) {
  const [list, setList] = useState([]); const timers = useRef({});
  const remove = useCallback((id) => { clearTimeout(timers.current[id]); delete timers.current[id]; setList((l) => l.filter((t) => t.id !== id)); }, []);
  const show = useCallback((o) => {
    const id = o.id || uid('t'); const ms = o.ms || (o.undo ? 5000 : 2800);
    clearTimeout(timers.current[id]); timers.current[id] = setTimeout(() => remove(id), ms);
    setList((l) => { const t = { kind: 'ok', ...o, id, ms, k: Date.now() }; const i = l.findIndex((x) => x.id === id); if (i >= 0) { const n = l.slice(); n[i] = t; return n; } return [...l.slice(-2), t]; });
    return id;
  }, [remove]);
  const api = useMemo(() => ({ show, remove }), [show, remove]);
  return (<ToastCtx.Provider value={api}>{children}
    <div className="toasts" aria-live="polite">{list.map((t) => <ToastItem key={t.id} t={t} remove={remove} />)}</div></ToastCtx.Provider>);
}

function ToastItem({ t, remove }) {
  const r = useRef(null); useGhost(r, 'out');
  return (<div ref={r} className={'toast ' + t.kind}><span className="t-ic"><Icon n={t.kind === 'err' ? 'alert' : 'check'} s={16} sw={2.6} /></span><span className="tm">{t.msg}</span>
    {t.undo && <button type="button" className="tu" onClick={() => { t.undo(); remove(t.id); }}><Icon n="undo" s={16} />تراجع</button>}
    <i className="tbar" key={t.k} style={{ animationDuration: t.ms + 'ms' }} /></div>);
}
/* ---------- voice ---------- */
function VoiceButton({ onText, sample, label = 'اتكلم' }) {
  const [on, setOn] = useState(false); const rec = useRef(null); const tm = useRef(null);
  useEffect(() => () => { try { rec.current && rec.current.abort(); } catch (e) {} clearTimeout(tm.current); }, []);
  const fake = () => { setOn(true); tm.current = setTimeout(() => { setOn(false); onText(sample || ''); }, 1500); };
  const start = () => {
    if (on) { try { rec.current && rec.current.stop(); } catch (e) {} clearTimeout(tm.current); setOn(false); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return fake();
    try {
      const r = new SR(); r.lang = 'ar-EG'; r.interimResults = false; r.maxAlternatives = 1; rec.current = r;
      let got = false;
      r.onresult = (e) => { got = true; onText(e.results[0][0].transcript); };
      r.onerror = () => { if (!got) { setOn(false); fake(); } };
      r.onend = () => setOn(false);
      r.start(); setOn(true);
    } catch (e) { fake(); }
  };
  return (<button type="button" className={'ib mic' + (on ? ' rec' : '')} aria-label={label} title={label} onClick={start}><Icon n="mic" /></button>);
}
function SearchBox({ value, onChange, placeholder, sample, voice = true }) {
  return (<div className="sbox"><Icon n="search" s={18} /><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />{value && <button type="button" className="ib sm" aria-label="مسح" onClick={() => onChange('')}><Icon n="x" s={16} /></button>}{voice && <VoiceButton sample={sample} onText={(t) => onChange(String(t).replace(/[.،؟?]/g, '').trim())} label="بحث بالصوت" />}</div>);
}

/* ---------- combobox (inline searchable) ---------- */
function Combobox({ options, value, onChange, placeholder, emptyAction, id }) {
  const [q, setQ] = useState(''); const [open, setOpen] = useState(false); const [hi, setHi] = useState(0); const wrap = useRef(null);
  const sel = options.find((o) => o.id === value);
  const list = useMemo(() => { const n = normAr(q); return (n ? options.filter((o) => normAr(o.label).includes(n)) : options).slice(0, 60); }, [q, options]);
  useEffect(() => { setHi(0); }, [q]);
  const pick = (o) => { onChange(o.id); setOpen(false); setQ(''); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, list.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && open && list[hi]) { e.preventDefault(); pick(list[hi]); }
    else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); }
  };
  return (
    <div className="cbx" ref={wrap}>
      <div className={'cb-in' + (open ? ' open' : '')}>
        <Icon n="search" s={18} />
        <input id={id} value={open ? q : sel ? sel.label : ''} placeholder={placeholder} role="combobox" aria-expanded={open}
          onFocus={() => { setOpen(true); setQ(''); }} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onKeyDown={onKey} autoComplete="off" />
        {sel && !open && <button type="button" className="ib sm" aria-label="تغيير" onClick={() => { onChange(null); setOpen(true); setQ(''); }}><Icon n="x" s={16} /></button>}
        <button type="button" className="ib sm" tabIndex={-1} aria-label="فتح القايمة" onClick={() => setOpen((o) => !o)}><Icon n="down" s={16} /></button>
      </div>
      {open && (<div className="cb-list" role="listbox">
        {list.length === 0 && <div className="cb-none">مفيش منتج بالاسم ده</div>}
        {list.map((o, i) => (<button type="button" role="option" aria-selected={o.id === value} key={o.id} className={'cb-opt' + (i === hi ? ' hi' : '')} onMouseEnter={() => setHi(i)} onClick={() => pick(o)}><span>{o.label}</span>{o.sub && <small>{o.sub}</small>}</button>))}
        {emptyAction && <button type="button" className="cb-add" onClick={() => { setOpen(false); emptyAction(q); }}><Icon n="plus" s={16} />{q ? 'ضيف "' + q + '" كمنتج جديد' : 'مش لاقيه؟ ضيف منتج جديد'}</button>}
      </div>)}
      {open && <div className="cb-shield" onClick={() => setOpen(false)} />}
    </div>
  );
}

/* ---------- period bar ---------- */
function PeriodBar({ value, onChange, custom, onCustom, options }) {
  const opts = options || PERIODS;
  return (<div className="pbar">
    <div className="chips" role="tablist">{opts.map(([k, l]) => (<button type="button" key={k} role="tab" aria-selected={value === k} className={'chip' + (value === k ? ' on' : '')} onClick={() => onChange(k)}>{l}</button>))}</div>
    {value === 'custom' && (<div className="pcustom"><label><span>من</span><input type="date" value={(custom && custom.from) || ''} max={dkey(new Date())} onChange={(e) => onCustom({ from: e.target.value, to: (custom && custom.to) || e.target.value })} /></label><label><span>إلى</span><input type="date" value={(custom && custom.to) || ''} max={dkey(new Date())} onChange={(e) => onCustom({ from: (custom && custom.from) || e.target.value, to: e.target.value })} /></label></div>)}
  </div>);
}
function usePeriod(init = 'today') {
  const [key, setKey] = useState(init); const [custom, setCustom] = useState({ from: dkey(addDays(new Date(), -3)), to: dkey(new Date()) });
  const range = useMemo(() => rangeFor(key, custom), [key, custom.from, custom.to]);
  return { key, setKey, custom, setCustom, range, title: periodTitle(key, custom) };
}

/* ---------- confirm ---------- */
function Confirm({ title, text, ok = 'تأكيد', danger, onOk, onClose }) {
  return (<Modal title={title} onClose={onClose} footer={<><Btn kind="ghost" onClick={onClose}>إلغاء</Btn><Btn kind={danger ? 'danger' : 'primary'} onClick={() => { onOk(); onClose(); }}>{ok}</Btn></>}><p className="cf-t">{text}</p></Modal>);
}

/* ================= product form ================= */
function ProductFormModal({ product, presetName, onClose, onSaved }) {
  const { act, ref } = useApp(); const toast = useToast();
  const p = product;
  const [name, setName] = useState(p ? p.name : presetName || '');
  const [kind, setKind] = useState(p ? p.kind : 'unit');
  const [wBuy, setWBuy] = useState(p && isW(p) ? String(p.buy) : ''); const [wSell, setWSell] = useState(p && isW(p) ? String(p.sell) : '');
  const [hasPack, setHasPack] = useState(p ? !!packN(p) : true);
  const [n, setN] = useState(p && packN(p) ? String(p.n) : '');
  const [pkB, setPkB] = useState(p && packN(p) ? String(p.packBuy) : ''); const [pkS, setPkS] = useState(p && packN(p) ? String(p.packSell) : '');
  const [pcB, setPcB] = useState(p && !isW(p) ? String(p.buy) : ''); const [pcS, setPcS] = useState(p && !isW(p) ? String(p.sell) : '');
  const [err, setErr] = useState({});
  const fix = (x) => (x === '' || !isFinite(x) ? '' : String(r2(x)));
  const setPack = (which, v) => { which === 'b' ? setPkB(v) : setPkS(v); const nn = toNum(n); if (nn > 0) (which === 'b' ? setPcB : setPcS)(v === '' ? '' : fix(toNum(v) / nn)); };
  const setPiece = (which, v) => { which === 'b' ? setPcB(v) : setPcS(v); const nn = toNum(n); if (nn > 0) (which === 'b' ? setPkB : setPkS)(v === '' ? '' : fix(toNum(v) * nn)); };
  const setCount = (v) => { setN(v); const nn = toNum(v); if (nn > 0) { if (pkB !== '') setPcB(fix(toNum(pkB) / nn)); else if (pcB !== '') setPkB(fix(toNum(pcB) * nn)); if (pkS !== '') setPcS(fix(toNum(pkS) / nn)); else if (pcS !== '') setPkS(fix(toNum(pcS) * nn)); } };
  const save = () => {
    const e = {}; const nm = name.trim(); if (!nm) e.name = 'اكتب اسم المنتج';
    let data;
    if (kind === 'weight') {
      if (!(toNum(wSell) > 0)) e.wSell = 'اكتب سعر البيع'; if (wBuy === '') e.wBuy = 'اكتب سعر الشراء';
      data = { name: nm, kind: 'weight', n: 0, buy: toNum(wBuy), sell: toNum(wSell), packBuy: 0, packSell: 0 };
    } else {
      const nn = hasPack ? Math.round(toNum(n)) : 1;
      if (hasPack && nn < 2) e.n = 'عدد القطع في الكرتونة (2 أو أكتر)';
      if (!(toNum(pcS) > 0)) e[hasPack ? 'pcS' : 'pcS'] = 'اكتب سعر البيع'; if (pcB === '') e.pcB = 'اكتب سعر الشراء';
      data = { name: nm, kind: 'unit', n: hasPack ? nn : 0, buy: toNum(pcB), sell: toNum(pcS), packBuy: hasPack ? toNum(pkB) : 0, packSell: hasPack ? toNum(pkS) : 0 };
    }
    if (!e.name && ref.current.products.some((x) => normAr(x.name) === normAr(nm) && (!p || x.id !== p.id))) e.name = 'المنتج ده موجود قبل كده';
    setErr(e); if (Object.keys(e).length) return;
    data.cat = p && normAr(p.name) === normAr(nm) ? p.cat : guessCat(nm);
    if (p) { act.editProduct(p.id, data); toast.show({ msg: 'اتحفظ التعديل' }); onSaved && onSaved(p.id); }
    else { const id = act.addProduct(data); toast.show({ msg: 'اتضاف: ' + nm }); onSaved && onSaved(id); }
    onClose();
  };
  const [askDel, setAskDel] = useState(false);
  const profitHint = kind === 'weight' ? (toNum(wSell) > 0 && wBuy !== '' ? 'ربحك في الكيلو ' + egp(toNum(wSell) - toNum(wBuy)) : '') : (toNum(pcS) > 0 && pcB !== '' ? 'ربحك في القطعة ' + egp(toNum(pcS) - toNum(pcB)) : '');
  return (<>
    <Modal title={p ? 'تعديل المنتج' : 'إضافة منتج'} onClose={onClose}
      footer={<>{p && <Btn kind="dangerghost" icon="trash" onClick={() => setAskDel(true)}>حذف</Btn>}<span className="sp" /><Btn kind="ghost" onClick={onClose}>إلغاء</Btn><Btn onClick={save} icon="check">{p ? 'حفظ' : 'إضافة'}</Btn></>}>
      <Field label="اسم المنتج" err={err.name}><input autoFocus={!p} value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: بيبسي 330 مل" /></Field>
      <div className="fl-lbl">بيتباع إزاي؟</div>
      <Seg className="big" value={kind} onChange={setKind} options={[['unit', 'بالقطعة / الكرتونة', 'box'], ['weight', 'بالوزن (كيلو)', 'scale']]} />
      {kind === 'weight' ? (
        <div className="row2">
          <Field label="سعر شراء الكيلو" err={err.wBuy}><Num value={wBuy} onChange={setWBuy} suffix="ج.م" /></Field>
          <Field label="سعر بيع الكيلو" err={err.wSell}><Num value={wSell} onChange={setWSell} suffix="ج.م" /></Field>
        </div>
      ) : (<>
        <label className="chk"><input type="checkbox" checked={hasPack} onChange={(e) => setHasPack(e.target.checked)} /><span>بيتباع كرتونة كمان</span></label>
        {hasPack && <Field label="عدد القطع في الكرتونة" err={err.n}><Num value={n} onChange={setCount} suffix="قطعة" /></Field>}
        {hasPack && <div className="pgrp"><div className="pg-h">سعر الكرتونة</div><div className="row2"><Field label="شراء" err={err.pkB}><Num value={pkB} onChange={(v) => setPack('b', v)} suffix="ج.م" /></Field><Field label="بيع"><Num value={pkS} onChange={(v) => setPack('s', v)} suffix="ج.م" /></Field></div></div>}
        <div className="pgrp"><div className="pg-h">سعر القطعة{hasPack && toNum(n) > 0 ? <em> (بتتحسب لوحدها)</em> : ''}</div><div className="row2"><Field label="شراء" err={err.pcB}><Num value={pcB} onChange={(v) => setPiece('b', v)} suffix="ج.م" /></Field><Field label="بيع" err={err.pcS}><Num value={pcS} onChange={(v) => setPiece('s', v)} suffix="ج.م" /></Field></div></div>
      </>)}
      {profitHint && <div className="hint-pill"><Icon n="trend" s={16} />{profitHint}</div>}
    </Modal>
    {askDel && <Confirm danger title="حذف المنتج" ok="احذف" text={'هتحذف "' + p.name + '" ومخزونه. مبيعاتك القديمة هتفضل في التقارير.'} onClose={() => setAskDel(false)} onOk={() => { act.deleteProduct(p.id); toast.show({ msg: 'اتحذف: ' + p.name }); onClose(); }} />}
  </>);
}

/* ================= add stock ================= */
function AddStockModal({ presetPid, onClose }) {
  const { S, act, stockMap } = useApp(); const toast = useToast();
  const [pid, setPid] = useState(presetPid || null);
  const p = S.products.find((x) => x.id === pid);
  const [cartons, setCartons] = useState(''); const [pieces, setPieces] = useState(''); const [kg, setKg] = useState('');
  const [cost, setCost] = useState(''); const [expiry, setExpiry] = useState(''); const [noExp, setNoExp] = useState(false);
  const [sid, setSid] = useState(''); const [paid, setPaid] = useState(true); const [err, setErr] = useState({});
  const [newP, setNewP] = useState(null);
  const options = useMemo(() => S.products.map((x) => ({ id: x.id, label: x.name, sub: qtyText(x, stockMap[x.id] || 0) })), [S.products, stockMap]);
  const qty = p ? (isW(p) ? toNum(kg) : toNum(cartons) * packN(p) + toNum(pieces)) : 0;
  const unitCost = qty > 0 && toNum(cost) > 0 ? toNum(cost) / qty : 0;
  const chips = [['شهر', 30], ['3 شهور', 90], ['6 شهور', 180], ['سنة', 365]];
  const save = () => {
    const e = {};
    if (!p) e.p = 'اختار المنتج'; if (p && !(qty > 0)) e.q = isW(p) ? 'اكتب الوزن' : 'اكتب الكمية';
    if (!(toNum(cost) > 0)) e.c = 'اكتب إجمالي سعر الشراء'; if (!noExp && !expiry) e.e = 'اختار تاريخ الصلاحية أو "مفيش صلاحية"';
    setErr(e); if (Object.keys(e).length) return;
    act.addStock({ pid: p.id, qty: isW(p) ? r3(qty) : Math.round(qty), cost: toNum(cost), expiry: noExp ? null : expiry, sid: sid || null, paid });
    toast.show({ msg: 'اتضاف للمخزون: ' + p.name + ' — ' + qtyText(p, qty) });
    onClose();
  };
  return (<>
    <Modal title="إضافة للمخزون" onClose={onClose} footer={<><Btn kind="ghost" onClick={onClose}>إلغاء</Btn><Btn icon="check" onClick={save}>إضافة</Btn></>}>
      <Field div label="المنتج" err={err.p}><Combobox id="stk-prod" options={options} value={pid} onChange={(v) => { setPid(v); setErr({}); }} placeholder="دوّر على المنتج أو اختاره" emptyAction={(q) => setNewP(q || '')} /></Field>
      {p && (<>
        <div className="cur-stock">الموجود دلوقتي: <b>{qtyText(p, stockMap[p.id] || 0)}</b></div>
        {isW(p) ? <Field label="الوزن اللي دخل" err={err.q}><Num value={kg} onChange={setKg} suffix="كجم" /></Field> : (
          <div className="row2">{packN(p) > 0 && <Field label="كراتين" err={err.q}><Num value={cartons} onChange={setCartons} suffix="كرتونة" /></Field>}
            <Field label={packN(p) > 0 ? 'قطع زيادة' : 'الكمية'} err={packN(p) > 0 ? '' : err.q}><Num value={pieces} onChange={setPieces} suffix="قطعة" /></Field></div>)}
        <Field label="إجمالي سعر الشراء" err={err.c} hint={unitCost > 0 ? (isW(p) ? 'الكيلو بـ ' : 'القطعة بـ ') + egp(unitCost) : 'السعر الكلي للكمية دي'}><Num value={cost} onChange={setCost} suffix="ج.م" /></Field>
        <Field label="تاريخ الصلاحية" err={err.e}>
          <input type="date" value={expiry} disabled={noExp} min={dkey(new Date())} onChange={(e) => setExpiry(e.target.value)} />
        </Field>
        <div className="chips tight">{chips.map(([l, d]) => (<button type="button" key={d} className="chip" onClick={() => { setNoExp(false); setExpiry(dkey(addDays(new Date(), d))); }}>بعد {l}</button>))}
          <button type="button" className={'chip' + (noExp ? ' on' : '')} onClick={() => setNoExp(!noExp)}>مفيش صلاحية</button></div>
        <Field label="اشتريته من مين؟ (اختياري)"><select value={sid} onChange={(e) => setSid(e.target.value)}><option value="">— مش مهم —</option>{S.people.suppliers.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
        {sid && <label className="chk"><input type="checkbox" checked={!paid} onChange={(e) => setPaid(!e.target.checked)} /><span>لسه ما دفعتش (آجل للمورد)</span></label>}
      </>)}
    </Modal>
    {newP !== null && <ProductFormModal presetName={newP} onClose={() => setNewP(null)} onSaved={(id) => { setPid(id); setErr({}); }} />}
  </>);
}
