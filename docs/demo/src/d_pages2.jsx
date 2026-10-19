/* ================= alerts calc ================= */
function computeAlerts(S, stockMap) {
  const out = [], low = [], exp = [];
  S.products.forEach((p) => { const q = stockMap[p.id] || 0; const lv = stockLevel(p, q); if (lv === 'out') out.push({ p, q }); else if (lv === 'low') low.push({ p, q }); });
  const pm = {}; S.products.forEach((p) => { pm[p.id] = p; });
  S.batches.forEach((b) => { if (b.remaining > 0.0001 && b.expiry && pm[b.pid]) { const d = daysBetween(new Date(), parseKey(b.expiry)); if (d <= 7) exp.push({ b, p: pm[b.pid], d }); } });
  exp.sort((a, b) => a.d - b.d);
  return { out, low, exp, total: out.length + low.length + exp.length };
}

/* ================= المصروفات ================= */
const EXP_CATS = [['كهرباء', 'zap'], ['نت', 'wifi'], ['إيجار', 'store'], ['مرتبات', 'users'], ['نقل', 'truck'], ['صيانة', 'edit'], ['أخرى', 'list']];
const EXP_LBL = { كهرباء: 'كهرباء', نت: 'إنترنت', إيجار: 'إيجار', مرتبات: 'مرتبات', نقل: 'نقل', صيانة: 'صيانة', أخرى: 'أخرى' };
function ExpensesPage() {
  const { S, act } = useApp(); const toast = useToast();
  const [cat, setCat] = useState('كهرباء'); const [amt, setAmt] = useState(''); const [note, setNote] = useState(''); const [day, setDay] = useState(dkey(new Date())); const [more, setMore] = useState(false); const [err, setErr] = useState('');
  const per = usePeriod('today');
  const list = useMemo(() => S.expenses.filter((e) => inRange(e.ts, per.range)).sort((a, b) => b.ts - a.ts), [S.expenses, per.range]);
  const total = list.reduce((s, e) => s + e.amount, 0);
  const add = () => {
    if (!(toNum(amt) > 0)) { setErr('اكتب المبلغ'); return; }
    let ts = Date.now(); if (day !== dkey(new Date())) { const d = parseKey(day); d.setHours(12, 0, 0, 0); ts = d.getTime(); }
    act.addExpense({ cat, amount: toNum(amt), note: note.trim(), ts }); toast.show({ msg: 'اتسجل مصروف ' + EXP_LBL[cat] + ' — ' + egp(toNum(amt)) });
    setAmt(''); setNote(''); setErr('');
  };
  const byCat = useMemo(() => { const m = {}; list.forEach((e) => { m[e.cat] = (m[e.cat] || 0) + e.amount; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); }, [list]);
  return (<div className="page">
    <PageHead title="المصروفات" sub="أي مصروف على المحل ما عدا شراء البضاعة (دي بتتسجل في المخزون)" />
    <div className="card form-card">
      <div className="chips cats">{EXP_CATS.map(([c]) => (<button type="button" key={c} className={'chip lg' + (cat === c ? ' on' : '')} onClick={() => setCat(c)}>{EXP_LBL[c]}</button>))}</div>
      <div className="exp-row"><Field label="المبلغ" err={err} grow><Num value={amt} onChange={(v) => { setAmt(v); setErr(''); }} suffix="ج.م" onKeyDown={(e) => { if (e.key === 'Enter') add(); }} /></Field>
        <Btn icon="plus" onClick={add} className="exp-add">سجّل</Btn></div>
      <button type="button" className="lnk" onClick={() => setMore(!more)}>{more ? 'إخفاء' : 'ملاحظة أو يوم تاني؟'}</button>
      {more && <div className="row2"><Field label="ملاحظة (اختياري)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: فاتورة الشهر" /></Field><Field label="اليوم"><input type="date" value={day} max={dkey(new Date())} onChange={(e) => setDay(e.target.value || dkey(new Date()))} /></Field></div>}
    </div>
    <PeriodBar value={per.key} onChange={per.setKey} custom={per.custom} onCustom={per.setCustom} />
    <div className="sumline big"><span>إجمالي المصروفات — {per.title}</span><b>{egp(total)}</b></div>
    {byCat.length > 1 && <div className="chips tight">{byCat.map(([c, v]) => (<span className="chip static" key={c}>{EXP_LBL[c] || c}: {fmt(v)}</span>))}</div>}
    {list.length === 0 ? <Empty icon="wallet" title="مفيش مصروفات في الفترة دي" /> :
      <div className="list card">{list.map((e) => (<div className="lrow" key={e.id}><div className="lr-n"><b>{EXP_LBL[e.cat] || e.cat}</b><small>{dateLabel(e.ts)} · {timeText(e.ts)}{e.note ? ' · ' + e.note : ''}</small></div><div className="lr-q"><b>{egp(e.amount)}</b></div>
        <button type="button" className="ib sm" aria-label="حذف" onClick={() => { const x = e; act.deleteExpense(e.id); toast.show({ msg: 'اتحذف المصروف', undo: () => act.addExpense({ cat: x.cat, amount: x.amount, note: x.note, ts: x.ts }) }); }}><Icon n="trash" s={17} /></button></div>))}</div>}
  </div>);
}

/* ================= الناس ================= */
const SEC = { owedToMe: 'ليك', iOwe: 'عليك', suppliers: 'الموردين' };
function PersonModal({ sec, person, onClose }) {
  const { S, act } = useApp(); const toast = useToast(); const sup = sec === 'suppliers';
  const [name, setName] = useState(person ? person.name : ''); const [phone, setPhone] = useState(person ? person.phone : '');
  const [amount, setAmount] = useState(person ? String(sup ? person.owed : person.amount) : ''); const [note, setNote] = useState(person ? person.note || '' : '');
  const [supplies, setSupplies] = useState(person && sup ? person.supplies : []); const [err, setErr] = useState({}); const [del, setDel] = useState(false); const [q, setQ] = useState('');
  const opts = useMemo(() => S.products.filter((p) => !supplies.includes(p.id)).map((p) => ({ id: p.id, label: p.name })), [S.products, supplies]);
  const save = () => {
    const e = {}; if (!name.trim()) e.name = 'اكتب الاسم'; if (phone && !/^[\d+\s-]{7,}$/.test(normDigits(phone))) e.phone = 'رقم غير صحيح'; if (!sup && !(toNum(amount) > 0)) e.amount = 'اكتب المبلغ';
    setErr(e); if (Object.keys(e).length) return;
    const data = sup ? { name: name.trim(), phone: normDigits(phone).trim(), supplies, owed: toNum(amount) } : { name: name.trim(), phone: normDigits(phone).trim(), amount: toNum(amount), note: note.trim() };
    if (person) act.updatePerson(sec, person.id, data); else act.addPerson(sec, data);
    toast.show({ msg: person ? 'اتحفظ' : 'اتضاف: ' + name.trim() }); onClose();
  };
  return (<><Modal title={(person ? 'تعديل ' : 'إضافة ') + (sec === 'owedToMe' ? 'حد عليه فلوس ليك' : sec === 'iOwe' ? 'حد ليه فلوس عندك' : 'مورد')} onClose={onClose}
    footer={<>{person && <Btn kind="dangerghost" icon="trash" onClick={() => setDel(true)}>حذف</Btn>}<span className="sp" /><Btn kind="ghost" onClick={onClose}>إلغاء</Btn><Btn icon="check" onClick={save}>حفظ</Btn></>}>
    <Field label="الاسم" err={err.name}><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
    <Field label="رقم التليفون" err={err.phone}><input inputMode="tel" dir="ltr" style={{ textAlign: 'right' }} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxxx" /></Field>
    <Field label={sup ? 'المتبقي له (اختياري)' : 'المبلغ'} err={err.amount}><Num value={amount} onChange={setAmount} suffix="ج.م" /></Field>
    {!sup && <Field label="ملاحظة"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
    {sup && (<div><div className="fl-lbl">بيوردّلك إيه؟</div>
      <div className="chips tight">{supplies.map((id) => { const p = S.products.find((x) => x.id === id); return p ? <button type="button" key={id} className="chip on" onClick={() => setSupplies(supplies.filter((x) => x !== id))}>{p.name} ×</button> : null; })}{!supplies.length && <small className="muted">لسه ما اخترتش</small>}</div>
      <Combobox options={opts} value={null} onChange={(id) => id && setSupplies([...supplies, id])} placeholder="ضيف منتج…" /></div>)}
  </Modal>
  {del && <Confirm danger ok="احذف" title="حذف" text={'هتحذف "' + person.name + '" من القايمة.'} onClose={() => setDel(false)} onOk={() => { act.deletePerson(sec, person.id); toast.show({ msg: 'اتحذف' }); onClose(); }} />}</>);
}
function PeoplePage() {
  const { S } = useApp(); const [sec, setSec] = useState('owedToMe'); const [m, setM] = useState(null);
  const list = S.people[sec]; const pm = useMemo(() => { const x = {}; S.products.forEach((p) => { x[p.id] = p.name; }); return x; }, [S.products]);
  const tot = sec === 'suppliers' ? list.reduce((s, x) => s + x.owed, 0) : list.reduce((s, x) => s + x.amount, 0);
  const totals = { owedToMe: S.people.owedToMe.reduce((s, x) => s + x.amount, 0), iOwe: S.people.iOwe.reduce((s, x) => s + x.amount, 0) };
  return (<div className="page">
    <PageHead title="الناس" sub="اللي ليك، واللي عليك، والموردين"><Btn icon="plus" onClick={() => setM({})}>إضافة</Btn></PageHead>
    <Seg className="big" value={sec} onChange={setSec} options={[['owedToMe', 'ليك'], ['iOwe', 'عليك'], ['suppliers', 'الموردين']]} />
    <div className="sumline big"><span>{sec === 'owedToMe' ? 'فلوس ليك عند ' + list.length + ' شخص' : sec === 'iOwe' ? 'فلوس عليك لـ ' + list.length : list.length + ' مورد — المتبقي ليهم'}</span><b>{egp(tot)}</b></div>
    {list.length === 0 ? <Empty icon="users" title="القايمة فاضية" action={<Btn icon="plus" onClick={() => setM({})}>إضافة</Btn>} /> :
      <div className="grid peo">{list.slice().sort((a, b) => (b.amount || b.owed || 0) - (a.amount || a.owed || 0)).map((x) => (
        <div className="pcard person" key={x.id}>
          <div className="pc-h"><div className="pc-n"><b>{x.name}</b>{x.phone ? <a className="tel" href={'tel:' + x.phone} dir="ltr"><Icon n="phone" s={14} />{x.phone}</a> : <small>بدون رقم</small>}</div>
            <button type="button" className="ib sm" aria-label={'تعديل ' + x.name} onClick={() => setM({ person: x })}><Icon n="edit" s={17} /></button></div>
          {sec === 'suppliers' ? (<><div className="chips tight">{x.supplies.map((id) => <span className="chip static" key={id}>{pm[id] || '—'}</span>)}{!x.supplies.length && <small className="muted">لسه ما اتحددش</small>}</div>
            {x.owed > 0 && <div className="amt-line">المتبقي له: <b>{egp(x.owed)}</b></div>}</>) :
            (<div className="amt-line"><b className={sec === 'owedToMe' ? 'pos' : 'neg'}>{egp(x.amount)}</b>{x.note && <small>{x.note}</small>}</div>)}
        </div>))}</div>}
    {m && <PersonModal sec={sec} person={m.person} onClose={() => setM(null)} />}
  </div>);
}

/* ================= التنبيهات ================= */
function AlertsPage() {
  const { S, stockMap, act } = useApp(); const toast = useToast(); const A = useMemo(() => computeAlerts(S, stockMap), [S, stockMap]);
  const [tab, setTab] = useState('all'); const [restock, setRestock] = useState(null); const [wo, setWo] = useState(null);
  const showStock = tab !== 'exp', showExp = tab !== 'stock';
  return (<div className="page">
    <PageHead title="التنبيهات" sub={A.total ? A.total + ' حاجة محتاجة انتباهك' : 'كله تمام'} />
    <Seg value={tab} onChange={setTab} options={[['all', 'الكل (' + A.total + ')'], ['stock', 'نفاد (' + (A.out.length + A.low.length) + ')'], ['exp', 'صلاحية (' + A.exp.length + ')']]} />
    {A.total === 0 && <Empty icon="check" title="مفيش تنبيهات" sub="المخزون والصلاحيات تمام" />}
    {showStock && A.out.length + A.low.length > 0 && (<section><h2 className="sec-t">نفاد المخزون</h2><div className="list card">
      {[...A.out.map((x) => ({ ...x, lv: 'out' })), ...A.low.map((x) => ({ ...x, lv: 'low' }))].map(({ p, q, lv }) => (
        <div key={p.id} className={'lrow al ' + lv}><i className="dot" /><div className="lr-n"><b>{p.name}</b><small>{lv === 'out' ? 'خلصان خالص' : 'فاضل ' + qtyText(p, q) + ' بس'}</small></div>
          <Btn kind="soft" icon="check" className="done" onClick={() => setRestock(p.id)}>تم</Btn></div>))}</div></section>)}
    {showExp && A.exp.length > 0 && (<section><h2 className="sec-t">الصلاحية</h2><div className="list card">
      {A.exp.map(({ b, p, d }) => (<div key={b.id} className={'lrow al ' + (d < 0 ? 'out' : 'low')}><i className="dot" /><div className="lr-n"><b>{p.name}</b><small>{d < 0 ? 'انتهت من ' + (-d) + ' يوم' : d === 0 ? 'بتنتهي النهارده' : 'بتنتهي بعد ' + d + ' يوم'} · {qtyText(p, b.remaining)}</small></div>
        <Btn kind="soft" icon="check" className="done" onClick={() => setWo({ b, p })}>تم</Btn></div>))}</div></section>)}
    {restock && <AddStockModal presetPid={restock} onClose={() => setRestock(null)} />}
    {wo && <Confirm ok={wo.d < 0 ? 'شيله من المخزون' : 'شيله من المخزون'} danger title="تم التعامل مع الصلاحية" text={'هنشيل ' + qtyText(wo.p, wo.b.remaining) + ' من "' + wo.p.name + '" من المخزون ونسجلها كفاقد (' + egp(r2(wo.b.remaining * wo.b.costUnit)) + '). لو لسه هتبيعها سيب التنبيه.'} onClose={() => setWo(null)} onOk={() => { act.writeOff(wo.b.id, 'expired'); toast.show({ msg: 'اتسجل كفاقد: ' + wo.p.name }); }} />}
  </div>);
}

/* ================= AI ================= */
const AI_LIMIT = 5; let AI_MSGS = [];
function pCost(S, from, to) { return S.sales.filter((s) => s.ts >= from && s.ts <= to); }
function aiAnswer(S, stockMap, qRaw) {
  const q = normAr(qRaw); const has = (...w) => w.some((x) => q.includes(normAr(x)));
  const now = new Date(); const rep = (key) => { const r = rangeFor(key); const ss = S.sales.filter((s) => inRange(s.ts, r)); const rev = ss.reduce((a, s) => a + s.amount, 0), cg = ss.reduce((a, s) => a + s.cost, 0); const ex = S.expenses.filter((e) => inRange(e.ts, r)).reduce((a, e) => a + e.amount, 0); const wst = S.waste.filter((w) => inRange(w.ts, r)).reduce((a, w) => a + w.cost, 0); return { rev, cg, gross: rev - cg, ex, wst, net: rev - cg - ex - wst, n: ss.length }; };
  const per = has('امبارح') ? ['yesterday', 'امبارح'] : has('اسبوع', 'اسبوعي', '7 ايام') ? ['week', 'آخر 7 أيام'] : has('شهر') ? ['month', 'الشهر ده'] : has('سنه', 'سنة') ? ['year', 'السنة دي'] : ['today', 'النهارده'];
  const pm = {}; S.products.forEach((p) => { pm[p.id] = p; });
  const named = S.products.find((p) => q.includes(normAr(p.name))) || S.products.find((p) => normAr(p.name).split(' ').some((w) => w.length > 2 && q.includes(w)));
  const last30 = S.sales.filter((s) => s.ts >= Date.now() - 30 * 864e5);
  const A = computeAlerts(S, stockMap);
  if (has('دولار', 'صرف', 'بنزين', 'سولار', 'وقود', 'غلاء', 'تضخم', 'اسعار البضاعه', 'ارتفاع', 'زياده الاسعار', 'جمارك', 'استيراد')) {
    return 'مقدرش أقولك رقم الدولار أو سعر البنزين اللحظي لأن الديمو ده مش متوصل بأسعار حية — شوف الرقم من البنك المركزي أو النشرة الرسمية.\n\nلكن ده تأثيره على سوبر ماركت زي بتاعك:\n• ارتفاع الدولار بيزوّد تكلفة المستورد والمعلبات وأي حاجة خامتها مستوردة (زيوت، شاي، قهوة، مكرونة أحياناً) — وبييجي على الموردين بعد فترة.\n• زيادة البنزين والسولار بتزوّد النقل فتزيد أسعار الجملة، خصوصاً الألبان والخضار واللحوم.\n• الصح: راجع فواتير الموردين كل أسبوع، وحدّث سعر البيع لما سعر الشراء يتغير، وشوف الأصناف اللي هامشها أقل من 10%.' + (S.products.length ? '\n\nمن بياناتك: ' + (() => { const lowM = S.products.filter((p) => p.sell > 0 && (p.sell - p.buy) / p.sell < 0.1); return lowM.length ? 'عندك ' + lowM.length + ' صنف هامشهم أقل من 10% (زي ' + lowM.slice(0, 3).map((p) => p.name).join('، ') + ') — دول أول ناس تراجع سعرهم.' : 'مفيش صنف هامشه أقل من 10% حالياً.'; })() : '');
  }
  if (has('سعر', 'بكام', 'بكم') && named) { const m = named.sell > 0 ? Math.round((named.sell - named.buy) / named.sell * 100) : 0; return named.name + ':\n' + (isW(named) ? '• الكيلو: شراء ' + egp(named.buy) + ' — بيع ' + egp(named.sell) : (packN(named) ? '• الكرتونة (' + named.n + '): شراء ' + egp(named.packBuy) + ' — بيع ' + egp(named.packSell) + '\n' : '') + '• القطعة: شراء ' + egp(named.buy) + ' — بيع ' + egp(named.sell)) + '\n• هامش الربح تقريباً ' + m + '%'; }
  if (named && has('باقي', 'مخزون', 'كام', 'فاضل', 'موجود')) { const st = stockMap[named.id] || 0; return named.name + ': ' + (st > 0 ? 'الموجود ' + qtyText(named, st) : 'خلصان') + '.'; }
  if (has('ربح', 'كسبت', 'مكسب', 'صافي', 'ارباح')) { const r = rep(per[0]); return 'تقرير ' + per[1] + ':\n• المبيعات: ' + egp(r.rev) + ' (' + r.n + ' بيعة)\n• تكلفة البضاعة: ' + egp(r.cg) + '\n• مجمل الربح: ' + egp(r.gross) + '\n• المصروفات: ' + egp(r.ex) + (r.wst ? '\n• فاقد: ' + egp(r.wst) : '') + '\n• صافي الربح: ' + egp(r.net) + (r.net < 0 ? '\n⚠ المصروفات أكتر من الربح في الفترة دي.' : ''); }
  if (has('مبيعات', 'بعت', 'ايراد', 'دخل')) { const r = rep(per[0]); return 'مبيعات ' + per[1] + ': ' + egp(r.rev) + ' في ' + r.n + ' بيعة.'; }
  if (has('مصروف', 'مصاريف')) { const r = rangeFor(per[0]); const l = S.expenses.filter((e) => inRange(e.ts, r)); const m = {}; l.forEach((e) => { m[e.cat] = (m[e.cat] || 0) + e.amount; }); return 'مصروفات ' + per[1] + ': ' + egp(l.reduce((a, e) => a + e.amount, 0)) + (l.length ? '\n' + Object.entries(m).sort((a, b) => b[1] - a[1]).map(([c, v]) => '• ' + (EXP_LBL[c] || c) + ': ' + egp(v)).join('\n') : ''); }
  if (has('اكتر', 'الاكثر', 'اعلي', 'الاعلي', 'اكثر', 'رايج', 'بيتباع')) { const m = {}; last30.forEach((s) => { m[s.pid] = (m[s.pid] || 0) + s.amount; }); const t = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5); return 'أكتر 5 أصناف مبيعاً آخر 30 يوم:\n' + t.map(([id, v], i) => (i + 1) + '. ' + (pm[id] ? pm[id].name : '—') + ' — ' + egp(v)).join('\n'); }
  if (has('خلص', 'ناقص', 'اشتري', 'اطلب', 'نواقص', 'اجيب')) { const l = [...A.out, ...A.low]; if (!l.length) return 'مفيش نواقص دلوقتي.'; const per30 = {}; last30.forEach((s) => { per30[s.pid] = (per30[s.pid] || 0) + s.qty; }); return 'محتاج تشتري:\n' + l.slice(0, 10).map(({ p, q }) => { const d = (per30[p.id] || 0) / 30; const need = d > 0 ? ' — بتبيع ~' + (isW(p) ? weightText(d * 7) : Math.ceil(d * 7) + ' قطعة') + ' في الأسبوع' : ''; return '• ' + p.name + ' (' + (q <= 0 ? 'خلصان' : 'فاضل ' + qtyText(p, q)) + ')' + need; }).join('\n'); }
  if (has('صلاحيه', 'تنتهي', 'منتهي', 'هتبوظ', 'بتبوظ', 'هالك')) { if (!A.exp.length) return 'مفيش حاجة قربت صلاحيتها (خلال 7 أيام).'; return 'قربت صلاحيتها:\n' + A.exp.slice(0, 8).map(({ p, d, b }) => '• ' + p.name + ' — ' + (d < 0 ? 'منتهية من ' + (-d) + ' يوم' : d === 0 ? 'النهارده' : 'بعد ' + d + ' يوم') + ' (' + qtyText(p, b.remaining) + ')').join('\n') + '\n\nنصيحة: اعرض الأقرب انتهاءً قدام، وعمل عليهم خصم بسيط قبل ما يتحولوا لخسارة.'; }
  if (has('ليا', 'عليا', 'ديون', 'مديون', 'فلوس برا', 'بيدينوني', 'اجل')) { const a = S.people.owedToMe.reduce((s, x) => s + x.amount, 0), b = S.people.iOwe.reduce((s, x) => s + x.amount, 0), c = S.people.suppliers.reduce((s, x) => s + x.owed, 0); return 'ليك عند الناس: ' + egp(a) + ' (' + S.people.owedToMe.length + ' شخص)\nعليك: ' + egp(b) + '\nمتبقي للموردين: ' + egp(c); }
  if (has('جرد', 'قيمه المخزون', 'راس المال', 'بضاعه')) { const v = S.batches.reduce((s, b) => s + b.remaining * b.costUnit, 0); return 'قيمة المخزون بسعر الشراء: ' + egp(v) + ' في ' + S.products.length + ' صنف. التفاصيل في الرئيسية ← الجرد.'; }
  if (has('نصيحه', 'ازاي ازود', 'اوفر', 'ازود الربح', 'تحسين', 'ركود', 'واقف')) { const sold = new Set(last30.map((s) => s.pid)); const stuck = S.products.filter((p) => (stockMap[p.id] || 0) > 0 && !sold.has(p.id)); const lowM = S.products.filter((p) => p.sell > 0 && (p.sell - p.buy) / p.sell < 0.1); return 'من بيانات محلك:\n• ' + (stuck.length ? 'أصناف واقفة (مبتتباعش من 30 يوم): ' + stuck.slice(0, 4).map((p) => p.name).join('، ') : 'مفيش أصناف واقفة') + '\n• ' + (lowM.length ? 'أصناف هامشها أقل من 10%: ' + lowM.slice(0, 4).map((p) => p.name).join('، ') + ' — راجع السعر' : 'هوامش الأسعار كويسة') + '\n• ' + (A.exp.length ? A.exp.length + ' صنف قرب صلاحيته — اعرضه قدام' : 'مفيش صلاحيات قريبة') + '\n• راجع أصناف الجملة اللي بتتباع كراتين عشان تاخد سعر كمية أحسن.'; }
  if (has('سوبر ماركت', 'محل', 'بقاله', 'تجارة', 'هامش', 'تسعير')) { return 'قاعدة عامة في سوبر ماركت الحي: هامش الربح بيختلف بحسب الصنف — الأصناف الأساسية سريعة الدوران (سكر، زيت، مياه) هامشها بسيط، والأجبان واللحوم الباردة والسناكس هامشها أعلى لكن عليها خطر الصلاحية. وزّع المخزون بحيث الأصناف السريعة ما تخلصش، وراقب الصلاحيات. اسألني عن بيانات محلك (الربح، النواقص، الأكتر مبيعاً) وهجاوبك بأرقامك.'; }
  return 'أقدر أساعدك في:\n• أرباحك ومبيعاتك ومصروفاتك (النهارده/امبارح/الأسبوع/الشهر)\n• النواقص والصلاحيات واللي ليك وعليك\n• أسعار الأصناف وهامش ربحها\n• تأثير الدولار والوقود على الأسعار (بشكل عام)\nجرّب: "كسبت كام النهارده؟"';
}
function AiPage() {
  const { S, act, stockMap } = useApp(); const [msgs, setMsgs] = useState(AI_MSGS); const [q, setQ] = useState(''); const [busy, setBusy] = useState(false); const end = useRef(null);
  const used = S.ai.date === dkey(new Date()) ? S.ai.count : 0; const left = Math.max(0, AI_LIMIT - used);
  useEffect(() => { AI_MSGS = msgs; if (end.current) end.current.scrollIntoView({ block: 'end' }); }, [msgs, busy]);
  const ask = (text) => {
    text = (text || q).trim(); if (!text || busy || left <= 0) return; setQ(''); setBusy(true); act.useAi();
    setMsgs((m) => [...m, { r: 'u', t: text }]);
    setTimeout(() => { setMsgs((m) => [...m, { r: 'a', t: aiAnswer(S, stockMap, text) }]); setBusy(false); }, 700);
  };
  const sugg = ['كسبت كام النهارده؟', 'إيه اللي خلص ومحتاج أشتريه؟', 'أكتر صنف بيتباع', 'الدولار والبنزين هيأثروا على أسعاري إزاي؟'];
  return (<div className="page ai">
    <PageHead title="مساعد حسبة" sub="اسأل عن محلك أو السوق"><span className={'quota' + (left === 0 ? ' zero' : '')}>باقي {left} من {AI_LIMIT} رسائل النهارده</span></PageHead>
    <div className="chat">
      {msgs.length === 0 && (<div className="ai-hello"><div className="e-ic"><Icon n="sparkle" s={28} /></div><b>اسألني أي حاجة عن محلك</b><span>الأرباح، النواقص، الأسعار، تأثير الدولار والوقود…</span>
        <div className="chips center">{sugg.map((s) => (<button type="button" className="chip lg" key={s} disabled={left <= 0} onClick={() => ask(s)}>{s}</button>))}</div></div>)}
      {msgs.map((m, i) => (<div key={i} className={'msg ' + m.r}><div className="bub">{m.t}</div></div>))}
      {busy && <div className="msg a"><div className="bub typing"><i /><i /><i /></div></div>}
      <div ref={end} />
    </div>
    {left <= 0 && <div className="limit"><Icon n="info" s={18} />خلصت رسائل النهارده (5). هتتجدد بكرة.</div>}
    <div className="composer"><VoiceButton sample="كسبت كام النهارده" onText={(t) => ask(t)} label="اسأل بالصوت" />
      <input value={q} disabled={left <= 0} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ask(); }} placeholder={left > 0 ? 'اكتب سؤالك…' : 'خلصت رسائل النهارده'} aria-label="سؤالك" />
      <button type="button" className="btn btn-primary send" disabled={!q.trim() || busy || left <= 0} onClick={() => ask()} aria-label="إرسال"><Icon n="send" s={18} /></button></div>
  </div>);
}
