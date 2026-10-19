/* ================= حساب جديد / دخول ================= */
const GOVS = ['القاهرة', 'الجيزة', 'الإسكندرية', 'القليوبية', 'الشرقية', 'الدقهلية', 'الغربية', 'المنوفية', 'البحيرة', 'كفر الشيخ', 'دمياط', 'بورسعيد', 'الإسماعيلية', 'السويس', 'الفيوم', 'بني سويف', 'المنيا', 'أسيوط', 'سوهاج', 'قنا', 'الأقصر', 'أسوان', 'البحر الأحمر', 'الوادي الجديد', 'مطروح', 'شمال سيناء', 'جنوب سيناء'];
const SHOP_TYPES = ['سوبر ماركت', 'بقالة', 'ميني ماركت', 'جملة / نص جملة', 'أخرى'];
const okPhone = (v) => /^01[0125]\d{8}$/.test(normDigits(v).replace(/\s|-/g, ''));
const okMail = (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
function Steps({ step }) {
  const L = ['عنك', 'محلك'];
  return (<div className="steps" aria-label={'خطوة ' + (step + 1) + ' من 2'}>{L.map((l, i) => (<div key={l} className={'st' + (i === step ? ' on' : i < step ? ' done' : '')}><span className="st-n">{i < step ? <Icon n="check" s={14} sw={3} /> : i + 1}</span><b>{l}</b></div>))}<i className="st-line"><i style={{ transform: 'scaleX(' + step + ')' }} /></i></div>);
}
function ShopFields({ v, set, err }) {
  return (<>
    <Field label="اسم المحل" err={err.storeName}><input value={v.storeName} onChange={(e) => set({ storeName: e.target.value })} placeholder="مثال: سوبر ماركت البركة" autoComplete="organization" /></Field>
    <div className="fl-lbl">نوع المحل</div>
    <div className="chips tight wrapchips">{SHOP_TYPES.map((t) => (<button type="button" key={t} className={'chip' + (v.type === t ? ' on' : '')} onClick={() => set({ type: t })}>{t}</button>))}</div>
    <div className="row2 stack-s"><Field label="المحافظة"><select value={v.gov} onChange={(e) => set({ gov: e.target.value })}>{GOVS.map((g) => <option key={g}>{g}</option>)}</select></Field>
      <Field label="المنطقة (اختياري)"><input value={v.area} onChange={(e) => set({ area: e.target.value })} placeholder="مثال: المعادي" /></Field></div>
    <div className="row2 stack-s"><Field label="تاريخ فتح المحل" err={err.opened}><input type="date" value={v.opened} max={dkey(new Date())} onChange={(e) => set({ opened: e.target.value })} /></Field>
      <Field label="عدد العمال"><div className="stepper"><button type="button" aria-label="أقل" onClick={() => set({ workers: Math.max(0, (+v.workers || 0) - 1) })}>−</button><b>{v.workers}</b><button type="button" aria-label="أكتر" onClick={() => set({ workers: Math.min(99, (+v.workers || 0) + 1) })}>+</button></div></Field></div>
  </>);
}
function AuthScreen({ mode, setMode, hasAccount, onLogin }) {
  const { S, act } = useApp(); const toast = useToast();
  const [step, setStep] = useState(0); const [err, setErr] = useState({}); const [demo, setDemo] = useState(true); const [busy, setBusy] = useState(false); const [dir, setDir] = useState(1);
  const [v, setV] = useState({ owner: '', phone: '', email: '', pass: '', storeName: '', type: 'سوبر ماركت', gov: 'القاهرة', area: '', opened: '', workers: 1 });
  const set = (p) => { setV((x) => ({ ...x, ...p })); setErr({}); };
  const [lp, setLp] = useState(S.profile ? S.profile.phone : ''); const [lw, setLw] = useState(''); const [lerr, setLerr] = useState('');
  const next = () => {
    const e = {};
    if (v.owner.trim().length < 2) e.owner = 'اكتب اسمك';
    if (!okPhone(v.phone)) e.phone = 'رقم موبايل مصري صحيح (01xxxxxxxxx)';
    if (!okMail(v.email)) e.email = 'الإيميل غير صحيح';
    if (v.pass.length < 6) e.pass = 'كلمة السر 6 حروف أو أرقام على الأقل';
    setErr(e); if (Object.keys(e).length) return; setDir(1); setStep(1);
  };
  const create = () => {
    const e = {}; if (!v.storeName.trim()) e.storeName = 'اكتب اسم المحل'; if (!v.opened) e.opened = 'اختار تاريخ فتح المحل';
    setErr(e); if (Object.keys(e).length) return; setBusy(true);
    setTimeout(() => { act.signup({ owner: v.owner.trim(), phone: normDigits(v.phone).replace(/\s|-/g, ''), email: v.email.trim(), pass: hashPass(v.pass), storeName: v.storeName.trim(), type: v.type, gov: v.gov, area: v.area.trim(), opened: v.opened, workers: +v.workers || 0, created: Date.now() }, demo); onLogin(); toast.show({ msg: 'أهلاً يا ' + v.owner.trim().split(' ')[0] + ' 👋 حسابك اتفتح' }); }, 700);
  };
  const login = () => { const p = S.profile; if (!p || normDigits(lp).trim() !== p.phone || hashPass(lw) !== p.pass) { setLerr('الرقم أو كلمة السر غلط'); return; } onLogin(); };
  const signup = mode === 'signup';
  return (<div className="auth"><div className="au-card">
    <div className="au-head"><Logo s={signup ? 56 : 76} /><h1>{signup ? 'افتح حساب حسبة' : 'أهلاً بيك تاني'}</h1><p>{signup ? 'دقيقة واحدة وتبدأ تحسب محلك' : 'محلك كله في جيبك'}</p></div>
    {signup ? (<>
      <Steps step={step} />
      <div className="au-body" key={step} data-dir={dir}>
        {step === 0 ? (<>
          <Field label="اسمك (صاحب المحل)" err={err.owner}><input autoFocus value={v.owner} onChange={(e) => set({ owner: e.target.value })} placeholder="مثال: مجدي أحمد" autoComplete="name" /></Field>
          <Field label="رقم الموبايل" err={err.phone}><input dir="ltr" className="ltr" inputMode="tel" value={v.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="01xxxxxxxxx" autoComplete="tel" /></Field>
          <Field label="الإيميل (اختياري)" err={err.email}><input dir="ltr" className="ltr" inputMode="email" value={v.email} onChange={(e) => set({ email: e.target.value })} placeholder="name@email.com" autoComplete="email" /></Field>
          <Field label="كلمة السر" err={err.pass}><input type="password" value={v.pass} onChange={(e) => set({ pass: e.target.value })} placeholder="6 حروف أو أرقام على الأقل" autoComplete="new-password" onKeyDown={(e) => { if (e.key === 'Enter') next(); }} /></Field>
          <Btn className="wide lg" onClick={next}>التالي</Btn>
        </>) : (<>
          <ShopFields v={v} set={set} err={err} />
          <label className="chk demo"><input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} /><span><b>ابدأ ببيانات تجريبية</b><small>أصناف ومبيعات جاهزة عشان تجرب كل حاجة. تقدر تمسحها بعدين.</small></span></label>
          <div className="au-act"><Btn kind="ghost" className="lg" onClick={() => { setDir(-1); setStep(0); }}>رجوع</Btn><Btn className="lg grow1" disabled={busy} onClick={create}>{busy ? 'بنجهز محلك…' : 'إنشاء الحساب'}</Btn></div>
        </>)}
      </div>
      {hasAccount && <button type="button" className="lnk center" onClick={() => setMode('login')}>عندي حساب — دخول</button>}
    </>) : (<div className="au-body">
      <Field label="رقم الموبايل" err={lerr && ' '}><input dir="ltr" className="ltr" inputMode="tel" value={lp} onChange={(e) => { setLp(e.target.value); setLerr(''); }} autoComplete="tel" /></Field>
      <Field label="كلمة السر" err={lerr}><input type="password" autoFocus value={lw} onChange={(e) => { setLw(e.target.value); setLerr(''); }} onKeyDown={(e) => { if (e.key === 'Enter') login(); }} autoComplete="current-password" /></Field>
      <Btn className="wide lg" onClick={login}>دخول</Btn>
      <button type="button" className="lnk center" onClick={() => setMode('signup')}>حساب جديد</button>
    </div>)}
    <small className="au-note">نسخة تجريبية — البيانات بتتحفظ في جهازك بس</small>
  </div></div>);
}
function ProfileModal({ onClose }) {
  const { S, act } = useApp(); const toast = useToast(); const p = S.profile;
  const [v, setV] = useState({ owner: p.owner, phone: p.phone, email: p.email || '', storeName: p.storeName, type: p.type, gov: p.gov, area: p.area || '', opened: p.opened, workers: p.workers });
  const [err, setErr] = useState({}); const set = (x) => { setV((o) => ({ ...o, ...x })); setErr({}); };
  const save = () => { const e = {}; if (v.owner.trim().length < 2) e.owner = 'اكتب الاسم'; if (!okPhone(v.phone)) e.phone = 'رقم غير صحيح'; if (!okMail(v.email)) e.email = 'الإيميل غير صحيح'; if (!v.storeName.trim()) e.storeName = 'اكتب اسم المحل'; if (!v.opened) e.opened = 'اختار التاريخ'; setErr(e); if (Object.keys(e).length) return; act.updateProfile({ ...v, owner: v.owner.trim(), storeName: v.storeName.trim(), phone: normDigits(v.phone).trim() }); toast.show({ msg: 'اتحفظت بيانات الحساب' }); onClose(); };
  return (<Modal title="بيانات الحساب" onClose={onClose} footer={<><Btn kind="ghost" onClick={onClose}>إلغاء</Btn><Btn icon="check" onClick={save}>حفظ</Btn></>}>
    <div className="sec-mini">صاحب المحل</div>
    <Field label="الاسم" err={err.owner}><input value={v.owner} onChange={(e) => set({ owner: e.target.value })} /></Field>
    <div className="row2"><Field label="الموبايل" err={err.phone}><input dir="ltr" className="ltr" inputMode="tel" value={v.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
      <Field label="الإيميل (اختياري)" err={err.email}><input dir="ltr" className="ltr" inputMode="email" value={v.email} onChange={(e) => set({ email: e.target.value })} /></Field></div>
    <div className="sec-mini">المحل</div>
    <ShopFields v={v} set={set} err={err} />
  </Modal>);
}
