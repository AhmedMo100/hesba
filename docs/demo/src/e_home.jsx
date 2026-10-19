/* ================= الرئيسية ================= */
function buildReport(S, range) {
  const pm = {}; S.products.forEach((p) => { pm[p.id] = p; });
  const sales = S.sales.filter((s) => inRange(s.ts, range)); const buys = S.batches.filter((b) => inRange(b.ts, range));
  const exps = S.expenses.filter((e) => inRange(e.ts, range)); const waste = S.waste.filter((w) => inRange(w.ts, range));
  const rev = sales.reduce((a, s) => a + s.amount, 0), cogs = sales.reduce((a, s) => a + s.cost, 0);
  const exp = exps.reduce((a, e) => a + e.amount, 0), wst = waste.reduce((a, w) => a + w.cost, 0), purch = buys.reduce((a, b) => a + b.cost, 0);
  const gross = rev - cogs, net = gross - exp - wst;
  const days = Math.max(1, daysBetween(range.from, range.to) + 1); const monthly = days > 62;
  const bk = {}; const keyOf = (ts) => (monthly ? dkey(ts).slice(0, 7) : dkey(ts));
  sales.forEach((s) => { const k = keyOf(s.ts); const b = bk[k] || (bk[k] = { rev: 0, gross: 0 }); b.rev += s.amount; b.gross += s.amount - s.cost; });
  const series = [];
  if (days === 1) { const hb = {}; sales.forEach((s) => { const h = new Date(s.ts).getHours(); const b = hb[h] || (hb[h] = { rev: 0, gross: 0 }); b.rev += s.amount; b.gross += s.amount - s.cost; }); const isToday = dkey(range.from) === dkey(new Date()); const last = isToday ? new Date().getHours() : 23; const hs = Object.keys(hb).map(Number); const h0 = Math.min(8, ...hs); for (let h = h0; h <= Math.max(h0, last, ...hs); h++) { const hh = h % 12 || 12; series.push({ k: String(h), label: hh + (h >= 12 ? 'م' : 'ص'), rev: (hb[h] || { rev: 0 }).rev, gross: (hb[h] || { gross: 0 }).gross, hour: true }); } }
  else if (monthly) { let d = new Date(range.from.getFullYear(), range.from.getMonth(), 1); const end = Math.min(range.to.getTime(), Date.now()); while (d.getTime() <= end) { const k = dkey(d).slice(0, 7); series.push({ k, label: AR_MONTHS[d.getMonth()], rev: (bk[k] || { rev: 0 }).rev, gross: (bk[k] || { gross: 0 }).gross }); d = new Date(d.getFullYear(), d.getMonth() + 1, 1); } }
  else { for (let i = 0; i < days; i++) { const d = addDays(range.from, i); if (d.getTime() > Date.now()) break; const k = dkey(d); series.push({ k, label: days <= 8 ? AR_DAYS[d.getDay()] : String(d.getDate()), rev: (bk[k] || { rev: 0 }).rev, gross: (bk[k] || { gross: 0 }).gross }); } }
  const byP = {}; sales.forEach((s) => { const b = byP[s.pid] || (byP[s.pid] = { pid: s.pid, rev: 0, profit: 0, qty: 0 }); b.rev += s.amount; b.profit += s.amount - s.cost; b.qty += s.qty; });
  const top = Object.values(byP).sort((a, b) => b.rev - a.rev);
  const byC = {}; top.forEach((t) => { const c = (pm[t.pid] && pm[t.pid].cat) || 'متفرقات'; const b = byC[c] || (byC[c] = { cat: c, rev: 0, profit: 0 }); b.rev += t.rev; b.profit += t.profit; });
  const cats = Object.values(byC).sort((a, b) => b.rev - a.rev);
  const byE = {}; exps.forEach((e) => { byE[e.cat] = (byE[e.cat] || 0) + e.amount; });
  const ev = [];
  const sd = {}; sales.forEach((s) => { const k = dkey(s.ts); const b = sd[k] || (sd[k] = { n: 0, amt: 0, ts: s.ts }); b.n++; b.amt += s.amount; b.ts = Math.max(b.ts, s.ts); });
  Object.entries(sd).forEach(([k, b]) => ev.push({ ts: b.ts, t: 'sale', title: 'مبيعات ' + dateLabel(parseKey(k)), meta: b.n + ' بيعة', amt: b.amt }));
  buys.forEach((b) => ev.push({ ts: b.ts, t: 'buy', title: 'دخل مخزون: ' + (pm[b.pid] ? pm[b.pid].name : '—'), meta: pm[b.pid] ? qtyText(pm[b.pid], b.qty) : '', amt: -b.cost }));
  exps.forEach((e) => ev.push({ ts: e.ts, t: 'exp', title: 'مصروف ' + (EXP_LBL[e.cat] || e.cat), meta: e.note || '', amt: -e.amount }));
  waste.forEach((w) => ev.push({ ts: w.ts, t: 'waste', title: 'فاقد: ' + (pm[w.pid] ? pm[w.pid].name : '—'), meta: 'صلاحية منتهية', amt: -w.cost }));
  ev.sort((a, b) => b.ts - a.ts);
  return { rev, cogs, gross, exp, wst, purch, net, n: sales.length, series, monthly, top, cats, byE: Object.entries(byE).sort((a, b) => b[1] - a[1]), ev, pm, margin: rev > 0 ? Math.round(gross / rev * 100) : 0 };
}
function BarChart({ series, monthly }) {
  const [hi, setHi] = useState(null); const max = Math.max(1, ...series.map((s) => s.rev)); const W = 600, H = 170, pad = 22; const bw = (W - pad) / Math.max(1, series.length);
  if (!series.length) return null; const every = series.length > 16 ? Math.ceil(series.length / 12) : 1;
  return (<div className="chart"><svg viewBox={`0 0 ${W} ${H + 24}`} preserveAspectRatio="none" role="img" aria-label="مبيعات الفترة">
    {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={0} x2={W} y1={H - H * f} y2={H - H * f} className="gl" />)}
    {series.map((s, i) => { const h = Math.max(s.rev > 0 ? 3 : 0, (s.rev / max) * (H - 10)); const x = i * bw + bw * 0.15; return (<g key={s.k} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} onClick={() => setHi(hi === i ? null : i)}>
      <rect x={i * bw} y={0} width={bw} height={H + 24} fill="transparent" />
      <rect x={x} y={H - h} width={bw * 0.7} height={h} rx={Math.min(5, bw * 0.2)} className={'bar' + (hi === i ? ' hi' : '')} />
      {i % every === 0 && <text x={i * bw + bw / 2} y={H + 16} textAnchor="middle" className="ax">{s.label}</text>}</g>); })}
  </svg>
    <div className="ch-tip">{hi != null ? <><b>{series[hi].label}{monthly || series[hi].hour ? '' : ' — ' + dateShort(parseKey(series[hi].k))}</b> مبيعات {egp(series[hi].rev)} · ربح {egp(series[hi].gross)}</> : 'المس عمود عشان تشوف التفاصيل'}</div></div>);
}
function Kpi({ label, value, tone, sub, big }) { return (<div className={'kpi ' + (tone || '') + (big ? ' big' : '')}><small>{label}</small><b>{value}</b>{sub && <em>{sub}</em>}</div>); }
function HomePage() {
  const { S, stockMap } = useApp(); const per = usePeriod('today'); const [tab, setTab] = useState('rep'); const [more, setMore] = useState(false);
  const R = useMemo(() => buildReport(S, per.range), [S, per.range]); const A = useMemo(() => computeAlerts(S, stockMap), [S, stockMap]);
  const nav = (h) => { location.hash = h; };
  return (<div className="page">
    <PageHead title="الرئيسية" sub={dateLabel(new Date()) + ' · ' + AR_DAYS[new Date().getDay()]} />
    {A.total > 0 && <button type="button" className="alert-strip" onClick={() => nav('#/alerts')}><Icon n="bell" s={18} /><span><b>{A.total} تنبيه</b> — {A.out.length} خلصان · {A.low.length} قرب يخلص · {A.exp.length} صلاحية</span><Icon n="left" s={16} /></button>}
    <Seg value={tab} onChange={setTab} options={[['rep', 'التقرير', 'chart'], ['inv', 'الجرد', 'layers']]} />
    {tab === 'rep' ? (<>
      <PeriodBar value={per.key} onChange={per.setKey} custom={per.custom} onCustom={per.setCustom} />
      <div className="kpis">
        <Kpi big tone="net" label={'صافي الربح — ' + per.title} value={egp(R.net)} sub={R.rev > 0 ? 'هامش ' + R.margin + '% قبل المصروفات' : ''} />
        <Kpi label="المبيعات" value={egp(R.rev)} sub={R.n + ' بيعة'} />
        <Kpi label="مجمل الربح" value={egp(R.gross)} sub="المبيعات − تكلفة البضاعة" />
        <Kpi label="تكلفة البضاعة المباعة" value={egp(R.cogs)} />
        <Kpi label="المصروفات" value={egp(R.exp)} tone="neg" />
        {R.wst > 0 && <Kpi label="فاقد (صلاحية)" value={egp(R.wst)} tone="neg" />}
        <Kpi label="مشتريات دخلت المخزن" value={egp(R.purch)} sub="مش بتتخصم من الربح" />
      </div>
      <section className="card"><h2 className="sec-t">المبيعات</h2>{R.rev > 0 ? <BarChart series={R.series} monthly={R.monthly} /> : <Empty icon="chart" title="مفيش مبيعات في الفترة دي" />}</section>
      <div className="two eq">
        <section className="card"><h2 className="sec-t">الأكتر مبيعاً</h2>{R.top.length === 0 ? <small className="muted">—</small> : R.top.slice(0, more ? 15 : 6).map((t, i) => { const p = R.pm[t.pid]; return (<div className="tp" key={t.pid}><span className="rk">{i + 1}</span><div className="tp-n"><b>{p ? p.name : '—'}</b><i style={{ width: (t.rev / R.top[0].rev * 100) + '%' }} /></div><div className="tp-v"><b>{fmt(t.rev)}</b><small>ربح {fmt(t.profit)}</small></div></div>); })}
          {R.top.length > 6 && <button type="button" className="lnk" onClick={() => setMore(!more)}>{more ? 'أقل' : 'المزيد'}</button>}</section>
        <section className="card"><h2 className="sec-t">حسب القسم</h2>{R.cats.length === 0 ? <small className="muted">—</small> : R.cats.map((c) => (<div className="cg" key={c.cat}><span>{c.cat}</span><span className="cg-v">{fmt(c.rev)}<small>ربح {fmt(c.profit)}</small></span></div>))}
          {R.byE.length > 0 && <><h2 className="sec-t sp-t">المصروفات</h2>{R.byE.map(([c, v]) => (<div className="cg" key={c}><span>{EXP_LBL[c] || c}</span><span className="cg-v neg">{fmt(v)}</span></div>))}</>}</section>
      </div>
      <section className="card"><h2 className="sec-t">كل اللي حصل في المحل</h2>
        {R.ev.length === 0 ? <small className="muted">لا يوجد نشاط</small> : <div className="tl">{R.ev.slice(0, 30).map((e, i) => (<div className={'tl-i ' + e.t} key={i}><i className="tl-d" /><div className="tl-b"><b>{e.title}</b><small>{dateLabel(e.ts)} · {timeText(e.ts)}{e.meta ? ' · ' + e.meta : ''}</small></div><span className={'tl-a ' + (e.amt < 0 ? 'neg' : 'pos')}>{e.amt < 0 ? '−' : '+'}{fmt(Math.abs(e.amt))}</span></div>))}</div>}
        {R.ev.length > 30 && <small className="muted">عرض آخر 30 حدث من {R.ev.length}</small>}</section>
    </>) : <Inventory />}
  </div>);
}
function Inventory() {
  const { S, stockMap } = useApp(); const [q, setQ] = useState('');
  const rows = useMemo(() => S.products.map((p) => { const q0 = stockMap[p.id] || 0; const bs = S.batches.filter((b) => b.pid === p.id && b.remaining > 0); const cost = bs.reduce((s, b) => s + b.remaining * b.costUnit, 0); const ex = bs.filter((b) => b.expiry).map((b) => b.expiry).sort()[0]; return { p, q: q0, cost, val: q0 * p.sell, ex, lv: stockLevel(p, q0) }; }).sort((a, b) => a.p.name.localeCompare(b.p.name, 'ar')), [S, stockMap]);
  const f = rows.filter((r) => !q || normAr(r.p.name).includes(normAr(q)));
  const tc = rows.reduce((s, r) => s + r.cost, 0), tv = rows.reduce((s, r) => s + r.val, 0);
  const csv = () => { const L = [['المنتج', 'القسم', 'الكمية', 'قيمة الشراء', 'قيمة البيع', 'أقرب صلاحية'].join(',')]; rows.forEach((r) => L.push([r.p.name, r.p.cat, qtyText(r.p, r.q), r2(r.cost), r2(r.val), r.ex || ''].map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(','))); const b = new Blob(['﻿' + L.join('\n')], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'jard-' + dkey(new Date()) + '.csv'; document.body.appendChild(a); a.click(); a.remove(); };
  return (<>
    <div className="kpis"><Kpi big tone="net" label={'قيمة المخزون بسعر الشراء — جرد ' + dateShort(new Date())} value={egp(tc)} sub={'بسعر البيع ' + egp(tv) + ' · ربح متوقع ' + egp(tv - tc)} /><Kpi label="عدد الأصناف" value={rows.length} /><Kpi label="خلصان" value={rows.filter((r) => r.lv === 'out').length} tone="neg" /><Kpi label="قرب يخلص" value={rows.filter((r) => r.lv === 'low').length} /></div>
    <div className="inv-bar"><SearchBox value={q} onChange={setQ} placeholder="دوّر في الجرد" voice={false} /><Btn kind="ghost" icon="download" onClick={csv}>تصدير Excel</Btn><Btn kind="ghost" icon="print" className="hide-m" onClick={() => window.print()}>طباعة</Btn></div>
    <div className="card tbl-w"><table className="tbl"><thead><tr><th>المنتج</th><th>الكمية</th><th>قيمة الشراء</th><th>قيمة البيع</th><th className="hide-m">أقرب صلاحية</th></tr></thead>
      <tbody>{f.map((r) => (<tr key={r.p.id} className={r.lv}><td><i className="dot" />{r.p.name}</td><td>{r.lv === 'out' ? <span className="tag out">خلصان</span> : qtyText(r.p, r.q)}</td><td>{fmt(r.cost)}</td><td>{fmt(r.val)}</td><td className="hide-m">{r.ex ? dateShort(parseKey(r.ex)) : '—'}</td></tr>))}</tbody>
      <tfoot><tr><td>الإجمالي</td><td /><td>{fmt(tc)}</td><td>{fmt(tv)}</td><td className="hide-m" /></tr></tfoot></table></div>
  </>);
}
