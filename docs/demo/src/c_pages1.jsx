/* ================= المنتجات ================= */
function PriceRow({ label, buy, sell }) {
  return (<div className="pr"><span className="pr-l">{label}</span><div className="pr-vals"><span className="pr-v"><small>شراء</small><b>{fmt(buy)}</b></span><span className="pr-v sell"><small>بيع</small><b>{fmt(sell)}</b></span></div></div>);
}
function ProductsPage() {
  const { S, stockMap } = useApp(); const [q, setQ] = useState(''); const [edit, setEdit] = useState(null); const [adding, setAdding] = useState(false);
  const list = useMemo(() => { const n = normAr(q); return S.products.filter((p) => !n || normAr(p.name).includes(n) || normAr(p.cat || '').includes(n)); }, [S.products, q]);
  return (<div className="page">
    <PageHead title="المنتجات" sub={S.products.length + ' منتج'}><Btn icon="plus" onClick={() => setAdding(true)}>إضافة منتج</Btn></PageHead>
    <SearchBox value={q} onChange={setQ} placeholder="دوّر على منتج… اكتب أو اتكلم" sample="لانشون" />
    {list.length === 0 ? <Empty icon="search" title="مفيش منتج بالاسم ده" sub="جرّب كلمة تانية أو ضيفه جديد" action={<Btn icon="plus" onClick={() => setAdding(true)}>إضافة منتج</Btn>} /> :
      <div className="grid pgrid">{list.map((p) => { const lv = stockLevel(p, stockMap[p.id] || 0); return (
        <div className={'pcard'} key={p.id}>
          <div className="pc-h"><div className="pc-n"><b>{p.name}</b><small>{isW(p) ? 'بالوزن' : packN(p) ? 'كرتونة ' + p.n + ' قطعة' : 'بالقطعة'}</small></div>
            <button type="button" className="ib sm" aria-label={'خيارات ' + p.name} onClick={() => setEdit(p)}><Icon n="more" s={20} /></button></div>
          <div className="pc-p">
            {isW(p) ? <PriceRow label="الكيلو" buy={p.buy} sell={p.sell} /> : <>
              {packN(p) > 0 && <PriceRow label="الكرتونة" buy={p.packBuy} sell={p.packSell} />}
              <PriceRow label="القطعة" buy={p.buy} sell={p.sell} /></>}
          </div>
          <div className={'pc-s ' + lv}><i />{lv === 'out' ? 'خلصان' : 'متاح ' + qtyText(p, stockMap[p.id] || 0)}</div>
        </div>); })}</div>}
    {adding && <ProductFormModal onClose={() => setAdding(false)} />}
    {edit && <ProductFormModal product={edit} onClose={() => setEdit(null)} />}
  </div>);
}

/* ================= المخزون ================= */
function StockPage() {
  const { S, stockMap } = useApp(); const [q, setQ] = useState(''); const [f, setF] = useState('all'); const [tab, setTab] = useState('qty'); const [adding, setAdding] = useState(false);
  const per = usePeriod('today'); const [delB, setDelB] = useState(null); const { act } = useApp(); const toast = useToast();
  const rows = useMemo(() => {
    const n = normAr(q); const rank = { out: 0, low: 1, ok: 2 };
    return S.products.filter((p) => !n || normAr(p.name).includes(n)).map((p) => ({ p, q: stockMap[p.id] || 0, lv: stockLevel(p, stockMap[p.id] || 0) }))
      .filter((r) => f === 'all' || r.lv === f || (f === 'low' && r.lv === 'out')).sort((a, b) => rank[a.lv] - rank[b.lv] || a.p.name.localeCompare(b.p.name, 'ar'));
  }, [S.products, stockMap, q, f]);
  const log = useMemo(() => S.batches.filter((b) => inRange(b.ts, per.range) && b.cost > 0 || (inRange(b.ts, per.range) && b.qty > 0)).sort((a, b) => b.ts - a.ts), [S.batches, per.range]);
  const logTotal = log.reduce((s, b) => s + b.cost, 0);
  const pm = useMemo(() => { const m = {}; S.products.forEach((p) => { m[p.id] = p; }); return m; }, [S.products]);
  const groups = useMemo(() => { const g = []; log.forEach((b) => { const k = dkey(b.ts); let x = g[g.length - 1]; if (!x || x.k !== k) { x = { k, items: [] }; g.push(x); } x.items.push(b); }); return g; }, [log]);
  const cnt = { out: rows.length && S.products.filter((p) => (stockMap[p.id] || 0) <= 0.0001).length, low: S.products.filter((p) => stockLevel(p, stockMap[p.id] || 0) === 'low').length };
  return (<div className="page">
    <PageHead title="المخزون" sub="الكميات الحالية وسجل اللي دخل"><Btn icon="plus" onClick={() => setAdding(true)}>إضافة</Btn></PageHead>
    <div className="only-m"><Seg value={tab} onChange={setTab} options={[['qty', 'الكميات'], ['log', 'سجل الإضافات']]} /></div>
    <div className="two">
      <section className={'col' + (tab === 'qty' ? '' : ' hide-m')}>
        <h2 className="sec-t only-d">الكميات الحالية</h2>
        <SearchBox value={q} onChange={setQ} placeholder="دوّر في المخزون" sample="بيبسي" />
        <div className="chips"><button type="button" className={'chip' + (f === 'all' ? ' on' : '')} onClick={() => setF('all')}>الكل</button><button type="button" className={'chip' + (f === 'low' ? ' on' : '')} onClick={() => setF('low')}>قرب يخلص ({cnt.low + (cnt.out || 0)})</button><button type="button" className={'chip' + (f === 'out' ? ' on' : '')} onClick={() => setF('out')}>خلصان ({cnt.out || 0})</button></div>
        <div className="list">{rows.map(({ p, q, lv }) => (<div key={p.id} className={'lrow ' + lv}><i className="dot" /><div className="lr-n"><b>{p.name}</b>{!isW(p) && packN(p) > 0 && <small>الكرتونة {p.n} قطعة</small>}</div><div className="lr-q">{lv === 'out' ? <span className="tag out">خلصان</span> : <b>{qtyText(p, q)}</b>}</div></div>))}
          {rows.length === 0 && <Empty icon="layers" title="مفيش نتايج" />}</div>
      </section>
      <section className={'col' + (tab === 'log' ? '' : ' hide-m')}>
        <h2 className="sec-t only-d">سجل الإضافات</h2>
        <PeriodBar value={per.key} onChange={per.setKey} custom={per.custom} onCustom={per.setCustom} options={[['today', 'النهارده'], ['yesterday', 'امبارح'], ['week', 'الأسبوع'], ['month', 'الشهر'], ['year', 'السنة'], ['custom', 'يوم/فترة']]} />
        <div className="sumline"><span>{log.length} إضافة</span><b>{egp(logTotal)}</b></div>
        {groups.length === 0 ? <Empty icon="truck" title="مفيش إضافات في الفترة دي" sub="اضغط إضافة لتسجيل بضاعة دخلت" /> :
          groups.map((g) => (<div key={g.k} className="dgroup"><div className="dg-h">{dateLabel(parseKey(g.k))}</div>
            {g.items.map((b) => { const p = pm[b.pid]; const sup = S.people.suppliers.find((v) => v.id === b.sid); const dl = b.expiry ? daysBetween(new Date(), parseKey(b.expiry)) : null; return (
              <div className="lgi" key={b.id}><div className="lg-top"><b>{p ? p.name : 'منتج محذوف'}</b><span className="lg-q">+ {p ? qtyText(p, b.qty) : b.qty}</span></div>
                <div className="lg-meta"><span>{timeText(b.ts)}</span><span>{egp(b.cost)}</span>{sup && <span>{sup.name}</span>}{b.expiry && <span className={dl != null && dl <= 7 ? 'warn' : ''}>صلاحية {dateShort(parseKey(b.expiry))}</span>}
                  <button type="button" className="lnk" onClick={() => setDelB(b)}>حذف</button></div></div>); })}</div>))}
      </section>
    </div>
    {adding && <AddStockModal onClose={() => setAdding(false)} />}
    {delB && <Confirm danger ok="احذف الإضافة" title="حذف الإضافة" text="الكمية اللي لسه متباعتش منها هتتشال من المخزون." onClose={() => setDelB(null)} onOk={() => { act.deleteBatch(delB.id); toast.show({ msg: 'اتحذفت الإضافة' }); }} />}
  </div>);
}

/* ================= البيع ================= */
function SalesPage() {
  const { S, act, stockMap } = useApp(); const toast = useToast();
  const [q, setQ] = useState(''); const [wp, setWp] = useState(null); const grp = useRef(null); const [flash, setFlash] = useState({});
  const list = useMemo(() => { const n = normAr(q); return S.products.filter((p) => !n || normAr(p.name).includes(n)); }, [S.products, q]);
  const todayR = rangeFor('today'); const todaySales = useMemo(() => S.sales.filter((s) => inRange(s.ts, todayR)), [S.sales]);
  const tTotal = todaySales.reduce((s, x) => s + x.amount, 0);
  const pm = useMemo(() => { const m = {}; S.products.forEach((p) => { m[p.id] = p; }); return m; }, [S.products]);
  const record = (p, qty, kind, packs) => {
    const r = act.sell(p.id, qty, kind, packs);
    if (r.err) { toast.show({ kind: 'err', msg: r.err }); return; }
    const now = Date.now(); let g = grp.current;
    if (g && g.pid === p.id && now - g.t < 4800 && g.kind === kind) { g.ids.push(r.id); g.amount += r.amount; g.qty += r.qty; } else g = grp.current = { pid: p.id, kind, ids: [r.id], amount: r.amount, qty: r.qty, tid: uid('g') };
    g.t = now;
    const label = isW(p) ? weightText(g.qty) : kind === 'pack' ? (g.ids.length) + ' كرتونة' : g.qty + ' قطعة';
    const gg = g; toast.show({ id: g.tid, msg: p.name + ' — ' + label + ' — ' + egp(g.amount), undo: () => { act.undoSales(gg.ids); grp.current = null; } });
    setFlash((f) => ({ ...f, [p.id]: now })); setTimeout(() => setFlash((f) => (f[p.id] === now ? { ...f, [p.id]: 0 } : f)), 450);
  };
  const tap = (p, e) => {
    const lv = stockLevel(p, stockMap[p.id] || 0);
    if (lv === 'out') { toast.show({ kind: 'err', msg: p.name + ' خلصان — ضيفه من المخزون' }); return; }
    if (isW(p)) { setWp({ p, el: e.currentTarget }); return; }
    record(p, 1, 'piece');
  };
  const sellPack = (p) => { if ((stockMap[p.id] || 0) < p.n) { toast.show({ kind: 'err', msg: 'مفيش كرتونة كاملة من ' + p.name + ' — المتاح ' + qtyText(p, stockMap[p.id] || 0) }); return; } record(p, p.n, 'pack', 1); };
  return (<div className="page sales">
    <SearchBox value={q} onChange={setQ} placeholder="دوّر على صنف…" sample="بيبسي" />
    <div className="s-bar"><div className="s-total"><span>مبيعات النهارده</span><b>{egp(tTotal)}</b></div>
      <div className="legend"><span><i className="out" />خلصان</span><span><i className="low" />قرب يخلص</span></div></div>
    <div className="grid tgrid">{list.map((p) => { const st = stockMap[p.id] || 0; const lv = stockLevel(p, st); return (
      <div key={p.id} className={'tile ' + lv + (flash[p.id] ? ' pop' : '')}>
        <button type="button" className="t-main" onClick={(e) => tap(p, e)} aria-label={'بيع ' + p.name}>
          <span className="t-n">{p.name}</span>
          <span className="t-p">{isW(p) ? <><Icon n="scale" s={14} />{fmt(p.sell)} ج / كجم</> : <>{fmt(p.sell)} ج</>}</span>
          <span className="t-s">{lv === 'out' ? 'خلصان' : qtyText(p, st)}</span>
        </button>
        {!isW(p) && packN(p) > 0 && lv !== 'out' && <button type="button" className="t-pack" onClick={() => sellPack(p)} aria-label={'بيع كرتونة ' + p.name} title={'كرتونة (' + p.n + ') بـ ' + fmt(p.packSell) + ' ج'}><Icon n="box" s={16} /><span>كرتونة</span></button>}
      </div>); })}
      {list.length === 0 && <Empty icon="search" title="مفيش صنف بالاسم ده" />}</div>
    {wp && <WeightPop p={wp.p} anchor={wp.el} stock={stockMap[wp.p.id] || 0} onClose={() => setWp(null)} onSell={(kg) => { record(wp.p, kg, 'kg'); setWp(null); }} />}
    {todaySales.length > 0 && <div className="recent"><h3>آخر البيعات</h3>{todaySales.slice().sort((a, b) => b.ts - a.ts).slice(0, 5).map((s) => (<div key={s.id} className="rc"><span>{pm[s.pid] ? pm[s.pid].name : '—'}</span><small>{timeText(s.ts)}</small><b>{egp(s.amount)}</b></div>))}</div>}
  </div>);
}
function WeightPop({ p, anchor, stock, onClose, onSell }) {
  const pr = useRef(null); useGhost(pr, 'out');
  const [v, setV] = useState(''); const [u, setU] = useState('g'); const [pos, setPos] = useState(null); const inp = useRef(null);
  useEffect(() => { if (anchor) { const r = anchor.getBoundingClientRect(); const w = Math.min(300, window.innerWidth - 20); let left = r.left + r.width / 2 - w / 2; left = Math.max(10, Math.min(left, window.innerWidth - w - 10)); const ph = 262; let top = r.bottom + ph + 90 < window.innerHeight ? r.bottom + 8 : r.top - ph - 8; top = Math.max(10, Math.min(top, window.innerHeight - ph - 84)); setPos({ left, top, w }); } setTimeout(() => inp.current && inp.current.focus(), 30); }, [anchor]);
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const kg = u === 'g' ? toNum(v) / 1000 : toNum(v); const amt = kg > 0 ? r2(kg * p.sell) : 0;
  const go = () => onSell(r3(kg));
  const bad = kg <= 0 ? '' : kg > stock + 1e-9 ? 'المتاح ' + weightText(stock) : '';
  const quick = u === 'g' ? [100, 250, 500, 1000] : [0.25, 0.5, 1, 2];
  return (<><div className="wp-shield" onClick={onClose} />
    <div className="wpop" ref={pr} style={pos ? { left: pos.left, top: pos.top, width: pos.w } : { visibility: 'hidden' }} role="dialog" aria-label={'وزن ' + p.name}>
      <div className="wp-h"><b>{p.name}</b><small>{fmt(p.sell)} ج / كجم</small></div>
      <div className="wp-row"><input ref={inp} inputMode="decimal" value={v} placeholder="الوزن" onChange={(e) => setV(normDigits(e.target.value).replace(/[^\d.]/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter' && kg > 0 && !bad) go(); }} />
        <Seg className="sm" value={u} onChange={(x) => { setU(x); setV(''); }} options={[['g', 'جرام'], ['kg', 'كيلو']]} /></div>
      <div className="quick">{quick.map((x) => (<button type="button" className="chip" key={x} onClick={() => setV(String(x))}>{x}</button>))}</div>
      <button type="button" className="btn btn-primary wide" disabled={!(kg > 0) || !!bad} onClick={go}>{bad ? bad : kg > 0 ? 'بيع — ' + egp(amt) : 'اكتب الوزن'}</button>
    </div></>);
}
